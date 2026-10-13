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

const { getAlerts, getActiveAlerts } = require('../services/iotAlertService');

// The entire /api/iot router is protected by officer authentication in server.js.
router.get('/alerts', (req, res) => {
  const status = req.query.status || 'all';
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);

  if (!['all', 'active', 'resolved'].includes(status)) {
    return res.status(400).json({ message: 'Invalid alert status' });
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return res.status(400).json({ message: 'limit must be an integer from 1 to 500' });
  }

  const active = getActiveAlerts();

  res.json({
    data: getAlerts({
      status: status === 'all' ? undefined : status,
      limit,
    }),
    summary: {
      active: active.length,
      critical: active.filter((alert) => alert.severity === 'critical').length,
      warning: active.filter((alert) => alert.severity === 'warning').length,
    },
  });
});


module.exports = router;
