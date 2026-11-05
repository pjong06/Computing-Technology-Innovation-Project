const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const id = '11111111-1111-4111-8111-111111111111';
async function fixture(t, profile, start = 'open', race = false) {
  let row = { id, alert_status: start, resolution_notes: null };
  const app = express(); app.disable('x-powered-by'); app.use(express.json());
  app.use((req, res, next) => {
    req.profile = profile;
    req.supabase = { from(table) {
      assert.equal(table, 'alerts'); let patch;
      const q = { select() { return q; }, eq() { return q; }, update(value) { patch = value; return q; },
        async maybeSingle() { if (patch) { if (race) return { data: null }; row = { ...row, ...patch }; } return { data: { ...row } }; } };
      return q;
    } }; next();
  });
  app.use(require('../src/middleware/iotAccess'), require('../src/routes/iotAlertActions'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return async (action, body = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/alerts/${id}/${action}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: response.status === 200 ? await response.json() : null };
  };
}
test('all three active staff can acknowledge and resolve with notes', async t => {
  for (const role of ['officer', 'botanist', 'researcher']) {
    const call = await fixture(t, { role, account_status: 'active' });
    assert.equal((await call('acknowledge')).body.data.alert_status, 'acknowledged');
    const resolved = await call('resolve', { resolution_notes: ' Reviewed photo ' });
    assert.equal(resolved.status, 200); assert.equal(resolved.body.data.resolution_notes, 'Reviewed photo');
    assert.equal((await call('resolve')).body.unchanged, true);
  }
});
test('lifecycle rejects anonymous, unsupported and suspended profiles', async t => {
  for (const profile of [null, { role: 'visitor', account_status: 'active' }, { role: 'admin', account_status: 'active' },
    { role: 'botanist', account_status: 'suspended' }, { role: 'researcher', account_status: 'suspended' }]) {
    const call = await fixture(t, profile);
    for (const action of ['acknowledge', 'resolve']) assert.equal((await call(action)).status, profile ? 403 : 401);
  }
});
test('lifecycle rejects forged actor, invalid notes, skipped states and race conflicts', async t => {
  const profile = { role: 'researcher', account_status: 'active' };
  const call = await fixture(t, profile);
  assert.equal((await call('resolve')).status, 409);
  assert.equal((await call('acknowledge', { acknowledged_by: id })).status, 400);
  assert.equal((await call('resolve', { resolution_notes: 'x'.repeat(2001) })).status, 400);
  assert.equal((await call('resolve', { resolved_at: '2020-01-01' })).status, 400);
  const stale = await fixture(t, profile, 'open', true);
  assert.equal((await stale('acknowledge')).status, 409);
});
