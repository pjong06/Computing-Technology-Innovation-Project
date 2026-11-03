'use strict';

// GET /api/observations/review-status: a botanist reads the officer's decision on their
// own observations.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const OBS_A = '22222222-2222-4222-8222-222222222222';
const OBS_B = '33333333-3333-4333-8333-333333333333';

let db;
let role = 'botanist';

const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth(req, res, next) {
      req.user = { id: BOTANIST };
      req.profile = { role, account_status: 'active' };
      req.supabase = db;
      next();
    },
    requireRole: (...roles) => (req, res, next) => {
      if (!roles.includes(req.profile.role)) return res.status(403).json({ message: 'Insufficient permissions' });
      next();
    },
  },
};

const router = require('../src/routes/observations');

function fakeDb(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const chain = {};
      for (const name of ['select', 'eq', 'in', 'is', 'order']) {
        chain[name] = (...args) => { calls.push([table, name, ...args]); return chain; };
      }
      chain.then = (resolve, reject) => {
        const answer = tables[table];
        const result = answer && answer.error ? { data: null, error: answer.error } : { data: answer ?? [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      };
      return chain;
    },
  };
}

async function get(query) {
  const app = express();
  app.use('/api/observations', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/observations/review-status${query}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('returns status and the latest rejection reason for own observations', async () => {
  role = 'botanist';
  db = fakeDb({
    observations: [
      { id: OBS_A, review_status: 'approved' },
      { id: OBS_B, review_status: 'rejected' },
    ],
    observation_reviews: [
      { observation_id: OBS_B, comments: 'Photo is blurry', reviewed_at: '2026-11-03T05:00:00Z' },
      { observation_id: OBS_B, comments: 'Older reason', reviewed_at: '2026-11-01T05:00:00Z' },
    ],
  });
  const result = await get(`?ids=${OBS_A},${OBS_B}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, [
    { id: OBS_A, review_status: 'approved', rejection_comment: null },
    { id: OBS_B, review_status: 'rejected', rejection_comment: 'Photo is blurry' },
  ]);
  // Only the signed-in botanist's own, not deleted, observations.
  assert.ok(db.calls.some(c => c[0] === 'observations' && c[1] === 'eq' && c[2] === 'observer_id' && c[3] === BOTANIST));
  assert.ok(db.calls.some(c => c[0] === 'observations' && c[1] === 'is' && c[2] === 'deleted_at' && c[3] === null));
  // Reasons are only looked up for rejected ones.
  assert.ok(db.calls.some(c => c[0] === 'observation_reviews' && c[1] === 'in' && c[3].length === 1 && c[3][0] === OBS_B));
});

test('no rejection reason lookup when nothing is rejected', async () => {
  db = fakeDb({ observations: [{ id: OBS_A, review_status: 'pending' }] });
  const result = await get(`?ids=${OBS_A}`);
  assert.equal(result.status, 200);
  assert.ok(!db.calls.some(c => c[0] === 'observation_reviews'));
});

test('statuses still come back if the reasons cannot be read', async () => {
  db = fakeDb({
    observations: [{ id: OBS_B, review_status: 'rejected' }],
    observation_reviews: { error: { message: 'permission denied' } },
  });
  const result = await get(`?ids=${OBS_B}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, [{ id: OBS_B, review_status: 'rejected', rejection_comment: null }]);
});

test('invalid or too many ids are refused before any database call', async () => {
  db = fakeDb({});
  for (const query of ['', '?ids=', '?ids=not-a-uuid', `?ids=${OBS_A},bad`,
    `?ids=${Array.from({ length: 101 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`).join(',')}`]) {
    assert.equal((await get(query)).status, 400, query.slice(0, 40));
  }
  assert.equal(db.calls.length, 0);
});

test('only botanists can use it', async () => {
  for (const other of ['officer', 'researcher', 'visitor']) {
    role = other;
    db = fakeDb({});
    assert.equal((await get(`?ids=${OBS_A}`)).status, 403);
    assert.equal(db.calls.length, 0);
  }
  role = 'botanist';
});

test('database failures are reported without details', async () => {
  db = fakeDb({ observations: { error: { message: 'SECRET_DATABASE_DETAILS' } } });
  const result = await get(`?ids=${OBS_A}`);
  assert.equal(result.status, 500);
  assert.ok(!JSON.stringify(result.body).includes('SECRET'));
});
