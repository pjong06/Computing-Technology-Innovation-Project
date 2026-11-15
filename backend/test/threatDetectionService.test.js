const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AlertStatus,
  processTelemetryForAlerts,
  getAlerts,
  getActiveAlerts,
  resetAlertsForTests,
} = require('../src/services/iotAlertService');
const { ThreatType } = require('../src/services/threatDetectionService');
const {
  ingestTelemetry,
  resetTelemetryForTests,
} = require('../src/services/iotTelemetryService');

const TEST_THRESHOLDS = Object.freeze({
  high_temperature_c: 35,
  low_soil_moisture_pct: 20,
  proximity_cm: 50,
  heavy_rain_pct: 70,
});

function reading(overrides = {}) {
  return {
    schema_version: 1,
    station_id: 'niah-station-01',
    sequence: 1,
    uptime_ms: 10_000,
    temperature_c: 28,
    humidity_pct: 80,
    dht_valid: true,
    soil_raw: 2200,
    soil_moisture_pct: 50,
    motion_detected: false,
    distance_cm: 150,
    distance_valid: true,
    rain_raw: 3900,
    rain_intensity_pct: 5,
    received_at: '2026-10-13T04:00:00.000Z',
    ...overrides,
  };
}

function process(payload) {
  return processTelemetryForAlerts(payload, { thresholds: TEST_THRESHOLDS });
}

test.beforeEach(() => {
  resetTelemetryForTests();
  resetAlertsForTests();
});

test('normal telemetry creates no alerts', () => {
  const changes = process(reading());

  assert.deepEqual(changes, { created: [], updated: [], resolved: [] });
  assert.deepEqual(getActiveAlerts(), []);
});

test('validated telemetry ingestion automatically runs threat detection', () => {
  ingestTelemetry(reading({ temperature_c: 36 }));

  assert.equal(getActiveAlerts().length, 1);
  assert.equal(getActiveAlerts()[0].type, ThreatType.HIGH_TEMPERATURE);
});

test('creates alerts for every supported threat type', () => {
  const changes = process(reading({
    temperature_c: 36,
    soil_moisture_pct: 15,
    motion_detected: true,
    distance_cm: 40,
    rain_intensity_pct: 80,
  }));

  assert.deepEqual(
    new Set(changes.created.map((alert) => alert.type)),
    new Set(Object.values(ThreatType)),
  );
  assert.equal(getActiveAlerts().length, 5);
});

test('continuing threat updates one active alert instead of duplicating it', () => {
  const first = process(reading({ motion_detected: true }));
  const second = process(reading({
    sequence: 2,
    motion_detected: true,
    received_at: '2026-10-13T04:00:10.000Z',
  }));

  assert.equal(first.created.length, 1);
  assert.equal(second.created.length, 0);
  assert.equal(second.updated.length, 1);
  assert.equal(getActiveAlerts().length, 1);
  assert.equal(getActiveAlerts()[0].id, first.created[0].id);
  assert.equal(getActiveAlerts()[0].occurrence_count, 2);
});

test('normal reading resolves an active alert', () => {
  const opened = process(reading({ motion_detected: true }));
  const recovered = process(reading({
    sequence: 2,
    motion_detected: false,
    received_at: '2026-10-13T04:00:10.000Z',
  }));

  assert.equal(recovered.resolved.length, 1);
  assert.equal(recovered.resolved[0].id, opened.created[0].id);
  assert.equal(recovered.resolved[0].status, AlertStatus.RESOLVED);
  assert.equal(recovered.resolved[0].resolved_at, '2026-10-13T04:00:10.000Z');
  assert.deepEqual(getActiveAlerts(), []);
});

test('threat after recovery creates a new alert and preserves history', () => {
  const first = process(reading({ motion_detected: true }));
  process(reading({ sequence: 2, motion_detected: false }));
  const repeated = process(reading({ sequence: 3, motion_detected: true }));

  assert.equal(repeated.created.length, 1);
  assert.notEqual(repeated.created[0].id, first.created[0].id);
  assert.equal(getAlerts().length, 2);
  assert.deepEqual(
    new Set(getAlerts().map((alert) => alert.status)),
    new Set([AlertStatus.ACTIVE, AlertStatus.RESOLVED]),
  );
});

test('invalid DHT reading neither creates nor resolves a temperature alert', () => {
  const opened = process(reading({ temperature_c: 36 }));
  const invalid = process(reading({
    sequence: 2,
    temperature_c: 0,
    dht_valid: false,
  }));

  assert.equal(opened.created[0].type, ThreatType.HIGH_TEMPERATURE);
  assert.deepEqual(invalid.resolved, []);
  assert.equal(getActiveAlerts()[0].id, opened.created[0].id);
});

test('invalid distance reading neither creates nor resolves a proximity alert', () => {
  const opened = process(reading({ distance_cm: 40 }));
  const invalid = process(reading({
    sequence: 2,
    distance_cm: 0,
    distance_valid: false,
  }));

  assert.equal(opened.created[0].type, ThreatType.PROXIMITY_BREACH);
  assert.deepEqual(invalid.resolved, []);
  assert.equal(getActiveAlerts()[0].id, opened.created[0].id);
});

