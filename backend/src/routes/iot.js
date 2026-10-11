const express = require('express');
const router = express.Router();

// Temporary IoT sensor data for testing
const sensorReadings = [
  {
    station_id: 1,
    temperature: 28.5,
    humidity: 75,
    status: 'online'
  },
  {
    station_id: 2,
    temperature: 30.2,
    humidity: 68,
    status: 'online'
  }
];

// GET all sensor readings
router.get('/readings', (req, res) => {
  res.json({
    message: 'Sensor readings retrieved successfully',
    data: sensorReadings
  });
});

// GET IoT dashboard summary
router.get('/summary', (req, res) => {
  const totalStations = sensorReadings.length;

  const onlineStations = sensorReadings.filter(
    sensor => sensor.status === 'online'
  ).length;

  res.json({
    message: 'IoT dashboard summary retrieved successfully',
    data: {
      total_stations: totalStations,
      online_stations: onlineStations,
      offline_stations: totalStations - onlineStations
    }
  });
});

module.exports = router;