const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ingestTelemetry,
  getLatestReadings,
  getRecentReadings,
  getSummary,
  resetTelemetryForTests,
} = require('../src/services/iotTelemetryService');

function validPayload(overrides = {}) {
  return {
    schema_version: 1,
    station_id: 'niah-station-01',
    sequence: 1,
    uptime_ms: 10_000,
    temperature_c: 27.4,
    humidity_pct: 81.2,
    dht_valid: true,
    soil_raw: 2200,
    soil_moisture_pct: 50,
    motion_detected: false,
    distance_cm: 42.3,
    distance_valid: true,
    rain_raw: 3900,
    rain_intensity_pct: 6,
    ...overrides,
  };
}

test.beforeEach(resetTelemetryForTests);

test('ingests a valid reading and exposes it as latest and recent', () => {
  const receivedAt = new Date('2026-10-12T04:00:00.000Z');
  const reading = ingestTelemetry(validPayload(), receivedAt);

  assert.equal(reading.received_at, receivedAt.toISOString());
  assert.deepEqual(getLatestReadings(), [reading]);
  assert.deepEqual(getRecentReadings(), [reading]);
});

test('rejects telemetry outside the expected sensor ranges', () => {
  assert.throws(
    () => ingestTelemetry(validPayload({ humidity_pct: 120 })),
    /humidity_pct must be between 0 and 100/
  );
});

test('marks stations offline after sixty seconds without telemetry', () => {
  ingestTelemetry(validPayload(), new Date('2026-10-12T04:00:00.000Z'));

  assert.deepEqual(getSummary(new Date('2026-10-12T04:00:30.000Z')), {
    total_stations: 1,
    online_stations: 1,
    offline_stations: 0,
  });
  assert.deepEqual(getSummary(new Date('2026-10-12T04:01:01.000Z')), {
    total_stations: 1,
    online_stations: 0,
    offline_stations: 1,
  });
});
