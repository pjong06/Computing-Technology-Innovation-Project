
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  startMqttIngestion,
} = require('../src/services/mqttIngestionService');

const {
  getActiveAlerts,
  resetAlertsForTests,
} = require('../src/services/iotAlertService');

const {
  resetTelemetryForTests,
  getRecentReadings,
} = require('../src/services/iotTelemetryService');

function sampleTelemetry(motionDetected = true) {
  return {
    schema_version: 1,
    station_id: 'niah-station-01',
    sequence: 1,
    uptime_ms: 1000,
    temperature_c: 27,
    humidity_pct: 75,
    dht_valid: true,
    soil_raw: 2000,
    soil_moisture_pct: 50,
    motion_detected: motionDetected,
    distance_cm: 100,
    distance_valid: true,
    rain_raw: 100,
    rain_intensity_pct: 10,
  };
}

function fakeMqttClient() {
  const client = new EventEmitter();

  client.subscribe = (_topic, _options, callback) => {
    callback(null);
  };

  client.end = () => {};

  return client;
}

test('MQTT uses database motion rules to create alerts', async () => {
  const previousUrl = process.env.MQTT_URL;
  process.env.MQTT_URL = 'mqtt://localhost:1883';

  resetTelemetryForTests();

  const client = fakeMqttClient();

  const ruleClient = {
    from(table) {
      if (table === 'sensor_stations') {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              single: async () => ({
                data: { id: 'station-uuid-1' },
                error: null,
              }),
            };
          },
        };
      }

      if (table === 'alert_rules') {
        const query = {
          select() {
            return this;
          },
          is() {
            this.global = true;
            return this;
          },
          eq() {
            return this;
          },
          then(resolve, reject) {
            const data = this.global
              ? [{
                  id: 'motion-rule',
                  station_id: null,
                  rule_name: 'Motion detected',
                  metric: 'movement_detected',
                  comparison_operator: '=',
                  threshold_value: 1,
                  severity: 'high',
                  is_enabled: true,
                }]
              : [];

            return Promise.resolve({ data, error: null })
              .then(resolve, reject);
          },
        };

        return query;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  try {
    startMqttIngestion({
      connect: () => client,
      ruleClient,
      persistTelemetry: null,
    });

    // Await the registered handler directly.
    const handler = client.listeners('message')[0];

    assert.equal(typeof handler, 'function');

    await handler(
      'niah/telemetry/niah-station-01',
      Buffer.from(JSON.stringify(sampleTelemetry()))
    );

    const alerts = getActiveAlerts();

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'motion_detected');
    assert.equal(alerts[0].rule_key, 'motion-rule');
  } finally {
    resetTelemetryForTests();

    if (previousUrl === undefined) {
      delete process.env.MQTT_URL;
    } else {
      process.env.MQTT_URL = previousUrl;
    }
  }
});

test('MQTT does not use hardcoded thresholds when rule loading fails', async () => {
  const previousUrl = process.env.MQTT_URL;
  process.env.MQTT_URL = 'mqtt://localhost:1883';

  resetTelemetryForTests();

  const client = fakeMqttClient();
  const originalError = console.error;
  const errors = [];

  console.error = (...args) => errors.push(args.join(' '));

  try {
    startMqttIngestion({
      connect: () => client,
      ruleClient: {
        from() {
          throw new Error('Database unavailable');
        },
      },
      persistTelemetry: null,
    });

    const handler = client.listeners('message')[0];

    await handler(
      'niah/telemetry/niah-station-01',
      Buffer.from(JSON.stringify(sampleTelemetry()))
    );

    assert.equal(getActiveAlerts().length, 0);
    assert.ok(errors.some((message) => message.includes('rule loading failed')));
  } finally {
    console.error = originalError;
    resetTelemetryForTests();

    if (previousUrl === undefined) {
      delete process.env.MQTT_URL;
    } else {
      process.env.MQTT_URL = previousUrl;
    }
  }
});

