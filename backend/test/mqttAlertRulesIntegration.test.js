
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  startMqttIngestion,
} = require('../src/services/mqttIngestionService');

const {
  getActiveAlerts,
} = require('../src/services/iotAlertService');

const {
  resetTelemetryForTests,
  getRecentReadings,
} = require('../src/services/iotTelemetryService');

const STATION_CODE = 'niah-station-01';
const STATION_UUID = 'station-uuid-1';
const TOPIC = `niah/telemetry/${STATION_CODE}`;

function sampleTelemetry(overrides = {}) {
  return {
    schema_version: 1,
    station_id: STATION_CODE,
    sequence: 1,
    uptime_ms: 1000,
    temperature_c: 27,
    humidity_pct: 75,
    dht_valid: true,
    soil_raw: 2000,
    soil_moisture_pct: 50,
    motion_detected: false,
    distance_cm: 100,
    distance_valid: true,
    rain_raw: 100,
    rain_intensity_pct: 10,
    ...overrides,
  };
}

function makeRule(id, metric, threshold, options = {}) {
  return {
    id,
    station_id: options.stationId ?? null,
    rule_name: id,
    metric,
    comparison_operator: options.operator ?? '>',
    threshold_value: threshold,
    severity: 'high',
    is_enabled: true,
  };
}

// A reusable mock for the Supabase query interface.
function fakeRuleDatabase(globalRules = [], stationRules = []) {
  return {
    from(table) {
      if (table === 'sensor_stations') {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              async single() {
                return {
                  data: { id: STATION_UUID },
                  error: null,
                };
              },
            };
          },
        };
      }

      if (table !== 'alert_rules') {
        throw new Error(`Unexpected table: ${table}`);
      }

      const query = {
        scope: 'station',

        select() {
          return this;
        },

        is() {
          this.scope = 'global';
          return this;
        },

        eq() {
          return this;
        },

        then(resolve, reject) {
          const data = this.scope === 'global'
            ? globalRules
            : stationRules;

          return Promise.resolve({
            data,
            error: null,
          }).then(resolve, reject);
        },
      };

      return query;
    },
  };
}

// Creates a fake MQTT client and exposes its message handler.
function createMqttHarness(options = {}) {
  const client = new EventEmitter();

  client.subscribe = (_topic, _options, callback) => callback(null);
  client.end = () => {};

  startMqttIngestion({
    connect: () => client,
    ruleClient: options.ruleClient ?? null,
    persistTelemetry: options.persistTelemetry ?? null,
    getCameraService: options.getCameraService,
  });

  const handler = client.listeners('message')[0];
  assert.equal(typeof handler, 'function');

  return {
    send(payload) {
      return handler(
        TOPIC,
        Buffer.from(JSON.stringify(payload))
      );
    },
  };
}

// Restores environment variables and test state after every scenario.
async function runScenario(options, verify) {
  const previousUrl = process.env.MQTT_URL;
  const originalError = console.error;
  const errors = [];

  process.env.MQTT_URL = 'mqtt://localhost:1883';
  resetTelemetryForTests();

  if (options.captureErrors) {
    console.error = (...args) => {
      errors.push(args.join(' '));
    };
  }

  try {
    const mqtt = createMqttHarness(options);
    await verify(mqtt, errors);
  } finally {
    console.error = originalError;
    resetTelemetryForTests();

    if (previousUrl === undefined) {
      delete process.env.MQTT_URL;
    } else {
      process.env.MQTT_URL = previousUrl;
    }
  }
}

test('MQTT uses database motion rules to create alerts', async () => {
  const motionRule = makeRule(
    'motion-rule',
    'movement_detected',
    1,
    { operator: '=' }
  );

  await runScenario({
    ruleClient: fakeRuleDatabase([motionRule]),
  }, async ({ send }) => {
    await send(sampleTelemetry({ motion_detected: true }));

    const alerts = getActiveAlerts();

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'motion_detected');
    assert.equal(alerts[0].rule_key, 'motion-rule');
  });
});

test('MQTT does not use hardcoded thresholds when rule loading fails', async () => {
  await runScenario({
    ruleClient: {
      from() {
        throw new Error('Database unavailable');
      },
    },
    captureErrors: true,
  }, async ({ send }, errors) => {
    await send(sampleTelemetry({ motion_detected: true }));

    assert.equal(getActiveAlerts().length, 0);
    assert.ok(
      errors.some((message) => message.includes('rule loading failed'))
    );
  });
});

