'use strict';

// PATCH /api/plants/:id with a new tag (a tag attached on the phone after upload).
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockAuth, callRoute, fakePlantsDb } = require('./helpers/routeTestKit');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const PLANT = '22222222-2222-4222-8222-222222222222';

let db;

mockAuth(() => ({ userId: BOTANIST, role: 'botanist', db }));

const plantRouter = require('../src/routes/plants');

// owner: who registered the plant (null = not found). update: what the update returns.
function fakeDb({ owner = BOTANIST, update = { data: { id: PLANT, qr_code_value: 'NIAH-PLT-00042' }, error: null } } = {}) {
  return fakePlantsDb({
    row: owner ? { id: PLANT, registered_by: owner } : null,
    update,
    lookupLabel: 'access-check',
  });
}

const patch = body => callRoute('/api/plants', plantRouter, { method: 'PATCH', path: `/${PLANT}`, body });
const getByTag = () => callRoute('/api/plants', plantRouter, {
  path: '/tag/NIAH-PLT-00042',
});

test('the owner can set a tag; it is cleaned to upper case', async () => {
  db = fakeDb();
  const result = await patch({ qr_code_value: ' niah-plt-00042 ' });
  assert.equal(result.status, 200);
  assert.deepEqual(db.calls, ['access-check', ['update', { qr_code_value: 'NIAH-PLT-00042' }]]);
});

test('the ownership check runs before anything is written', async () => {
  db = fakeDb({ owner: OTHER });
  const result = await patch({ qr_code_value: 'NIAH-PLT-00042' });
  assert.equal(result.status, 403);
  assert.deepEqual(db.calls, ['access-check']);
});

test('a tag used by another plant is a clear 409, not a server error', async () => {
  db = fakeDb({ update: { data: null, error: { code: '23505', message: 'duplicate key value' } } });
  const result = await patch({ qr_code_value: 'NIAH-PLT-00042' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'tag_in_use');
  assert.equal(result.body.message, 'This tag is already attached to another plant');
});

test('a plant RLS hides from the update is reported as locked, not missing', async () => {
  db = fakeDb({ update: { data: null, error: null } });
  const result = await patch({ qr_code_value: 'NIAH-PLT-00042' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'plant_locked');
});

test('an RLS refusal error is also reported as locked', async () => {
  db = fakeDb({ update: { data: null, error: { code: '42501', message: 'permission denied' } } });
  const result = await patch({ qr_code_value: 'NIAH-PLT-00042' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'plant_locked');
});

test('a missing plant is still 404', async () => {
  db = fakeDb({ owner: null });
  assert.equal((await patch({ qr_code_value: 'NIAH-PLT-00042' })).status, 404);
});

test('a badly formed or non-text tag is refused before any database call', async () => {
  for (const tag of ['TAG-1', '', 42, { code: 'NIAH-PLT-00042' }]) {
    db = fakeDb();
    assert.equal((await patch({ qr_code_value: tag })).status, 400, JSON.stringify(tag));
    assert.deepEqual(db.calls, []);
  }
});

test('other database errors stay generic', async () => {
  db = fakeDb({ update: { data: null, error: { code: 'XX000', message: 'SECRET_DATABASE_DETAILS' } } });
  const result = await patch({ qr_code_value: 'NIAH-PLT-00042' });
  assert.equal(result.status, 500);
  assert.ok(!JSON.stringify(result.body).includes('SECRET'));
});

test('a botanist can look up their own server plant by tag', async () => {
  db = fakePlantsDb({
    row: {
      id: PLANT,
      client_record_id: '33333333-3333-4333-8333-333333333333',
      registered_by: BOTANIST,
      qr_code_value: 'NIAH-PLT-00042',
      plant_status: 'pending',
      species: { scientific_name: 'Shorea sp.', common_name: 'Shorea' },
    },
  });

  const result = await getByTag();
  assert.equal(result.status, 200);
  assert.equal(result.body.data.plant_id, PLANT);
  assert.equal(result.body.data.species.scientific_name, 'Shorea sp.');
});

test('a botanist cannot look up another botanist pending plant', async () => {
  db = fakePlantsDb({
    row: {
      id: PLANT,
      registered_by: OTHER,
      qr_code_value: 'NIAH-PLT-00042',
      plant_status: 'pending',
    },
  });

  assert.equal((await getByTag()).status, 404);
});

test('a botanist can look up another botanist approved plant without owner details', async () => {
  db = fakePlantsDb({
    row: {
      id: PLANT,
      registered_by: OTHER,
      qr_code_value: 'NIAH-PLT-00042',
      plant_status: 'approved',
      species: { scientific_name: 'Shorea sp.', common_name: 'Shorea' },
    },
  });

  const result = await getByTag();
  assert.equal(result.status, 200);
  assert.equal(result.body.data.plant_id, PLANT);
  assert.equal('registered_by' in result.body.data, false);
});