test('MQTT preserves sensor reading order during slow persistence', async () => {
  const previousUrl = process.env.MQTT_URL;
  process.env.MQTT_URL = 'mqtt://localhost:1883';

  resetTelemetryForTests();

  const client = fakeMqttClient();
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

  try {
    startMqttIngestion({
      connect: () => client,
      ruleClient: null,
      persistTelemetry,
    });

    const handler = client.listeners('message')[0];

    const first = sampleTelemetry(false);
    first.sequence = 1;

    const second = sampleTelemetry(false);
    second.sequence = 2;

    // Simulate two MQTT messages arriving close together.
    const firstTask = handler(
      'niah/telemetry/niah-station-01',
      Buffer.from(JSON.stringify(first))
    );

    const secondTask = handler(
      'niah/telemetry/niah-station-01',
      Buffer.from(JSON.stringify(second))
    );

releaseFirst();
await firstTask;
await secondTask;

    // Recent readings are returned newest first.
    assert.deepEqual(
      getRecentReadings().map((reading) => reading.sequence),
      [2, 1]
    );
  } finally {
    releaseFirst();
    resetTelemetryForTests();

    if (previousUrl === undefined) {
      delete process.env.MQTT_URL;
    } else {
      process.env.MQTT_URL = previousUrl;
    }
  }
});


test('MQTT applies station-specific rules instead of global rules', async () => {
  const previousUrl = process.env.MQTT_URL;
  process.env.MQTT_URL = 'mqtt://localhost:1883';

  resetTelemetryForTests();

  const client = fakeMqttClient();

  const ruleClient = {
    from(table) {
      if (table === 'sensor_stations') {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              single: async () => ({
                data: { id: 'station-uuid-1' },
                error: null,
              }),
            };
          },
        };
      }

      if (table === 'alert_rules') {
        const query = {
          scope: 'specific',

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
            const globalRules = [{
              id: 'global-temp',
              station_id: null,
              rule_name: 'Global temperature threshold',
              metric: 'temperature_c',
              comparison_operator: '>',
              threshold_value: 35,
              severity: 'high',
              is_enabled: true,
            }];

            const specificRules = [{
              id: 'station-temp',
              station_id: 'station-uuid-1',
              rule_name: 'Station temperature threshold',
              metric: 'temperature_c',
              comparison_operator: '>',
              threshold_value: 25,
              severity: 'high',
              is_enabled: true,
            }];

            return Promise.resolve({
              data: this.scope === 'global'
                ? globalRules
                : specificRules,
              error: null,
            }).then(resolve, reject);
          },
        };

        return query;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  try {
    startMqttIngestion({
      connect: () => client,
      ruleClient,
      persistTelemetry: null,
    });

    const handler = client.listeners('message')[0];

    await handler(
      'niah/telemetry/niah-station-01',
      Buffer.from(JSON.stringify(sampleTelemetry(false)))
    );

    const alerts = getActiveAlerts();

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].rule_key, 'station-temp');
    assert.equal(alerts[0].threshold, 25);
    assert.equal(alerts[0].type, 'high_temperature');
  } finally {
    resetTelemetryForTests();

    if (previousUrl === undefined) {
      delete process.env.MQTT_URL;
    } else {
      process.env.MQTT_URL = previousUrl;
    }
  }
});


test('MQTT continues processing after a failed persistence request', async () => {
  const previousUrl = process.env.MQTT_URL;
  const originalError = console.error;

  process.env.MQTT_URL = 'mqtt://localhost:1883';
  console.error = () => {};

  resetTelemetryForTests();

  const client = fakeMqttClient();
  const processedSequences = [];

  const persistTelemetry = async (payload) => {
    if (payload.sequence === 1) {
      throw new Error('Simulated persistence failure');
    }

    processedSequences.push(payload.sequence);

    return {
      reading_id: `reading-${payload.sequence}`,
    };
  };

  try {
    startMqttIngestion({
      connect: () => client,
      ruleClient: null,
      persistTelemetry,
    });

    const handler = client.listeners('message')[0];

    const first = sampleTelemetry(false);
    first.sequence = 1;

    const second = sampleTelemetry(false);
    second.sequence = 2;

    await handler(
      'niah/telemetry/niah-station-01',
      Buffer.from(JSON.stringify(first))
    );

    await handler(
      'niah/telemetry/niah-station-01',
      Buffer.from(JSON.stringify(second))
    );

    // First message failed, but second message succeeds.
    assert.deepEqual(processedSequences, [2]);

    // The successful reading is available in memory.
    assert.deepEqual(
      getRecentReadings().map((reading) => reading.sequence),
      [2]
    );
  } finally {
    console.error = originalError;
    resetTelemetryForTests();

    if (previousUrl === undefined) {
      delete process.env.MQTT_URL;
    } else {
      process.env.MQTT_URL = previousUrl;
    }
  }
});
