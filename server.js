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
const BUFFER_MINUTES = 10;

const NEAR_RADIUS_FEET = 1000;
const AT_STOP_RADIUS_FEET = 300;
const LEAVE_RADIUS_FEET = 600;

function feetBetween(lat1, lon1, lat2, lon2) {
  const R = 20902231;
  const toRad = deg => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDriverRoute(driverId) {
  return assignments
    .filter(a => a.driverId === driverId)
    .sort((a, b) => a.stopNumber - b.stopNumber);
}

function ensureProgress(driverId) {
  if (!driverProgress[driverId]) {
    driverProgress[driverId] = {
      currentStop: null,
      completedStops: [],
      reopenedStops: [],
      stopStatus: "not_started",
      hasEnteredCurrentStop: false,
      updatedAt: null
    };
  }

  return driverProgress[driverId];
}

function getActiveRouteOrder(driverId) {
  const route = getDriverRoute(driverId);
  const progress = ensureProgress(driverId);

  const completedStops = (progress.completedStops || []).map(Number);
  const reopenedStops = (progress.reopenedStops || []).map(Number);

  const normalStops = route
    .map(a => Number(a.stopNumber))
    .filter(stop =>
      !completedStops.includes(stop) &&
      !reopenedStops.includes(stop)
    );

  return [...normalStops, ...reopenedStops];
}

function getStopByNumber(driverId, stopNumber) {
  return getDriverRoute(driverId).find(
    a => Number(a.stopNumber) === Number(stopNumber)
  );
}

function autoUpdateDriverProgress(driverId, lat, lon) {
  const progress = ensureProgress(driverId);
  const activeStops = getActiveRouteOrder(driverId);

  if (!activeStops.length) {
    progress.currentStop = null;
    progress.stopStatus = "route_complete";
    progress.updatedAt = new Date().toISOString();
    return;
  }

  if (!progress.currentStop || progress.completedStops.includes(progress.currentStop)) {
    progress.currentStop = activeStops[0];
    progress.stopStatus = "on_the_way";
    progress.hasEnteredCurrentStop = false;
  }

  const currentStopAssignment = getStopByNumber(driverId, progress.currentStop);

  if (
    !currentStopAssignment ||
    currentStopAssignment.lat === undefined ||
    currentStopAssignment.lon === undefined
  ) {
    progress.stopStatus = "on_the_way";
    progress.updatedAt = new Date().toISOString();
    return;
  }

  const distanceFeet = feetBetween(
    Number(lat),
    Number(lon),
    Number(currentStopAssignment.lat),
    Number(currentStopAssignment.lon)
  );

  if (distanceFeet <= AT_STOP_RADIUS_FEET) {
    progress.stopStatus = "at_stop";
    progress.hasEnteredCurrentStop = true;
  } else if (distanceFeet <= NEAR_RADIUS_FEET) {
    progress.stopStatus = "nearby";
    progress.hasEnteredCurrentStop = true;
  } else if (
    progress.hasEnteredCurrentStop &&
    distanceFeet > LEAVE_RADIUS_FEET
  ) {
    if (!progress.completedStops.includes(progress.currentStop)) {
      progress.completedStops.push(progress.currentStop);
    }

    progress.reopenedStops = progress.reopenedStops.filter(
      s => Number(s) !== Number(progress.currentStop)
    );

    const nextActiveStops = getActiveRouteOrder(driverId);

    progress.currentStop = nextActiveStops.length ? nextActiveStops[0] : null;
    progress.stopStatus = progress.currentStop ? "on_the_way" : "route_complete";
    progress.hasEnteredCurrentStop = false;
  } else {
    progress.stopStatus = "on_the_way";
  }

  progress.updatedAt = new Date().toISOString();
}

// GPS UPDATE + AUTO ROUTE PROGRESS
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

  autoUpdateDriverProgress(id, lat, lon);

  res.json({
    status: "updated",
    progress: driverProgress[id]
  });
});

