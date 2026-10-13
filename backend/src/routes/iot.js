const express = require('express');
const router = express.Router();

// GET sensor readings directly from Supabase
router.get('/readings/history', async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('sensor_readings')
      .select(`
        id,
        station_id,
        recorded_at,
        received_at,
        temperature_c,
        humidity_percent,
        movement_detected,
        vibration_level,
        battery_percent
      `)
      .order('recorded_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('IoT readings error:', error);

      return res.status(500).json({
        message: 'Failed to retrieve sensor readings'
      });
    }

    return res.json({
      message: 'Sensor readings retrieved successfully',
      data: data
    });

  } catch (error) {
    console.error('IoT backend error:', error);

    return res.status(500).json({
      message: 'Internal server error'
    });
  }
});

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

// GET IoT dashboard summary from Supabase
router.get('/summary', async (req, res) => {
  try {
    const { data: stations, error } = await req.supabase
      .from('sensor_stations')
      .select('id, station_code, station_status, last_seen_at');

    if (error) {
      console.error('IoT summary error:', error);

      return res.status(500).json({
        message: 'Failed to retrieve IoT dashboard summary'
      });
    }

    const totalStations = stations.length;

    const onlineStations = stations.filter(
      station => station.station_status === 'online'
    ).length;

    const offlineStations = stations.filter(
      station => station.station_status === 'offline'
    ).length;

    return res.json({
      message: 'IoT dashboard summary retrieved successfully',
      data: {
        total_stations: totalStations,
        online_stations: onlineStations,
        offline_stations: offlineStations
      }
    });

  } catch (error) {
    console.error('IoT summary error:', error);

    return res.status(500).json({
      message: 'Internal server error'
    });
  }
});
// GET IoT dashboard summary directly from Supabase
router.get('/summary/database', async (req, res) => {
  res.json({
    message: 'IoT dashboard summary retrieved successfully',
    data: getSummary(),
  });
});

// GET recent IoT alerts from Supabase
router.get('/alerts', async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('alerts')
      .select(`
        id,
        station_id,
        reading_id,
        alert_message,
        severity,
        alert_status,
        triggered_at,
        acknowledged_by,
        acknowledged_at,
        resolved_by,
        resolved_at
      `)
      .order('triggered_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('IoT alerts error:', error);
      return res.status(500).json({
        message: 'Failed to retrieve IoT alerts'
      });
    }

    return res.json({
      message: 'IoT alerts retrieved successfully',
      data
    });
  } catch (error) {
    console.error('IoT alerts error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
});

module.exports = router;
