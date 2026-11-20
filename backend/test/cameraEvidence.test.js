const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { createCameraEvidenceService } = require('../src/services/cameraEvidenceService');
const { createCameraStorage } = require('../src/services/cameraStorage');
const { createCameraRouter } = require('../src/routes/iotCamera');
const jpeg = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]); // capture double, not a real image
function event(sequence = 1) {
  return { reading: { station_id: 'test-station', sequence, uptime_ms: sequence * 100, motion_detected: true, distance_valid: true, distance_cm: 10 }, alert: { id: '11111111-1111-4111-8111-111111111111', station_id: 'test-station', type: 'proximity_breach', status: 'active' } };
}
async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'biotrack-camera-test-'));
  t.after(async () => {
    // Validate the exact generated path before recursive test cleanup.
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('biotrack-camera-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, service: createCameraEvidenceService({ enabled: true, directory, capture: async () => jpeg, ...overrides }) };
}
test('disabled, invalid PIR/distance and nonmatching alert never capture', async t => {
  let calls = 0;
  const { service } = await fixture(t, { capture: async () => { calls++; return jpeg; } });
  assert.equal((await createCameraEvidenceService().trigger(event())).outcome, 'disabled');
  for (const patch of [{ motion_detected: false }, { distance_valid: false }, { distance_cm: 101 }, { distance_cm: -1 }]) {
    const input = event(); Object.assign(input.reading, patch);
    assert.equal((await service.trigger(input)).outcome, 'not_triggered');
  }
  const input = event(); input.alert.station_id = 'unrelated';
  await assert.rejects(service.trigger(input), /Matching active/);
  assert.equal(calls, 0);
});
test('durable alert linkage, local bytes, duplicate and cooldown survive service restart', async t => {
  let clock = 100000;
  const { service, directory } = await fixture(t, { now: () => clock });
  const result = await service.trigger(event());
  assert.equal(result.outcome, 'captured');
  assert.equal(result.evidence.sync_status, 'local_only');
  assert.deepEqual(await service.image(event().alert.id, result.evidence.id), jpeg);
  const restarted = createCameraEvidenceService({ enabled: true, directory, capture: async () => jpeg, now: () => clock });
  assert.equal((await restarted.trigger(event())).outcome, 'duplicate');
  assert.equal((await restarted.trigger(event(2))).outcome, 'cooldown');
  clock += 119999;
  assert.equal((await restarted.trigger(event(2))).outcome, 'cooldown');
  clock += 1;
  assert.equal((await restarted.trigger(event(2))).outcome, 'captured');
  assert.equal((await restarted.list(event().alert.id)).length, 2);
  assert.equal(await restarted.image(randomUUID(), result.evidence.id), null);
  await assert.rejects(restarted.list('../../private'), /Invalid alert/);
});
test('concurrent events cannot open camera twice; errors release lock', async t => {
  let release;
  const { service } = await fixture(t, { capture: () => new Promise(resolve => { release = resolve; }) });
  const first = service.trigger(event());
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await service.trigger(event(2))).outcome, 'busy');
  release(jpeg); assert.equal((await first).outcome, 'captured');
  const other = await fixture(t, { capture: async () => { throw new Error('camera unplugged'); } });
  await assert.rejects(other.service.trigger(event()));
  assert.equal(other.service.status().busy, false);
});
test('invalid capture produces no evidence; capacity prevents unbounded retention', async t => {
  const invalid = await fixture(t, { capture: async () => Buffer.from('not jpeg') });
  await assert.rejects(invalid.service.trigger(event()), /Invalid captured/);
  assert.deepEqual(await invalid.service.list(event().alert.id), []);
  let clock = 100000;
  const bounded = await fixture(t, { maxRecords: 1, now: () => clock });
  await bounded.service.trigger(event()); clock += 121000;
  assert.equal((await bounded.service.trigger(event(2))).outcome, 'capacity_reached');
});
test('cloud failure retains local capture and stable ID for retry; duplicate retry skips upload', async t => {
  let fail = true; let calls = 0;
  const cloud = { async sync(record, image) { calls++; assert.deepEqual(image, jpeg); if (fail) throw new Error('cloud down'); return { alert_id: randomUUID(), file_path: record.id + '.jpg' }; } };
  const { service } = await fixture(t, { cloud });
  const r = await service.trigger({ ...event(), databaseReadingId: randomUUID() });
  assert.equal(r.evidence.sync_status, 'pending');
  assert.deepEqual(await service.image(event().alert.id, r.evidence.id), jpeg);
  fail = false;
  const retry = await service.retry(event().alert.id, r.evidence.id);
  assert.equal(retry.id, r.evidence.id); assert.equal(retry.sync_status, 'uploaded');
  await service.retry(event().alert.id, r.evidence.id); assert.equal(calls, 2);
});
test('cloud adapter refuses public bucket and missing persisted reading before any upload', async () => {
  let writes = 0;
  const adapter = createCameraStorage({}, { storage: { async getBucket() { return { data: { public: true } }; }, from() { writes++; throw new Error('must not upload'); } } });
  await assert.rejects(adapter.sync({ database_reading_id: null }, jpeg), /Persisted reading/);
  await assert.rejects(adapter.sync({ database_reading_id: randomUUID(), byte_count: jpeg.length, sha256: require('node:crypto').createHash('sha256').update(jpeg).digest('hex') }, jpeg), /Private camera bucket/);
  assert.equal(writes, 0);
});
test('cloud adapter verifies station/alert, uses non-upsert upload and associates stable evidence ID', async () => {
  const station = randomUUID(), alert = randomUUID(), reading = randomUUID(), evidence = randomUUID();
  let uploaded = false, linked = false;
  const record = { id: evidence, station_code: 'test-station', database_reading_id: reading, captured_at: new Date().toISOString(), byte_count: jpeg.length, sha256: require('node:crypto').createHash('sha256').update(jpeg).digest('hex') };
  const object = `${station}/${alert}/${evidence}.jpg`;
  const client = {
    from(table) {
      const data = table === 'sensor_readings' ? { id: reading, station_id: station } : table === 'sensor_stations' ? { id: station } : table === 'alerts' ? { id: alert } : null;
      const q = { select() { return q; }, eq() { return q; }, like(column, pattern) { assert.equal(table, 'alerts'); assert.equal(column, 'alert_message'); assert.equal(pattern, '% (movement_nearby_cm)'); return q; }, order() { return q; }, limit() { return q; }, async single() { return { data }; }, async maybeSingle() { return { data }; }, async insert(row) { assert.equal(row.id, evidence); assert.equal(row.alert_id, alert); assert.equal(row.file_path, object); linked = true; return {}; } };
      return q;
    },
    storage: { async getBucket() { return { data: { public: false } }; }, from(bucket) { assert.equal(bucket, 'camera-evidence'); return { async upload(p, bytes, options) { assert.equal(p, object); assert.deepEqual(bytes, jpeg); assert.equal(options.upsert, false); uploaded = true; return {}; } }; } },
  };
  assert.equal((await createCameraStorage({}, client).sync(record, jpeg)).alert_id, alert);
  assert.ok(uploaded && linked);
});
test('cloud adapter rejects a temperature-only alert before uploading a photo', async () => {
  const id = randomUUID();
  let uploads = 0;
  const client = {
    from(table) {
      let movementFilter = false;
      const q = { select() { return q; }, eq() { return q; },
        like(column, pattern) { movementFilter = column === 'alert_message' && pattern === '% (movement_nearby_cm)'; return q; },
        order() { return q; }, limit() { return q; },
        async single() { return { data: { id, station_id: id } }; },
        async maybeSingle() { assert.equal(table, 'alerts'); return { data: movementFilter ? null : { id } }; },
      };
      return q;
    },
    storage: { async getBucket() { return { data: { public: false } }; }, from() { uploads++; throw new Error('Unexpected upload'); } },
  };
  await assert.rejects(createCameraStorage({}, client).sync({ database_reading_id: id, station_code: 'test-station', byte_count: jpeg.length,
    sha256: require('node:crypto').createHash('sha256').update(jpeg).digest('hex') }, jpeg), /No persisted alert/);
  assert.equal(uploads, 0);
});