// MANUAL OVERRIDE STILL AVAILABLE
app.post("/update-driver-stop", (req, res) => {
  const { driverId, currentStop } = req.body;
  const newStop = Number(currentStop);

  const progress = ensureProgress(driverId);
  const oldStop = progress.currentStop;

  if (
    oldStop !== null &&
    oldStop !== newStop &&
    !progress.completedStops.includes(oldStop)
  ) {
    progress.completedStops.push(oldStop);
  }

  progress.currentStop = newStop;
  progress.stopStatus = "on_the_way";
  progress.hasEnteredCurrentStop = false;
  progress.updatedAt = new Date().toISOString();
  progress.reopenedStops = progress.reopenedStops.filter(s => s !== newStop);

  res.json({
    status: "updated",
    currentStop: progress.currentStop,
    completedStops: progress.completedStops,
    reopenedStops: progress.reopenedStops
  });
});

app.post("/reopen-stop", (req, res) => {
  const { driverId, stopNumber } = req.body;
  const stop = Number(stopNumber);

  const progress = ensureProgress(driverId);

  progress.completedStops = progress.completedStops.filter(s => s !== stop);

  if (!progress.reopenedStops.includes(stop)) {
    progress.reopenedStops.push(stop);
  }

  progress.updatedAt = new Date().toISOString();

  res.json({ status: "reopened" });
});

app.post("/reset-driver", (req, res) => {
  const { driverId } = req.body;

  driverProgress[driverId] = {
    currentStop: null,
    completedStops: [],
    reopenedStops: [],
    stopStatus: "not_started",
    hasEnteredCurrentStop: false,
    updatedAt: new Date().toISOString()
  };

  res.json({ status: "reset" });
});

app.get("/locations", (req, res) => {
  res.json(locations);
});

app.get("/locations/:id", (req, res) => {
  const location = locations.find(l => l.id === req.params.id);

  if (!location) {
    return res.status(404).json({ error: "Driver not found" });
  }

  res.json(location);
});

app.get("/drivers", (req, res) => {
  const drivers = [...new Set(assignments.map(a => a.driverId))].sort();
  res.json(drivers);
});

app.get("/driver-route/:driverId", (req, res) => {
  const driverId = String(req.params.driverId);

  const route = getDriverRoute(driverId);

  const progress = driverProgress[driverId] || {
    currentStop: null,
    completedStops: [],
    reopenedStops: [],
    stopStatus: "not_started"
  };

  res.json({ driverId, progress, route });
});

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
    const driverRoute = getDriverRoute(assignment.driverId);

    const currentStop = Number(progress.currentStop);
    const yourStop = Number(assignment.stopNumber);
    const completedStops = (progress.completedStops || []).map(Number);
    const reopenedStops = (progress.reopenedStops || []).map(Number);

    const isCompleted = completedStops.includes(yourStop);
    const isReopened = reopenedStops.includes(yourStop);

    if (isCompleted && !isReopened) {
      statusCode = "completed_or_return";
    } else {
      const normalStops = driverRoute
        .map(a => Number(a.stopNumber))
        .filter(stop =>
          stop !== currentStop &&
          !completedStops.includes(stop) &&
          !reopenedStops.includes(stop)
        );

      const activeRoute = [
        currentStop,
        ...normalStops,
        ...reopenedStops
      ];

      const index = activeRoute.indexOf(yourStop);

      if (index === -1) {
        statusCode = "completed_or_return";
      } else {
        stopsBeforeYou = index;

        if (yourStop === currentStop) {
          if (progress.stopStatus === "at_stop") {
            statusCode = "at_stop";
          } else if (progress.stopStatus === "nearby") {
            statusCode = "nearby";
          } else {
            statusCode = "on_the_way";
          }
        } else {
          statusCode = "on_the_way";
        }

        etaMinutes =
          BASE_TRAVEL_MINUTES +
          (index * MINUTES_PER_STOP) +
          BUFFER_MINUTES;
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
