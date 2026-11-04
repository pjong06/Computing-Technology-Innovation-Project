// Explicit physical-camera test. Synthetic events; no network or cloud adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCameraEvidenceService, cameraCapture } = require('../src/services/cameraEvidenceService');

async function main() {
  if (!process.argv.includes('--capture')) throw new Error('Use --capture to permit one physical photo');
  const run = randomUUID();
  const directory = path.resolve(__dirname, '../.camera-evidence/local-tests', run);
  let captureCalls = 0;
  const capture = cameraCapture();
  const options = { enabled: true, directory, cooldownMs: 30000, distanceCm: 100,
    capture: async () => { captureCalls++; return capture(); } };
  let service = createCameraEvidenceService(options);
  const reading = { station_id: 'camera-local-test', motion_detected: true, distance_valid: true,
    distance_cm: 30, sequence: Date.now(), uptime_ms: 1000 };
  const alert = { id: randomUUID(), station_id: reading.station_id, type: 'proximity_breach', status: 'active' };
  const rows = [];
  async function check(name, event, expected) {
    const result = await service.trigger({ reading: event, alert });
    assert.equal(result.outcome, expected);
    rows.push({ name, expected, actual: result.outcome, pass: true });
    return result;
  }
  await check('No movement', { ...reading, motion_detected: false }, 'not_triggered');
  await check('Invalid distance', { ...reading, distance_valid: false }, 'not_triggered');
  await check('Outside 100 cm', { ...reading, distance_cm: 101 }, 'not_triggered');
  assert.equal(captureCalls, 0);
  const photo = await check('Movement and 30 cm: real webcam', reading, 'captured');
  await check('Identical event', reading, 'duplicate');
  await check('New event during cooldown', { ...reading, sequence: reading.sequence + 1 }, 'cooldown');
  service = createCameraEvidenceService(options);
  await check('Duplicate after service recreation', reading, 'duplicate');
  await check('Cooldown after service recreation', { ...reading, sequence: reading.sequence + 2 }, 'cooldown');
  assert.equal(captureCalls, 1);
  const bytes = await service.image(alert.id, photo.evidence.id);
  assert.equal(bytes.length, photo.evidence.byte_count);
  const report = { tested_at: new Date().toISOString(), synthetic_events: true, real_webcam: true,
    cloud_enabled: false, capture_calls: captureCalls, rows, evidence_id: photo.evidence.id,
    local_alert_id: alert.id, byte_count: bytes.length, image_path: path.join(directory, photo.evidence.id + '.jpg'),
    scope: 'Direct camera service calls; not MQTT, real sensor, database alert or dashboard acceptance' };
  await fs.writeFile(path.resolve(__dirname, '../../../security-test-results/camera-local-trigger-20261105.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error('Local camera verification failed:', e.message); process.exitCode = 1; });
