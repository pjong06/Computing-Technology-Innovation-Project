const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGE = 5 * 1024 * 1024;
function cameraCapture(env = process.env) {
  const python = env.CAMERA_PYTHON || path.resolve(__dirname, '../../.camera-runtime/Scripts/python.exe');
  return () => new Promise((resolve, reject) => {
    execFile(python, [path.resolve(__dirname, '../../camera/capture.py'), '--device', env.CAMERA_DEVICE_INDEX || '0'],
      { encoding: 'buffer', maxBuffer: MAX_IMAGE, timeout: 15000, windowsHide: true }, (error, bytes) => {
        if (error) return reject(new Error('CAMERA_CAPTURE_FAILED'));
        resolve(bytes);
      });
  });
}

function createCameraEvidenceService({ enabled = false, directory = path.resolve(__dirname, '../../.camera-evidence'), cooldownMs = 120000, distanceCm = 100, maxRecords = 1000, capture = cameraCapture(), cloud = null, now = Date.now } = {}) {
  if (!Number.isFinite(cooldownMs) || cooldownMs < 1000 || !Number.isFinite(distanceCm) || distanceCm <= 0 || !Number.isInteger(maxRecords) || maxRecords < 1) throw new Error('Invalid camera configuration');
  let busy = false;
  const root = path.resolve(directory);
  const file = (id, extension) => {
    if (!UUID.test(id)) throw new Error('Invalid evidence ID');
    return path.join(root, `${id}.${extension}`);
  };
  async function records() {
    let names;
    try { names = await fs.readdir(root); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const result = [];
    for (const name of names) if (/^[0-9a-f-]{36}\.json$/i.test(name)) result.push(JSON.parse(await fs.readFile(path.join(root, name), 'utf8')));
    return result;
  }
  async function save(record) {
    const target = file(record.id, 'json');
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
    await fs.rename(temp, target);
  }
  async function sync(record) {
    if (!cloud) return record;
    try {
      record.cloud = await cloud.sync(record, await fs.readFile(file(record.id, 'jpg')), save);
      record.sync_status = 'uploaded'; record.last_error = null;
    } catch {
      record.sync_status = 'pending'; record.last_error = 'CLOUD_SYNC_FAILED';
    }
    await save(record);
    return record;
  }
  return {
    status: () => ({ enabled, cloud_enabled: Boolean(cloud), cooldown_ms: cooldownMs, distance_cm: distanceCm, max_records: maxRecords, busy }),
    async trigger({ reading, alert, databaseReadingId = null }) {
      if (!enabled) return { outcome: 'disabled' };
      if (!reading || reading.motion_detected !== true || reading.distance_valid !== true || !Number.isFinite(reading.distance_cm) || reading.distance_cm < 0 || reading.distance_cm > distanceCm) return { outcome: 'not_triggered' };
      if (!alert || !UUID.test(alert.id) || alert.station_id !== reading.station_id || !['motion_detected', 'proximity_breach'].includes(alert.type) || alert.status !== 'active') throw new Error('Matching active threat alert required');
      if (typeof reading.station_id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(reading.station_id) || !Number.isSafeInteger(reading.sequence) || reading.sequence < 0 || !Number.isSafeInteger(reading.uptime_ms) || reading.uptime_ms < 0) throw new Error('Invalid camera event identity');
      if (databaseReadingId !== null && !UUID.test(databaseReadingId)) throw new Error('Invalid database reading ID');
      if (busy) return { outcome: 'busy' };
      busy = true;
      try {
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        const existing = await records();
        const eventKey = createHash('sha256').update(JSON.stringify([reading.station_id, reading.sequence, reading.uptime_ms])).digest('hex');
        if (existing.some(r => r.event_key === eventKey)) return { outcome: 'duplicate' };
        const time = now();
        if (existing.some(r => r.station_code === reading.station_id && time - Date.parse(r.captured_at) < cooldownMs)) return { outcome: 'cooldown' };
        if (existing.length >= maxRecords) return { outcome: 'capacity_reached' };
        const image = await capture();
        if (!Buffer.isBuffer(image) || image.length < 4 || image.length > MAX_IMAGE || image[0] !== 0xff || image[1] !== 0xd8 || image.at(-2) !== 0xff || image.at(-1) !== 0xd9) throw new Error('Invalid captured JPEG');
        const record = { id: randomUUID(), alert_id: alert.id, station_code: reading.station_id, database_reading_id: databaseReadingId, captured_at: new Date(time).toISOString(), event_key: eventKey, byte_count: image.length, sha256: createHash('sha256').update(image).digest('hex'), sync_status: cloud ? 'pending' : 'local_only' };
        await fs.writeFile(file(record.id, 'jpg'), image, { flag: 'wx', mode: 0o600 });
        await save(record);
        await sync(record);
        return { outcome: 'captured', evidence: record };
      } finally { busy = false; }
    },
    async list(alertId) { if (!UUID.test(alertId)) throw new Error('Invalid alert ID'); return (await records()).filter(r => r.alert_id === alertId || r.cloud?.alert_id === alertId); },
    async image(alertId, id) {
      const record = (await this.list(alertId)).find(r => r.id === id);
      if (!record) return null;
      return fs.readFile(file(id, 'jpg'));
    },
    async retry(alertId, id) {
      if (busy) throw new Error('Camera is busy');
      busy = true;
      try {
        const record = (await this.list(alertId)).find(r => r.id === id);
        if (!record) return null;
        if (!cloud) throw new Error('Cloud upload disabled');
        if (record.sync_status === 'uploaded') return record;
        return await sync(record);
      } finally { busy = false; }
    },
  };
}
let singleton;
function getCameraEvidenceService() {
  if (!singleton) {
    const env = process.env;
    const cloud = env.CAMERA_STORAGE_ENABLED === 'true' ? require('./cameraStorage').createCameraStorage(env) : null;
    singleton = createCameraEvidenceService({ enabled: env.CAMERA_ENABLED === 'true', cooldownMs: Number(env.CAMERA_COOLDOWN_MS || 120000), distanceCm: Number(env.CAMERA_DISTANCE_CM || 100), capture: cameraCapture(env), cloud });
  }
  return singleton;
}
module.exports = { createCameraEvidenceService, getCameraEvidenceService, cameraCapture };
