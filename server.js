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

// DRIVER LOCATION UPDATE
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

// DRIVER STOP UPDATE
app.post("/update-driver-stop", (req, res) => {
  const { driverId, currentStop } = req.body;

  driverProgress[driverId] = {
    currentStop: Number(currentStop),
    updatedAt: new Date().toISOString()
  };

  res.json({ status: "updated" });
});

// GET ALL DRIVER LOCATIONS
app.get("/locations", (req, res) => {
  res.json(locations);
});

// GET SINGLE DRIVER
app.get("/locations/:id", (req, res) => {
  const location = locations.find(l => l.id === req.params.id);

  if (!location) {
    return res.status(404).json({ error: "Driver not found" });
  }

  res.json(location);
});

// PRECINCT LOOKUP
app.get("/assignment/:precinct", (req, res) => {
  const precinct = String(req.params.precinct);

  if (!validPrecincts.has(precinct)) {
    return res.status(404).json({ error: "Invalid precinct" });
  }

  const assignment = assignments.find(a => a.precinct === precinct);
  const driverLocation = locations.find(l => l.id === assignment.driverId);
  const progress = driverProgress[assignment.driverId] || null;

  let stopsBeforeYou = null;
  if (progress) {
    stopsBeforeYou = Math.max(
      assignment.stopNumber - progress.currentStop,
      0
    );
  }

  res.json({
    assignment,
    driverLocation,
    progress,
    stopsBeforeYou
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
