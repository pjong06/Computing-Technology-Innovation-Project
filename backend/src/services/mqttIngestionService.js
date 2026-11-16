
'use strict';

const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');

const {
  ingestTelemetry,
  validateTelemetry,
} = require('./iotTelemetryService');

const {
  createTelemetryPersistence,
} = require('./telemetryPersistence');

const {
  loadAlertRulesForStation,
} = require('./iotAlertRuleService');

const {
  getActiveAlerts,
} = require('./iotAlertService');

const {
  getCameraEvidenceService,
} = require('./cameraEvidenceService');

const DEFAULT_TOPIC = 'niah/telemetry/+';

function createAlertRuleClient(env = process.env) {
  if (env.IOT_DATABASE_ALERT_RULES_ENABLED !== 'true') {
    return null;
  }

  if (!env.SUPABASE_URL || !env.IOT_DATABASE_SERVER_KEY) {
    throw new Error(
      'Database alert rules require SUPABASE_URL and IOT_DATABASE_SERVER_KEY'
    );
  }

  return createClient(
    env.SUPABASE_URL,
    env.IOT_DATABASE_SERVER_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

function startMqttIngestion(dependencies = {}) {
  const brokerUrl = process.env.MQTT_URL;

  if (!brokerUrl) {
    console.log('MQTT ingestion disabled: MQTT_URL is not configured');
    return null;
  }

  const topic = process.env.MQTT_TOPIC_FILTER || DEFAULT_TOPIC;

  // Database rules are opt-in. Existing behaviour remains the default.
const ruleClient = Object.hasOwn(dependencies, 'ruleClient')
  ? dependencies.ruleClient
  : createAlertRuleClient();

const persistTelemetry = Object.hasOwn(dependencies, 'persistTelemetry')
  ? dependencies.persistTelemetry
  : createTelemetryPersistence();

const client = (dependencies.connect || mqtt.connect)(brokerUrl, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    rejectUnauthorized:
      process.env.MQTT_ALLOW_INSECURE_TLS !== 'true',
  });

  client.on('connect', () => {
    client.subscribe(topic, { qos: 0 }, (error) => {
      if (error) {
        console.error('MQTT subscription failed:', error.message);
      } else {
        console.log(`MQTT ingestion subscribed to ${topic}`);
      }
    });
  });

  // Process readings from each station in arrival order.
const stationQueues = new Map();

client.on('message', (_messageTopic, bytes) => {
  let payload;

  try {
    payload = JSON.parse(bytes.toString('utf8'));
    validateTelemetry(payload);
  } catch {
    console.error('MQTT telemetry rejected: invalid payload');
    return Promise.resolve();
  }

  const stationId = payload.station_id;
  const previous = stationQueues.get(stationId) || Promise.resolve();

  const current = previous.catch(() => {}).then(async () => {
    try {


      // Validate before using the station code or querying the database.
      const telemetry = validateTelemetry(payload);

      // Keep the existing persistence-first behaviour.
      const persisted = persistTelemetry
        ? await persistTelemetry(telemetry)
        : null;

      let alertOptions = {};

      if (ruleClient) {
        const databaseRules = await loadAlertRulesForStation(
          ruleClient,
          telemetry.station_id
        );

        alertOptions = { databaseRules };
      }

      // Rules are passed into the existing alert processing logic.
      const reading = ingestTelemetry(
        telemetry,
        new Date(),
        alertOptions
      );

      if (persisted) {
        reading.database_reading_id = persisted.reading_id;
      }

      // Camera evidence remains optional and disabled by default.
      if (process.env.CAMERA_ENABLED === 'true') {
        try {
          const alert = getActiveAlerts().find(
            (item) =>
              item.station_id === reading.station_id &&
              ['motion_detected', 'proximity_breach'].includes(item.type)
          );

          if (alert) {
            void getCameraEvidenceService()
              .trigger({
                reading,
                alert,
                databaseReadingId: persisted?.reading_id || null,
              })
              .catch(() => {
                console.error(
                  'Camera capture failed; telemetry retained'
                );
              });
          }
        } catch {
          console.error(
            'Camera configuration unavailable; telemetry retained'
          );
        }
      }

      console.log(
        persisted
          ? 'MQTT telemetry persisted and processed'
          : 'MQTT telemetry processed in memory'
      );

    } catch {
      console.error(
        'MQTT telemetry rejected, rule loading failed, or persistence unavailable'
      );
    }
  });

stationQueues.set(stationId, current);

const cleanup = () => {
  if (stationQueues.get(stationId) === current) {
    stationQueues.delete(stationId);
  }
};

void current.then(cleanup, cleanup);

return current;
});


  client.on('error', (error) => {
    console.error('MQTT client error:', error.message);
  });

  return client;
}

module.exports = {
  startMqttIngestion,
  createAlertRuleClient,
};
