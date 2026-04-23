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

  // if stop changes manually, reset arrived unless re-marked
  if (driverProgress[driverId].arrivedStop !== Number(currentStop)) {
    driverProgress[driverId].arrived = false;
    driverProgress[driverId].arrivedStop = null;
  }

  res.json({ status: "updated" });
});

// MARK DRIVER ARRIVED
app.post("/driver-arrived", (req, res) => {
  const { driverId, currentStop } = req.body;

  if (!driverProgress[driverId]) {
    driverProgress[driverId] = {};
  }

  driverProgress[driverId].currentStop = Number(currentStop);
  driverProgress[driverId].arrived = true;
  driverProgress[driverId].arrivedStop = Number(currentStop);
  driverProgress[driverId].updatedAt = new Date().toISOString();

  res.json({ status: "arrived recorded" });
});

// MARK DRIVER LEFT CURRENT STOP
app.post("/driver-left-stop", (req, res) => {
  const { driverId } = req.body;

  if (!driverProgress[driverId]) {
    driverProgress[driverId] = {};
  }

  driverProgress[driverId].arrived = false;
  driverProgress[driverId].arrivedStop = null;
  driverProgress[driverId].updatedAt = new Date().toISOString();

  res.json({ status: "left stop recorded" });
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

// GET PRECINCT ASSIGNMENT + DRIVER INFO
app.get("/assignment/:precinct", (req, res) => {
  const precinct = String(req.params.precinct);

  if (!validPrecincts.has(precinct)) {
    return res.status(404).json({ error: "Invalid precinct" });
  }

  const assignment = assignments.find(a => a.precinct === precinct);
  const driverLocation = locations.find(l => l.id === assignment.driverId);
  const progress = driverProgress[assignment.driverId] || null;

  let stopsBeforeYou = null;
  let driverAtYourStop = false;

  if (progress && typeof progress.currentStop === "number") {
    stopsBeforeYou = Math.max(assignment.stopNumber - progress.currentStop, 0);

    if (
      progress.arrived === true &&
      progress.arrivedStop === assignment.stopNumber
    ) {
      driverAtYourStop = true;
      stopsBeforeYou = 0;
    }
  }

  res.json({
    assignment,
    driverLocation,
    progress,
    stopsBeforeYou,
    driverAtYourStop
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
