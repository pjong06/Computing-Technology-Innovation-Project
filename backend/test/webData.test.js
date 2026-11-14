'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const USER = '11111111-1111-4111-8111-111111111111';
const SECOND_USER = '22222222-2222-4222-8222-222222222222';
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
      for (const name of ['select', 'order', 'in', 'delete']) {
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
  const text = await response.text();
  let bodyJson;
  try {
    bodyJson = JSON.parse(text);
  } catch {
    bodyJson = null;
  }
  return { status: response.status, body: bodyJson };
}

test('only the officer can read website users', async () => {
  db = fakeDb([{ id: USER, email: 'officer@example.com' }]);
  role = 'botanist';
  await withApp(async base => {
    assert.deepEqual((await call(`${base}/users`)).body, { data: [] });
  });
  assert.equal(db.calls.length, 0);

  role = 'officer';
  await withApp(async base => {
    assert.deepEqual((await call(`${base}/users`)).body, {
      data: [{ id: USER, email: 'officer@example.com' }],
    });
  });
  assert.ok(db.calls.some(call => call[0] === 'website_users' && call[1] === 'select'));
});

test('only the officer can change website users', async () => {
  db = fakeDb();
  role = 'researcher';
  await withApp(async base => {
    const result = await call(`${base}/users`, 'PUT', { rows: [] });
    assert.equal(result.status, 403);
    assert.equal(result.body.message, 'Only the officer can change the website data');
  });
  assert.equal(db.calls.length, 0);
});

test('officer user changes are saved and removed from website_users', async () => {
  db = fakeDb();
  role = 'officer';
  await withApp(async base => {
    const result = await call(`${base}/users`, 'PUT', {
      rows: [{ id: USER, name: ' Example ', username: ' phoebe ', email: ' person@example.com ', role: 'Officer' }],
      removed: [SECOND_USER, 'not-a-uuid'],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].name, 'Example');
    assert.equal(result.body.data[0].username, 'phoebe');
    assert.equal(result.body.data[0].email, 'person@example.com');
    assert.equal(result.body.data[0].sort_order, 0);
  });
  assert.ok(db.calls.some(call => call[0] === 'website_users' && call[1] === 'upsert'));
  assert.ok(db.calls.some(call => call[0] === 'website_users' && call[1] === 'in' && call[2] === 'id' && call[3][0] === SECOND_USER));
  assert.ok(!db.calls.some(call => call[0] !== 'website_users'));
});

test('the legacy species, observations and key/value routes are gone', async () => {
  db = fakeDb();
  role = 'officer';
  await withApp(async base => {
    for (const path of ['/species', '/observations', '/', '/niah_data_version']) {
      assert.equal((await call(`${base}${path}`)).status, 404, `GET ${path}`);
      if (path !== '/') {
        assert.equal((await call(`${base}${path}`, 'PUT', { rows: [] })).status, 404, `PUT ${path}`);
      }
    }
  });
  assert.equal(db.calls.length, 0);
});
