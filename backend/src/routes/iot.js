const express = require('express');
const router = express.Router();
const {
  getLatestReadings,
  getRecentReadings,
  getSummary,
} = require('../services/iotTelemetryService');

// GET all sensor readings
router.get('/readings', (req, res) => {
  res.json({
    message: 'Sensor readings retrieved successfully',
    data: getRecentReadings(req.query.limit),
  });
});

router.get('/latest', (_req, res) => {
  res.json({
    message: 'Latest station readings retrieved successfully',
    data: getLatestReadings(),
  });
});

// GET IoT dashboard summary
router.get('/summary', (req, res) => {
  res.json({
    message: 'IoT dashboard summary retrieved successfully',
    data: getSummary(),
  });
});

module.exports = router;
