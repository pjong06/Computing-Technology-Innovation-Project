'use strict';

// POST /api/plants/:id/attach-tag returns the plant's row_version, so the phone can
// keep its outbox in step after the server writes the tag (no "needs conflict review").
process.env.PUBLIC_PLANT_BASE_URL = 'https://plants.example.test/p/';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mockAuth, callRoute, fakePlantsDb } = require('./helpers/routeTestKit');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const PLANT = '22222222-2222-4222-8222-222222222222';

let db;

mockAuth(() => ({ userId: BOTANIST, role: 'botanist', db }));

const plantRouter = require('../src/routes/plants');

// plant: the stored row. update: what the tag update returns.
function fakeDb({ plant, update = { data: { row_version: 8 }, error: null } }) {
  return fakePlantsDb({ row: plant, update, rpcResult: 'NIAH-PLT-00077' });
}

const attach = () =>
  callRoute('/api/plants', plantRouter, { method: 'POST', path: `/${PLANT}/attach-tag`, body: {} });

test('a new server tag comes back with the raised row_version', async () => {
  db = fakeDb({ plant: { id: PLANT, registered_by: BOTANIST, qr_code_value: null, row_version: 7 } });
  const result = await attach();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.tag_code, 'NIAH-PLT-00077');
  assert.equal(result.body.row_version, 8);
  assert.deepEqual(db.calls[1], ['update', { qr_code_value: 'NIAH-PLT-00077' }]);
});

test('a plant that already has a tag returns it with its current row_version', async () => {
  db = fakeDb({ plant: { id: PLANT, registered_by: BOTANIST, qr_code_value: 'NIAH-PLT-00042', row_version: 5 } });
  const result = await attach();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.tag_code, 'NIAH-PLT-00042');
  assert.equal(result.body.row_version, 5);
  assert.equal(db.calls.length, 0); // nothing generated or written
});

test('a tag update hidden by RLS is reported as not saved', async () => {
  db = fakeDb({
    plant: { id: PLANT, registered_by: BOTANIST, qr_code_value: null, row_version: 7 },
    update: { data: null, error: null },
  });
  const result = await attach();
  assert.equal(result.status, 500);
  assert.equal(result.body.message, 'Failed to save assigned tag to plant record');
});
