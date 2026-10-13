const mqtt = require('mqtt');
const { ingestTelemetry } = require('./iotTelemetryService');

const DEFAULT_TOPIC = 'niah/telemetry/+';

function startMqttIngestion() {
  const brokerUrl = process.env.MQTT_URL;
  if (!brokerUrl) {
    console.log('MQTT ingestion disabled: MQTT_URL is not configured');
    return null;
  }

  const topic = process.env.MQTT_TOPIC_FILTER || DEFAULT_TOPIC;
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

  client.on('message', (messageTopic, bytes) => {
    try {
      const payload = JSON.parse(bytes.toString('utf8'));
      const reading = ingestTelemetry(payload);
      console.log(
        `MQTT telemetry received at ${reading.received_at}` +
        ` from ${reading.station_id} sequence=${reading.sequence}` +
        ` on ${messageTopic}`,
      );
    } catch (error) {
      console.error(`MQTT telemetry rejected on ${messageTopic}: ${error.message}`);
    }
  });

  client.on('error', (error) => {
    console.error('MQTT client error:', error.message);
  });

  return client;
}

module.exports = { startMqttIngestion };
