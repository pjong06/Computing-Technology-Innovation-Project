'use strict';

// PATCH /api/observations/:id/submit when row-level security refuses the update: a plain
// 403 the app can show on the visit, not a 500 that it retries on every sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const OBSERVATION = '44444444-4444-4444-8444-444444444444';

let db;
mockAuth(() => ({ userId: BOTANIST, role: 'botanist', db }));
const router = require('../src/routes/observations');

// select(...).eq(...).maybeSingle() answers the read; update(...)...maybeSingle() answers
// with updateResult.
function fakeDb(row, updateResult) {
  const calls = [];
  return {
    calls,
    from(table) {
      let isUpdate = false;
      const chain = {};
      for (const name of ['select', 'eq', 'in']) {
        chain[name] = (...args) => { calls.push([table, name, ...args]); return chain; };
      }
      chain.update = values => { isUpdate = true; calls.push([table, 'update', values]); return chain; };
      chain.maybeSingle = async () => (isUpdate ? updateResult : { data: row, error: null });
      return chain;
    },
  };
}

const submit = () => callRoute('/api/observations', router, { method: 'PATCH', path: `/${OBSERVATION}/submit` });

test('submit refused by row-level security returns a plain 403, not 500', async () => {
  db = fakeDb(
    { id: OBSERVATION, observer_id: BOTANIST, review_status: 'draft' },
    { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "observations"' } }
  );
  const result = await submit();
  assert.equal(result.status, 403);
  assert.equal(result.body.message, "This visit can't be sent for review. Please contact the officer.");
  // The update was attempted as the botanist, only on their own draft/rejected visit.
  assert.ok(db.calls.some(c => c[1] === 'update' && c[2].review_status === 'pending'));
  assert.ok(db.calls.some(c => c[1] === 'eq' && c[2] === 'observer_id' && c[3] === BOTANIST));
});

test('other database errors on submit still return 500', async () => {
  db = fakeDb(
    { id: OBSERVATION, observer_id: BOTANIST, review_status: 'draft' },
    { data: null, error: { code: '08006', message: 'connection failure' } }
  );
  const result = await submit();
  assert.equal(result.status, 500);
  assert.equal(result.body.message, 'Failed to submit observation');
});

test('a draft visit is submitted (pending) when the update is allowed', async () => {
  db = fakeDb(
    { id: OBSERVATION, observer_id: BOTANIST, review_status: 'draft' },
    { data: { id: OBSERVATION, observer_id: BOTANIST, review_status: 'pending' }, error: null }
  );
  const result = await submit();
  assert.equal(result.status, 200);
  assert.equal(result.body.observation.review_status, 'pending');
});
