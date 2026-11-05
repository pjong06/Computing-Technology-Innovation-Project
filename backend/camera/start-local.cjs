const path = require('node:path');
require('dotenv').config({ path: [path.resolve(__dirname, '../camera.local.env'), path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../../Computing-Technology-Innovation-Project/backend/.env')], quiet: true });
// Running this dedicated entry point is explicit opt-in to camera activation.
// Keep the prototype on a separate topic: subscribing and persisting alongside
// Render on the normal device topic would otherwise insert each sample twice.
const topic = process.env.CAMERA_MQTT_TOPIC_FILTER;
if (!topic || !/^niah\/camera-test\/[a-zA-Z0-9_-]+$/.test(topic)) {
  throw new Error('Set CAMERA_MQTT_TOPIC_FILTER to a dedicated niah/camera-test/<name> topic');
}
process.env.MQTT_TOPIC_FILTER = topic;
process.env.CAMERA_ENABLED = 'true';
process.env.PORT = process.env.CAMERA_BACKEND_PORT || '3002';
console.log('Laptop camera mode enabled. Captures only on PIR + valid nearby distance; close this process to stop.');
require('../src/server');
