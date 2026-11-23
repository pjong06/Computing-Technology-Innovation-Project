'use strict';

// Answers the app treats as permanent (Sync details: "Remove from phone", no Retry): a plant
// or observation removed on the server, and photos on a plant that was already reviewed.
// Each comes with a machine-readable code; the message says what happened in plain words.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const PLANT = '22222222-2222-4222-8222-222222222222';
const OBSERVATION = '33333333-3333-4333-8333-333333333333';

let db;
mockAuth(() => ({ userId: BOTANIST, role: 'botanist', db }));
const observationsRouter = require('../src/routes/observations');
const plantsRouter = require('../src/routes/plants');

// Each table answers maybeSingle() with rows[table]; an update is recorded and refused.
function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      const chain = {};
      for (const name of ['select', 'eq', 'in', 'is']) {
        chain[name] = (...args) => { calls.push([table, name, ...args]); return chain; };
      }
      chain.update = values => { calls.push([table, 'update', values]); return chain; };
      chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
      return chain;
    },
  };
}

const submit = () => callRoute('/api/observations', observationsRouter, { method: 'PATCH', path: `/${OBSERVATION}/submit` });

test('submit: the plant was removed on the server -> 410 plant_deleted, nothing is changed', async () => {
  db = fakeDb({
    observations: { id: OBSERVATION, observer_id: BOTANIST, review_status: 'draft', plant_id: PLANT, deleted_at: null },
    plants: { id: PLANT, deleted_at: '2026-11-20T00:00:00Z' },
  });
  const result = await submit();
  assert.equal(result.status, 410);
  assert.deepEqual(result.body, { message: 'This plant was removed on the server.', code: 'plant_deleted' });
  assert.ok(!db.calls.some(call => call[1] === 'update'));

  // A plant the botanist can no longer see at all is the same answer.
  db = fakeDb({ observations: { id: OBSERVATION, observer_id: BOTANIST, review_status: 'draft', plant_id: PLANT } });
  assert.equal((await submit()).body.code, 'plant_deleted');
});

test('submit: the observation was removed on the server -> code observation_deleted (still 404)', async () => {
  db = fakeDb({ observations: { id: OBSERVATION, observer_id: BOTANIST, review_status: 'draft', plant_id: PLANT, deleted_at: '2026-11-20T00:00:00Z' } });
  const result = await submit();
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'observation_deleted');
  db = fakeDb({});
  assert.equal((await submit()).body.code, 'observation_deleted');
});

test('submit: an observation already reviewed cannot be sent again -> submit_refused', async () => {
  db = fakeDb({
    observations: { id: OBSERVATION, observer_id: BOTANIST, review_status: 'approved', plant_id: PLANT },
    plants: { id: PLANT, deleted_at: null },
  });
  const result = await submit();
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'submit_refused');
});

test('plant photo: a plant removed on the server -> 410 plant_deleted; a reviewed plant -> photos_locked', async () => {
  const upload = () => callRoute('/api/plants', plantsRouter, { method: 'POST', path: `/${PLANT}/photo`, body: {} });
  db = fakeDb({ plants: { id: PLANT, registered_by: BOTANIST, plant_status: 'pending', deleted_at: '2026-11-20T00:00:00Z' } });
  let result = await upload();
  assert.equal(result.status, 410);
  assert.equal(result.body.code, 'plant_deleted');

  db = fakeDb({ plants: { id: PLANT, registered_by: BOTANIST, plant_status: 'approved', deleted_at: null } });
  result = await upload();
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'photos_locked');
});

test('observation photo: its plant removed on the server -> 410 plant_deleted', async () => {
  db = fakeDb({
    observations: { id: OBSERVATION, observer_id: BOTANIST, review_status: 'draft', plant_id: PLANT, deleted_at: null },
    plants: { id: PLANT, deleted_at: '2026-11-20T00:00:00Z' },
  });
  const result = await callRoute('/api/observations', observationsRouter, { method: 'POST', path: `/${OBSERVATION}/photo`, body: {} });
  assert.equal(result.status, 410);
  assert.equal(result.body.code, 'plant_deleted');
});
