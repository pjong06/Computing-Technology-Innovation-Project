const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.PUBLIC_PLANT_BASE_URL = 'https://plants.example.test/p/';
const ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const TAG = 'NIAH-PLT-00002';
let options, calls;
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, res, next) {
    req.user = { id: OWNER }; req.profile = { role: options.role || 'botanist' };
    req.supabase = {
      from() {
        const q = { select() { return q; }, eq() { return q; }, async maybeSingle() {
          const attached = calls.some(call => call[0] === 'attach_reserved_plant_tag');
          return { data: { id: ID, registered_by: OWNER,
            qr_code_value: attached ? TAG : (options.existing || 'plant:internal'), row_version: attached ? 8 : 7 } };
        } }; return q;
      },
      async rpc(name, args) {
        calls.push([name, args]);
        if (options.error) return { error: { code: options.error, message: 'PRIVATE' } };
        return { data: name === 'reserve_plant_tags' ? [{ qr_code_value: TAG }] : ID };
      },
    }; next();
  },
  requireRole: (...roles) => (req, res, next) => roles.includes(req.profile.role) ? next() : res.sendStatus(403),
} };
const router = require('../src/routes/plants');
async function start(t, config = {}) {
  options = config; calls = [];
  const app = express(); app.use(express.json()); app.use('/api/plants', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  return async () => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/plants/${ID}/attach-tag`, { method: 'POST' });
    return { status: r.status, body: await r.json() };
  };
}
test('mobile one-click tags reserve before attaching and reuse a stable retry key', async t => {
  const send = await start(t);
  for (let i = 0; i < 2; i++) {
    const r = await send(); assert.equal(r.status, 200); assert.equal(r.body.tag_code, TAG);
    assert.equal(r.body.public_url, 'https://plants.example.test/p/' + TAG);
    assert.equal(r.body.row_version, 8);
    assert.match(r.body.qr_code, /^data:image\/png;base64,/);
  }
  assert.deepEqual(calls, [
    ['reserve_plant_tags', { p_count: 1, p_request_id: ID }],
    ['attach_reserved_plant_tag', { p_plant_id: ID, p_tag: TAG }],
  ]); // The second request reads the saved tag and allocates nothing.
});
test('existing tags do not allocate another reservation', async t => {
  const send = await start(t, { existing: TAG }); assert.equal((await send()).status, 200); assert.deepEqual(calls, []);
});
test('officers cannot allocate a botanist reservation through the mobile shortcut', async t => {
  const send = await start(t, { role: 'officer' }); assert.equal((await send()).status, 403); assert.deepEqual(calls, []);
});
for (const [code, status] of [['42501', 403], ['23505', 409], ['PGRST202', 503]]) {
  test('mobile shortcut safely handles reservation failure ' + code, async t => {
    const send = await start(t, { error: code }); const r = await send(); assert.equal(r.status, status);
    assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE/); assert.equal(calls.length, 1);
  });
}
test('missing public URL does not reserve a tag', async t => {
  const send = await start(t); const previous = process.env.PUBLIC_PLANT_BASE_URL;
  delete process.env.PUBLIC_PLANT_BASE_URL;
  t.after(() => { process.env.PUBLIC_PLANT_BASE_URL = previous; });
  assert.equal((await send()).status, 503); assert.deepEqual(calls, []);
});