test('MQTT preserves sensor reading order during slow persistence', async () => {
  let releaseFirst;

  const firstPersistence = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const persistTelemetry = async (payload) => {
    if (payload.sequence === 1) {
      await firstPersistence;
    }

    return { reading_id: `reading-${payload.sequence}` };
  };

  await runScenario({ persistTelemetry }, async ({ send }) => {
    try {
      const firstTask = send(sampleTelemetry({ sequence: 1 }));
      const secondTask = send(sampleTelemetry({ sequence: 2 }));

      releaseFirst();

      await Promise.all([firstTask, secondTask]);

      assert.deepEqual(
        getRecentReadings().map((reading) => reading.sequence),
        [2, 1]
      );
    } finally {
      releaseFirst();
    }
  });
});

test('MQTT applies station-specific rules instead of global rules', async () => {
  const globalRule = makeRule(
    'global-temp',
    'temperature_c',
    35
  );

  const stationRule = makeRule(
    'station-temp',
    'temperature_c',
    25,
    { stationId: STATION_UUID }
  );

  await runScenario({
    ruleClient: fakeRuleDatabase([globalRule], [stationRule]),
  }, async ({ send }) => {
    await send(sampleTelemetry());

    const alerts = getActiveAlerts();

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].rule_key, 'station-temp');
    assert.equal(alerts[0].threshold, 25);
    assert.equal(alerts[0].type, 'high_temperature');
  });
});

test('MQTT continues processing after a failed persistence request', async () => {
  const processedSequences = [];

  const persistTelemetry = async (payload) => {
    if (payload.sequence === 1) {
      throw new Error('Simulated persistence failure');
    }

    processedSequences.push(payload.sequence);

    return { reading_id: `reading-${payload.sequence}` };
  };

  await runScenario({
    persistTelemetry,
    captureErrors: true,
  }, async ({ send }) => {
    await send(sampleTelemetry({ sequence: 1 }));
    await send(sampleTelemetry({ sequence: 2 }));

    assert.deepEqual(processedSequences, [2]);

    assert.deepEqual(
      getRecentReadings().map((reading) => reading.sequence),
      [2]
    );
  });
});

test('cloud camera requires a new persisted proximity alert', async () => {
  const previousEnabled = process.env.CAMERA_ENABLED;
  const previousStorage = process.env.CAMERA_STORAGE_ENABLED;
  const captures = [];

  try {
    process.env.CAMERA_ENABLED = 'true';
    process.env.CAMERA_STORAGE_ENABLED = 'true';

    const proximityRule = makeRule(
      'proximity-rule',
      'movement_nearby_cm',
      50,
      { operator: '<=' }
    );

    await runScenario({
      ruleClient: fakeRuleDatabase([proximityRule]),
      persistTelemetry: async (payload) => ({
        reading_id: `reading-${payload.sequence}`,
        movement_alert_id:
          payload.sequence === 2 ? null : 'persisted-movement-alert',
      }),
      getCameraService: () => ({
        trigger: async (input) => {
          captures.push(input);
          return { outcome: 'captured' };
        },
      }),
    }, async ({ send }) => {
      const movement = {
        motion_detected: true,
        distance_valid: true,
        distance_cm: 10,
      };

      // A new database alert permits capture.
      await send(sampleTelemetry({
        ...movement,
        sequence: 1,
      }));

      assert.deepEqual(
        captures.map((item) => item.reading.sequence),
        [1]
      );
      assert.equal(captures[0].databaseReadingId, 'reading-1');

      // Database cooldown suppressed this alert.
      await send(sampleTelemetry({
        ...movement,
        sequence: 2,
      }));

      assert.deepEqual(
        captures.map((item) => item.reading.sequence),
        [1]
      );

      // A later reading with a new alert permits capture.
      await send(sampleTelemetry({
        ...movement,
        sequence: 3,
      }));

      assert.deepEqual(
        captures.map((item) => item.reading.sequence),
        [1, 3]
      );

      // Local-only camera mode remains supported.
      process.env.CAMERA_STORAGE_ENABLED = 'false';

      await send(sampleTelemetry({
        ...movement,
        sequence: 4,
      }));

      assert.deepEqual(
        captures.map((item) => item.reading.sequence),
        [1, 3, 4]
      );
    });
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.CAMERA_ENABLED;
    } else {
      process.env.CAMERA_ENABLED = previousEnabled;
    }

    if (previousStorage === undefined) {
      delete process.env.CAMERA_STORAGE_ENABLED;
    } else {
      process.env.CAMERA_STORAGE_ENABLED = previousStorage;
    }
  }
});