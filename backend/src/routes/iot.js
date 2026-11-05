const express = require('express');
const router = express.Router();
router.use(require('../middleware/iotAccess'));
const { recentIotQuery } = require('../services/recentIotQuery');

const {
  getLatestReadings,
  getRecentReadings,
  getSummary,
} = require('../services/iotTelemetryService');

const {
  getAlerts,
  getActiveAlerts,
} = require('../services/iotAlertService');

// GET sensor readings directly from Supabase
router.get('/readings/history', recentIotQuery({
  table: 'sensor_readings', columns: 'id,station_id,recorded_at,received_at,temperature_c,humidity_percent,movement_detected,soil_raw,soil_moisture_pct,distance_cm,distance_valid,rain_raw,rain_intensity_pct,dht_valid,sequence,uptime_ms,vibration_level,battery_percent',
  orderBy: 'recorded_at', message: 'Sensor readings retrieved successfully', failure: 'Failed to retrieve sensor readings',
}));

// GET recent readings from in-memory MQTT telemetry
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

// GET IoT dashboard summary from Supabase
router.get('/summary', async (req, res) => {
  try {
    const { data: stations, error } = await req.supabase
      .from('sensor_stations')
      .select('id, station_code, station_status, last_seen_at');

    if (error) {
      console.error('IoT summary error:', error);
      return res.status(500).json({
        message: 'Failed to retrieve IoT dashboard summary',
      });
    }

    const totalStations = stations.length;
    const activeStations = stations.filter(
      (station) => station.station_status === 'active'
    ).length;

    return res.json({
      message: 'IoT dashboard summary retrieved successfully',
      data: {
        total_stations: totalStations,
        active_stations: activeStations,
      },
    });
  } catch (error) {
    console.error('IoT summary error:', error);
    return res.status(500).json({
      message: 'Internal server error',
    });
  }
});

// GET live IoT dashboard summary from in-memory MQTT telemetry
router.get('/summary/live', (_req, res) => {
  res.json({
    message: 'IoT dashboard summary retrieved successfully',
    data: getSummary(),
  });
});

// GET recent IoT alerts from Supabase (group member's endpoint)
router.get('/alerts', recentIotQuery({
  table: 'alerts', columns: 'id,station_id,reading_id,alert_message,severity,alert_status,triggered_at,acknowledged_by,acknowledged_at,resolved_by,resolved_at,resolution_notes',
  orderBy: 'triggered_at', message: 'IoT alerts retrieved successfully', failure: 'Failed to retrieve IoT alerts',
}));

// GET Task 5.4 live alerts from backend memory (your 5.6 panel)
router.get('/alerts/live', (req, res) => {
  const status = req.query.status || 'all';
  const limit = req.query.limit === undefined
    ? 100
    : Number(req.query.limit);

  if (!['all', 'active', 'resolved'].includes(status)) {
    return res.status(400).json({
      message: 'Invalid alert status',
    });
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return res.status(400).json({
      message: 'limit must be an integer from 1 to 500',
    });
  }

  const active = getActiveAlerts();

  return res.json({
    data: getAlerts({
      status: status === 'all' ? undefined : status,
      limit,
    }),
    summary: {
      active: active.length,
      critical: active.filter(
        (alert) => alert.severity === 'critical'
      ).length,
      warning: active.filter(
        (alert) => alert.severity === 'warning'
      ).length,
    },
  });
});

router.use(require('./iotAlertActions'));
module.exports = router;
