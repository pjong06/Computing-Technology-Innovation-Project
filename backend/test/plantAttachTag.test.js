'use strict';
process.env.PUBLIC_PLANT_BASE_URL = 'https://plants.example.test/p/';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');
const BOTANIST = '11111111-1111-4111-8111-111111111111';
const PLANT = '22222222-2222-4222-8222-222222222222';
const TAG = 'NIAH-PLT-00077';
let db;
mockAuth(() => ({ userId: BOTANIST, role: 'botanist', db }));
const plantRouter = require('../src/routes/plants');
function fakeDb({ existing, refresh, bindError } = {}) {
  let bound = false;
  const calls = [];
  return {
    calls,
    from() {
      const chain = { select() { return chain; }, eq() { return chain; }, async maybeSingle() {
        if (bound && refresh !== undefined) return refresh;
        return { data: { id: PLANT, registered_by: BOTANIST,
          qr_code_value: existing || (bound ? TAG : 'plant:internal'), row_version: bound ? 8 : 5 }, error: null };
      } }; return chain;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'reserve_plant_tags') return { data: [{ qr_code_value: TAG }], error: null };
      assert.equal(name, 'attach_reserved_plant_tag');
      if (bindError) return { data: null, error: bindError };
      bound = true;
      return { data: PLANT, error: null };
    },
  };
}
const attach = () => callRoute('/api/plants', plantRouter, { method: 'POST', path: `/${PLANT}/attach-tag`, body: {} });
test('a reserved and bound tag returns the committed row_version to mobile sync', async () => {
  db = fakeDb();
  const result = await attach();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.tag_code, TAG);
  assert.equal(result.body.row_version, 8);
  assert.deepEqual(db.calls, [
    ['reserve_plant_tags', { p_count: 1, p_request_id: PLANT }],
    ['attach_reserved_plant_tag', { p_plant_id: PLANT, p_tag: TAG }],
  ]);
});
test('an existing tag returns its unchanged version without another reservation', async () => {
  db = fakeDb({ existing: TAG }); const result = await attach();
  assert.equal(result.status, 200); assert.equal(result.body.row_version, 5); assert.deepEqual(db.calls, []);
});
for (const [name, refresh] of [
  ['RLS-hidden row', { data: null, error: null }],
  ['database error', { data: null, error: { message: 'PRIVATE' } }],
  ['mismatched tag', { data: { qr_code_value: 'NIAH-PLT-00078', row_version: 8 } }],
  ['missing version', { data: { qr_code_value: TAG } }],
  ['invalid version', { data: { qr_code_value: TAG, row_version: -1 } }],
]) {
  test('version confirmation refuses ' + name + ' instead of returning stale success', async () => {
    db = fakeDb({ refresh }); const result = await attach(); assert.equal(result.status, 503);
    assert.equal(result.body.row_version, undefined); assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE/);
  });
}
test('binding denied by database does not report a saved tag', async () => {
  db = fakeDb({ bindError: { code: '42501', message: 'PRIVATE' } });
  const result = await attach(); assert.equal(result.status, 403); assert.equal(result.body.row_version, undefined);
});
