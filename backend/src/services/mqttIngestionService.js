const mqtt = require('mqtt');
const { ingestTelemetry } = require('./iotTelemetryService');
const { createTelemetryPersistence } = require('./telemetryPersistence');

const DEFAULT_TOPIC = 'niah/telemetry/+';

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
      if (persistTelemetry) await persistTelemetry(payload);
      ingestTelemetry(payload);
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
