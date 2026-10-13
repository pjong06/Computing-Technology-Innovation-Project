const latestByStation = new Map();
const recentReadings = [];
const MAX_RECENT_READINGS = 500;

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) {
    throw new Error(`${field} must be a non-empty string of at most 80 characters`);
  }
  return value;
}

function requireFiniteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function requireRange(value, field, minimum, maximum) {
  const number = requireFiniteNumber(value, field);
  if (number < minimum || number > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function validateTelemetry(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Telemetry payload must be a JSON object');
  }
  if (payload.schema_version !== 1) {
    throw new Error('Unsupported telemetry schema_version');
  }

  const reading = {
    schema_version: 1,
    station_id: requireString(payload.station_id, 'station_id'),
    sequence: requireRange(payload.sequence, 'sequence', 0, Number.MAX_SAFE_INTEGER),
    uptime_ms: requireRange(payload.uptime_ms, 'uptime_ms', 0, Number.MAX_SAFE_INTEGER),
    temperature_c: requireRange(payload.temperature_c, 'temperature_c', -50, 100),
    humidity_pct: requireRange(payload.humidity_pct, 'humidity_pct', 0, 100),
    dht_valid: requireBoolean(payload.dht_valid, 'dht_valid'),
    soil_raw: requireRange(payload.soil_raw, 'soil_raw', 0, 4095),
    soil_moisture_pct: requireRange(payload.soil_moisture_pct, 'soil_moisture_pct', 0, 100),
    motion_detected: requireBoolean(payload.motion_detected, 'motion_detected'),
    distance_cm: requireRange(payload.distance_cm, 'distance_cm', 0, 1000),
    distance_valid: requireBoolean(payload.distance_valid, 'distance_valid'),
    rain_raw: requireRange(payload.rain_raw, 'rain_raw', 0, 4095),
    rain_intensity_pct: requireRange(payload.rain_intensity_pct, 'rain_intensity_pct', 0, 100),
  };

  return reading;
}

function ingestTelemetry(payload, receivedAt = new Date()) {
  const reading = {
    ...validateTelemetry(payload),
    received_at: receivedAt.toISOString(),
  };

  latestByStation.set(reading.station_id, reading);
  recentReadings.push(reading);
  if (recentReadings.length > MAX_RECENT_READINGS) recentReadings.shift();
  return reading;
}

function getLatestReadings() {
  return Array.from(latestByStation.values());
}

function getRecentReadings(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  return recentReadings.slice(-safeLimit).reverse();
}

function getSummary(now = new Date()) {
  const offlineAfterMs = 60_000;
  const latest = getLatestReadings();
  const onlineStations = latest.filter(
    (reading) => now.getTime() - new Date(reading.received_at).getTime() <= offlineAfterMs
  ).length;

  return {
    total_stations: latest.length,
    online_stations: onlineStations,
    offline_stations: latest.length - onlineStations,
  };
}

function resetTelemetryForTests() {
  latestByStation.clear();
  recentReadings.length = 0;
}

module.exports = {
  validateTelemetry,
  ingestTelemetry,
  getLatestReadings,
  getRecentReadings,
  getSummary,
  resetTelemetryForTests,
};