test('the same threat at different stations creates independent alerts', () => {
  process(reading({ motion_detected: true }));
  process(reading({
    station_id: 'niah-station-02',
    motion_detected: true,
  }));

  const active = getActiveAlerts();
  assert.equal(active.length, 2);
  assert.notEqual(active[0].id, active[1].id);
  assert.deepEqual(
    new Set(active.map((alert) => alert.station_id)),
    new Set(['niah-station-01', 'niah-station-02']),
  );
});

test('prototype thresholds can be overridden with validated environment values', () => {
  const { getThreatThresholds } = require('../src/config/iotThreatConfig');

  assert.deepEqual(getThreatThresholds({
    IOT_HIGH_TEMPERATURE_C: '38',
    IOT_LOW_SOIL_MOISTURE_PCT: '25',
    IOT_PROXIMITY_CM: '75',
    IOT_HEAVY_RAIN_PCT: '85',
  }), {
    high_temperature_c: 38,
    low_soil_moisture_pct: 25,
    proximity_cm: 75,
    heavy_rain_pct: 85,
  });
});

test('invalid configured threshold is rejected', () => {
  const { getThreatThresholds } = require('../src/config/iotThreatConfig');

  assert.throws(
    () => getThreatThresholds({ IOT_HEAVY_RAIN_PCT: '120' }),
    /IOT_HEAVY_RAIN_PCT must be a number between 0 and 100/,
  );
});

test('database alert rules override prototype thresholds', () => {
  const changes = processTelemetryForAlerts(
    reading({
      temperature_c: 36,
      soil_moisture_pct: 50,
      motion_detected: false,
      distance_cm: 150,
      rain_intensity_pct: 5,
    }),
    {
      databaseRules: [
        {
          station_id: null,
          rule_name: 'High temperature at 40 C',
          metric: 'temperature_c',
          comparison_operator: '>=',
          threshold_value: 40,
          severity: 'high',
          is_enabled: true,
        },
      ],
    },
  );

  assert.equal(changes.created.length, 0);
  assert.deepEqual(getActiveAlerts(), []);
});

test('multiple database rules for the same sensor create separate alerts', () => {
  const changes = processTelemetryForAlerts(
    reading({ temperature_c: 42 }),
    {
      databaseRules: [
        {
          id: 'temperature-rule-35',
          station_id: null,
          rule_name: 'High temperature',
          metric: 'temperature_c',
          comparison_operator: '>=',
          threshold_value: 35,
          severity: 'high',
          is_enabled: true,
        },
        {
          id: 'temperature-rule-40',
          station_id: null,
          rule_name: 'Very high temperature',
          metric: 'temperature_c',
          comparison_operator: '>=',
          threshold_value: 40,
          severity: 'high',
          is_enabled: true,
        },
      ],
    },
  );

  assert.equal(changes.created.length, 2);
  assert.equal(getActiveAlerts().length, 2);
  assert.deepEqual(
    new Set(changes.created.map((alert) => alert.message)),
    new Set(['High temperature', 'Very high temperature']),
  );
});

test('database rules resolve independently for the same sensor', () => {
  const databaseRules = [
    {
      id: 'temperature-rule-35',
      station_id: null,
      rule_name: 'High temperature',
      metric: 'temperature_c',
      comparison_operator: '>=',
      threshold_value: 35,
      severity: 'high',
      is_enabled: true,
    },
    {
      id: 'temperature-rule-40',
      station_id: null,
      rule_name: 'Very high temperature',
      metric: 'temperature_c',
      comparison_operator: '>=',
      threshold_value: 40,
      severity: 'high',
      is_enabled: true,
    },
  ];

  const first = processTelemetryForAlerts(
    reading({ temperature_c: 42 }),
    { databaseRules },
  );

  assert.equal(first.created.length, 2);

  const second = processTelemetryForAlerts(
    reading({ temperature_c: 37, sequence: 2 }),
    { databaseRules },
  );

  assert.equal(second.resolved.length, 1);
  assert.equal(second.updated.length, 1);
  assert.equal(getActiveAlerts().length, 1);
  assert.equal(getActiveAlerts()[0].message, 'High temperature');
});


test('removing a database rule resolves its existing alert', () => {
  const databaseRules = [
    {
      id: 'temperature-rule-35',
      station_id: null,
      rule_name: 'High temperature',
      metric: 'temperature_c',
      comparison_operator: '>=',
      threshold_value: 35,
      severity: 'high',
      is_enabled: true,
    },
  ];

  // First reading creates an active alert.
  const first = processTelemetryForAlerts(
    reading({ temperature_c: 42 }),
    { databaseRules },
  );

  assert.equal(first.created.length, 1);
  assert.equal(getActiveAlerts().length, 1);

  // The rule is disabled and no longer returned by the database.
  const second = processTelemetryForAlerts(
    reading({ temperature_c: 42, sequence: 2 }),
    { databaseRules: [] },
  );

  assert.equal(second.resolved.length, 1);
  assert.equal(getActiveAlerts().length, 0);
  assert.equal(second.resolved[0].rule_key, 'temperature-rule-35');
});
