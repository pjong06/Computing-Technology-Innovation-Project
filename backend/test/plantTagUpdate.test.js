'use strict';

// PATCH /api/plants/:id with a new tag (a tag attached on the phone after upload).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const PLANT = '22222222-2222-4222-8222-222222222222';

let db;

const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth(req, res, next) {
      req.user = { id: BOTANIST };
      req.profile = { role: 'botanist', account_status: 'active' };
      req.supabase = db;
      next();
    },
    requireRole: (...roles) => (req, res, next) => {
      if (!roles.includes(req.profile.role)) return res.sendStatus(403);
      next();
    },
  },
};

const plantRouter = require('../src/routes/plants');

// owner: who registered the plant (null = not found). update: what the update returns.
function fakeDb({ owner = BOTANIST, update = { data: { id: PLANT, qr_code_value: 'NIAH-PLT-00042' }, error: null } } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, 'plants');
      return {
        select() {
          return {
            eq() { return this; },
            async maybeSingle() {
              calls.push('access-check');
              return { data: owner ? { id: PLANT, registered_by: owner } : null, error: null };
            },
          };
        },
        update(changes) {
          calls.push(['update', changes]);
          return {
            eq() { return this; },
            select() { return this; },
            async maybeSingle() { return update; },
          };
        },
      };
    },
  };
}

async function patch(body) {
  const app = express();
  app.use(express.json());
  app.use('/api/plants', plantRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/plants/${PLANT}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

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
