const mqtt = require('mqtt');
const { ingestTelemetry } = require('./iotTelemetryService');
const { createTelemetryPersistence } = require('./telemetryPersistence');

const DEFAULT_TOPIC = 'niah/telemetry/+';
const { getActiveAlerts } = require('./iotAlertService');
const { getCameraEvidenceService } = require('./cameraEvidenceService');

function startMqttIngestion() {
  const brokerUrl = process.env.MQTT_URL;
  if (!brokerUrl) {
    console.log('MQTT ingestion disabled: MQTT_URL is not configured');
    return null;
  }

  const topic = process.env.MQTT_TOPIC_FILTER || DEFAULT_TOPIC;
  const persistTelemetry = createTelemetryPersistence();
  const client = mqtt.connect(brokerUrl, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    rejectUnauthorized: process.env.MQTT_ALLOW_INSECURE_TLS !== 'true',
  });

  client.on('connect', () => {
    client.subscribe(topic, { qos: 0 }, (error) => {
      if (error) console.error('MQTT subscription failed:', error.message);
      else console.log(`MQTT ingestion subscribed to ${topic}`);
    });
  });

  client.on('message', async (_messageTopic, bytes) => {
    try {
      const payload = JSON.parse(bytes.toString('utf8'));
      const persisted = persistTelemetry ? await persistTelemetry(payload) : null;
      const reading = ingestTelemetry(payload);
      if (persisted) reading.database_reading_id = persisted.reading_id;
      // Disabled by default. Only the opt-in laptop process can capture a webcam.
      // Failures must never change telemetry's persistence result.
      if (process.env.CAMERA_ENABLED === 'true') {
        try {
          const alert = getActiveAlerts().find(a => a.station_id === reading.station_id &&
            ['motion_detected', 'proximity_breach'].includes(a.type));
          if (alert) void getCameraEvidenceService().trigger({ reading, alert,
            databaseReadingId: persisted?.reading_id || null }).catch(() =>
            console.error('Camera capture failed; telemetry retained'));
        } catch { console.error('Camera configuration unavailable; telemetry retained'); }
      }
      console.log(persistTelemetry ? 'MQTT telemetry persisted' : 'MQTT telemetry received in memory');
    } catch {
      console.error('MQTT telemetry rejected or persistence unavailable');
    }
  });

  client.on('error', (error) => {
    console.error('MQTT client error:', error.message);
  });

  return client;
}

module.exports = { startMqttIngestion };
