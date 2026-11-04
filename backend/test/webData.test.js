'use strict';

// /api/web-data: only the officer may change website data; other staff may read it
// (except the user list).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const USER = '11111111-1111-4111-8111-111111111111';
let db;
let role = 'officer';

const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth(req, res, next) {
      req.user = { id: USER };
      req.profile = { role, account_status: 'active' };
      req.supabase = db;
      next();
    },
    requireRole: () => (req, res, next) => next(),
  },
};

const router = require('../src/routes/webData');

function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    from(table) {
      const chain = {};
      for (const name of ['select', 'order', 'in', 'delete', 'eq']) {
        chain[name] = (...args) => { calls.push([table, name, ...args]); return chain; };
      }
      chain.upsert = (...args) => { calls.push([table, 'upsert', ...args]); return chain; };
      chain.then = (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return chain;
    },
  };
}

async function withApp(run) {
  const app = express();
  app.use(express.json());
  app.use('/api/web-data', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/web-data`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

async function call(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

const speciesRow = { id: '22222222-2222-4222-8222-222222222222', scientific_name: 'Nepenthes ampullaria' };
const observationRow = { id: 'NP-2026-0001', scientific_name: 'Nepenthes ampullaria' };

for (const other of ['botanist', 'researcher']) {
  test(`a ${other} cannot change any website data`, async () => {
    role = other;
    db = fakeDb();
    await withApp(async base => {
      for (const [path, body] of [
        ['/species', { rows: [speciesRow] }],
        ['/observations', { rows: [{ ...observationRow, state: 'Approved' }] }],
        ['/users', { rows: [] }],
        ['/niah_data_version', { value: 4 }],
      ]) {
        const result = await call(base + path, 'PUT', body);
        assert.equal(result.status, 403, path);
        assert.equal(result.body.message, 'Only the officer can change the website data');
      }
    });
    assert.ok(!db.calls.some(c => c[1] === 'upsert' || c[1] === 'delete'));
    role = 'officer';
  });
}

test('the officer can save the catalogue and the data version', async () => {
  role = 'officer';
  db = fakeDb();
  await withApp(async base => {
    assert.equal((await call(`${base}/species`, 'PUT', { rows: [speciesRow] })).status, 200);
    assert.equal((await call(`${base}/niah_data_version`, 'PUT', { value: 4 })).status, 200);
  });
  assert.ok(db.calls.some(c => c[0] === 'website_species' && c[1] === 'upsert'));
  assert.ok(db.calls.some(c => c[0] === 'web_data' && c[1] === 'upsert'));
});

test('other staff can still read the catalogue and observations', async () => {
  role = 'botanist';
  db = fakeDb([speciesRow]);
  await withApp(async base => {
    assert.deepEqual((await call(`${base}/species`)).body, { data: [speciesRow] });
    assert.equal((await call(`${base}/observations`)).status, 200);
  });
  role = 'officer';
});

test('only the officer sees the user list', async () => {
  role = 'botanist';
  db = fakeDb([{ id: USER, email: 'someone@example.com' }]);
  await withApp(async base => assert.deepEqual((await call(`${base}/users`)).body, { data: [] }));
  assert.equal(db.calls.length, 0);
  role = 'officer';
  db = fakeDb([{ id: USER, email: 'someone@example.com' }]);
  await withApp(async base => assert.equal((await call(`${base}/users`)).body.data.length, 1));
});
