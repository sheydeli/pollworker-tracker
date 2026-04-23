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

// UPDATE DRIVER GPS LOCATION
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

// UPDATE DRIVER CURRENT STOP
app.post("/update-driver-stop", (req, res) => {
  const { driverId, currentStop } = req.body;

  if (!driverProgress[driverId]) {
    driverProgress[driverId] = {};
  }

  driverProgress[driverId].currentStop = Number(currentStop);
  driverProgress[driverId].updatedAt = new Date().toISOString();

  res.json({ status: "updated" });
});

// GET ALL DRIVER LOCATIONS
app.get("/locations", (req, res) => {
  res.json(locations);
});

// GET SINGLE DRIVER LOCATION
app.get("/locations/:id", (req, res) => {
  const location = locations.find(l => l.id === req.params.id);

  if (!location) {
    return res.status(404).json({ error: "Driver not found" });
  }

  res.json(location);
});

// GET UNIQUE DRIVER LIST
app.get("/drivers", (req, res) => {
  const drivers = [...new Set(assignments.map(a => a.driverId))].sort();
  res.json(drivers);
});

// GET DRIVER ROUTE
app.get("/driver-route/:driverId", (req, res) => {
  const driverId = String(req.params.driverId);

  const route = assignments
    .filter(a => a.driverId === driverId)
    .sort((a, b) => a.stopNumber - b.stopNumber);

  if (!route.length) {
    return res.status(404).json({ error: "Driver route not found" });
  }

  const progress = driverProgress[driverId] || null;

  res.json({
    driverId,
    progress,
    route
  });
});

// ADMIN DASHBOARD DATA
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

// GET PRECINCT ASSIGNMENT + DRIVER INFO
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

  if (progress && typeof progress.currentStop === "number") {
    const currentStop = Number(progress.currentStop);
    const yourStop = Number(assignment.stopNumber);

    if (currentStop < yourStop) {
      statusCode = "on_the_way";
      stopsBeforeYou = yourStop - currentStop;
    } else if (currentStop === yourStop) {
      statusCode = "at_your_stop";
      stopsBeforeYou = 0;
    } else if (currentStop > yourStop) {
      statusCode = "past_your_stop";
      stopsBeforeYou = 0;
    }
  }

  res.json({
    assignment,
    driverLocation,
    progress,
    stopsBeforeYou,
    statusCode
  });
});

// ROOT → LOGIN PAGE
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
