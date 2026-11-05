const express = require('express');
const { timingSafeEqual, createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { validateTelemetry } = require('../services/iotTelemetryService');

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function createIngestionRouter(env = process.env, injectedClient) {
  const router = express.Router();
  const token = env.IOT_INGESTION_TOKEN;
  const device = env.IOT_INGESTION_STATION_CODE;
  let client = injectedClient;
  if (env.IOT_INGESTION_SERVER_ENABLED === 'true') {
    if (!token || token.length < 32 || !device) {
      throw new Error('Ingestion requires a token of at least 32 characters and one station code');
    }
    if (!client) {
      if (!env.IOT_DATABASE_SERVER_KEY) throw new Error('IOT_DATABASE_SERVER_KEY is required');
      client = createClient(env.SUPABASE_URL, env.IOT_DATABASE_SERVER_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }

  router.post('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (env.IOT_INGESTION_SERVER_ENABLED !== 'true') return res.sendStatus(503);
    const supplied = req.get('authorization') || '';
    if (!timingSafeEqual(digest(supplied), digest(`Bearer ${token}`))) {
      return res.sendStatus(401);
    }
    let reading;
    try { reading = validateTelemetry(req.body); }
    catch { return res.status(400).json({ message: 'Invalid telemetry' }); }
    if (reading.station_id !== device) return res.sendStatus(403);
    try {
      const station = await client.from('sensor_stations')
        .select('id').eq('station_code', device).eq('station_status', 'active').single();
      if (station.error && station.error.code !== 'PGRST116') return res.sendStatus(503);
      if (station.error || !station.data) return res.sendStatus(403);
      const inserted = await client.from('sensor_readings').insert({
        station_id: station.data.id,
        recorded_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
        temperature_c: reading.dht_valid ? reading.temperature_c : null,
        humidity_percent: reading.dht_valid ? reading.humidity_pct : null,
        movement_detected: reading.motion_detected,
        soil_raw: reading.soil_raw,
        soil_moisture_pct: reading.soil_moisture_pct,
        distance_cm: reading.distance_valid ? reading.distance_cm : null,
        distance_valid: reading.distance_valid,
        rain_raw: reading.rain_raw,
        rain_intensity_pct: reading.rain_intensity_pct,
        dht_valid: reading.dht_valid,
        sequence: reading.sequence,
        uptime_ms: reading.uptime_ms,
      }).select('id').single();
      if (inserted.error) return res.sendStatus(503);
      return res.status(201).json({ reading_id: inserted.data.id });
    } catch { return res.sendStatus(503); }
  });
  return router;
}

module.exports = { createIngestionRouter };