test('HTTP routes deny anonymous/non-Officer/inactive and bind image to alert ID', async t => {
  const { service } = await fixture(t);
  const r = await service.trigger(event());
  const app = express();
  app.use((req, res, next) => { const role = req.get('x-test-role'); if (role) { req.user = { id: 'test-user' }; req.profile = { role, account_status: req.get('x-test-status') || 'active' }; } next(); });
  app.use(createCameraRouter({ service: () => service }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const role of [null, 'botanist', 'researcher', 'admin']) {
    const response = await fetch(base + '/camera/status', { headers: role ? { 'x-test-role': role } : {} });
    assert.equal(response.status, role ? 403 : 401);
  }
  assert.equal((await fetch(base + '/camera/status', { headers: { 'x-test-role': 'officer', 'x-test-status': 'inactive' } })).status, 403);
  for (const role of ['botanist', 'researcher']) {
    const staffHeaders = { 'x-test-role': role };
    assert.equal((await fetch(`${base}/alerts/${event().alert.id}/camera/${r.evidence.id}/image`, { headers: staffHeaders })).status, 200);
    assert.equal((await fetch(`${base}/alerts/${event().alert.id}/camera/capture`, { method: 'POST', headers: staffHeaders })).status, 403);
    assert.equal((await fetch(`${base}/alerts/${event().alert.id}/camera/${r.evidence.id}/retry`, { method: 'POST', headers: staffHeaders })).status, 403);
  }
  const headers = { 'x-test-role': 'officer' };
  const response = await fetch(`${base}/alerts/${event().alert.id}/camera/${r.evidence.id}/image`, { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  assert.equal((await fetch(`${base}/alerts/${randomUUID()}/camera/${r.evidence.id}/image`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/alerts/invalid/camera`, { headers })).status, 400);
});

test('cloud list permits three active staff roles without opening the laptop camera', async t => {
  const alertId = randomUUID(), evidenceId = randomUUID();
  let queries = 0;
  const q = { select(columns) { assert.equal(columns, 'id,alert_id,captured_at,byte_count,created_at'); return q; },
    eq(column, value) { assert.equal(column, 'alert_id'); assert.equal(value, alertId); return q; },
    order() { return q; }, async limit(n) { assert.equal(n, 100); return { data: [{ id: evidenceId, alert_id: alertId }] }; } };
  const app = express();
  app.use((req, res, next) => {
    const role = req.get('x-test-role');
    if (role) { req.user = { id: 'test-user' }; req.profile = { role, account_status: 'active' }; }
    req.supabase = { from(table) { queries++; assert.equal(table, 'alert_camera_evidence'); return q; } };
    next();
  });
  app.use(createCameraRouter({ service: () => { throw new Error('Must not access camera'); } }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/alerts/${alertId}/camera/cloud`;
  for (const role of [null, 'visitor', 'admin']) {
    const response = await fetch(url, { headers: role ? { 'x-test-role': role } : {} });
    assert.equal(response.status, role ? 403 : 401);
  }
  assert.equal(queries, 0);
  for (const role of ['officer', 'botanist', 'researcher']) {
    const response = await fetch(url, { headers: { 'x-test-role': role } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { data: [{ id: evidenceId, alert_id: alertId }], limit: 100 });
  }
  assert.equal(queries, 3);
});

test('cloud URL route uses user-scoped evidence lookup and fixed 60-second TTL', async t => {
  const alertId = randomUUID(), evidenceId = randomUUID();
  const filters = [];
  let signed = false;
  const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, async maybeSingle() { return { data: { id: evidenceId, alert_id: alertId, file_path: 'server-created-path.jpg' } }; } };
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: 'staff-test' }; req.profile = { role: req.get('x-test-role'), account_status: 'active' };
    req.supabase = { from(table) { assert.equal(table, 'alert_camera_evidence'); return query; }, storage: { from(bucket) { assert.equal(bucket, 'camera-evidence'); return { async createSignedUrl(object, ttl) { assert.equal(object, 'server-created-path.jpg'); assert.equal(ttl, 60); signed = true; return { data: { signedUrl: 'https://example.invalid/test-link' } }; } }; } } };
    next();
  });
  app.use(createCameraRouter());
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  for (const role of ['officer', 'botanist', 'researcher']) {
    filters.length = 0; signed = false;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/alerts/${alertId}/camera/${evidenceId}/url`, { headers: { 'x-test-role': role } });
    assert.equal(response.status, 200); assert.equal((await response.json()).expires_in, 60);
    assert.deepEqual(filters, [['id', evidenceId], ['alert_id', alertId]]); assert.ok(signed);
  }
});
