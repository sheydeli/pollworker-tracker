const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(express.json());
app.use(express.static("public", { index: false }));

const assignments = JSON.parse(
  fs.readFileSync(path.join(__dirname, "assignments.json"), "utf8")
);

const validPrecincts = new Set(assignments.map(a => a.precinct));

let locations = [];
let driverProgress = {};

const MINUTES_PER_STOP = 4;
const BASE_TRAVEL_MINUTES = 5;

// =============================
// UPDATE DRIVER GPS LOCATION
// =============================
app.post("/update-location", (req, res) => {
  const { id, lat, lon } = req.body;

  const existing = locations.find(l => l.id === id);

  if (existing) {
    existing.lat = lat;
    existing.lon = lon;
    existing.updatedAt = new Date().toISOString();
  } else {
    locations.push({
      id,
      lat,
      lon,
      updatedAt: new Date().toISOString()
    });
  }

  res.json({ status: "updated" });
});

// =============================
// UPDATE DRIVER CURRENT STOP
// =============================
app.post("/update-driver-stop", (req, res) => {
  const { driverId, currentStop } = req.body;
  const newStop = Number(currentStop);

  if (!driverProgress[driverId]) {
    driverProgress[driverId] = {
      currentStop: null,
      completedStops: [],
      reopenedStops: [],
      updatedAt: null
    };
  }

  const progress = driverProgress[driverId];
  const oldStop = progress.currentStop;

  if (
    oldStop !== null &&
    oldStop !== newStop &&
    !progress.completedStops.includes(oldStop)
  ) {
    progress.completedStops.push(oldStop);
  }

  progress.currentStop = newStop;
  progress.updatedAt = new Date().toISOString();

  progress.reopenedStops = progress.reopenedStops.filter(s => s !== newStop);

  res.json({
    status: "updated",
    currentStop: progress.currentStop,
    completedStops: progress.completedStops,
    reopenedStops: progress.reopenedStops
  });
});

// =============================
// REOPEN STOP
// =============================
app.post("/reopen-stop", (req, res) => {
  const { driverId, stopNumber } = req.body;
  const stop = Number(stopNumber);

  if (!driverProgress[driverId]) {
    driverProgress[driverId] = {
      currentStop: null,
      completedStops: [],
      reopenedStops: [],
      updatedAt: null
    };
  }

  const progress = driverProgress[driverId];

  progress.completedStops = progress.completedStops.filter(s => s !== stop);

  if (!progress.reopenedStops.includes(stop)) {
    progress.reopenedStops.push(stop);
  }

  progress.updatedAt = new Date().toISOString();

  res.json({
    status: "reopened",
    completedStops: progress.completedStops,
    reopenedStops: progress.reopenedStops
  });
});

// =============================
// GET ALL LOCATIONS
// =============================
app.get("/locations", (req, res) => {
  res.json(locations);
});

// =============================
// GET SINGLE DRIVER LOCATION
// =============================
app.get("/locations/:id", (req, res) => {
  const location = locations.find(l => l.id === req.params.id);

  if (!location) {
    return res.status(404).json({ error: "Driver not found" });
  }

  res.json(location);
});

// =============================
// GET DRIVER LIST
// =============================
app.get("/drivers", (req, res) => {
  const drivers = [...new Set(assignments.map(a => a.driverId))].sort();
  res.json(drivers);
});

// =============================
// GET DRIVER ROUTE
// =============================
app.get("/driver-route/:driverId", (req, res) => {
  const driverId = String(req.params.driverId);

  const route = assignments
    .filter(a => a.driverId === driverId)
    .sort((a, b) => a.stopNumber - b.stopNumber);

  if (!route.length) {
    return res.status(404).json({ error: "Driver route not found" });
  }

  const progress = driverProgress[driverId] || {
    currentStop: null,
    completedStops: [],
    reopenedStops: []
  };

  res.json({
    driverId,
    progress,
    route
  });
});

// =============================
// ADMIN DASHBOARD DATA
// =============================
app.get("/admin-data", (req, res) => {
  const uniqueDrivers = [...new Set(assignments.map(a => a.driverId))];

  const drivers = uniqueDrivers.map(driverId => {
    const route = assignments
      .filter(a => a.driverId === driverId)
      .sort((a, b) => a.stopNumber - b.stopNumber);

    const location = locations.find(l => l.id === driverId) || null;
    const progress = driverProgress[driverId] || null;

    return {
      driverId,
      route,
      location,
      progress
    };
  });

  res.json({ drivers });
});

// =============================
// PRECINCT STATUS WITH ETA
// =============================
app.get("/assignment/:precinct", (req, res) => {
  const precinct = String(req.params.precinct);

  if (!validPrecincts.has(precinct)) {
    return res.status(404).json({ error: "Invalid precinct" });
  }

  const assignment = assignments.find(a => a.precinct === precinct);
  const driverLocation = locations.find(l => l.id === assignment.driverId);
  const progress = driverProgress[assignment.driverId] || null;

  let statusCode = "not_started";
  let stopsBeforeYou = null;
  let etaMinutes = null;

  if (progress && typeof progress.currentStop === "number") {
    const driverRoute = assignments
      .filter(a => a.driverId === assignment.driverId)
      .sort((a, b) => a.stopNumber - b.stopNumber);

    const currentStop = Number(progress.currentStop);
    const yourStop = Number(assignment.stopNumber);
    const completedStops = (progress.completedStops || []).map(Number);
    const reopenedStops = (progress.reopenedStops || []).map(Number);

    const isCompleted = completedStops.includes(yourStop);
    const isReopened = reopenedStops.includes(yourStop);

    if (isCompleted && !isReopened) {
      statusCode = "completed_or_return";
      stopsBeforeYou = 0;
      etaMinutes = null;
    } else {
      const normalTodoStops = driverRoute
        .map(a => Number(a.stopNumber))
        .filter(stop =>
          stop !== currentStop &&
          !completedStops.includes(stop) &&
          !reopenedStops.includes(stop)
        );

      const activeRouteOrder = [
        currentStop,
        ...normalTodoStops,
        ...reopenedStops
      ];

      const yourIndex = activeRouteOrder.indexOf(yourStop);

      if (yourIndex === -1) {
        statusCode = "completed_or_return";
        stopsBeforeYou = 0;
        etaMinutes = null;
      } else {
        statusCode = "on_the_way";
        stopsBeforeYou = yourIndex;

        if (stopsBeforeYou === 0) {
          etaMinutes = BASE_TRAVEL_MINUTES;
        } else {
          etaMinutes = BASE_TRAVEL_MINUTES + (stopsBeforeYou * MINUTES_PER_STOP);
        }
      }
    }
  }

  res.json({
    assignment,
    driverLocation,
    progress,
    stopsBeforeYou,
    statusCode,
    etaMinutes
  });
});

// =============================
// ROOT → LOGIN PAGE
// =============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
