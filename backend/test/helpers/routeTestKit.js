'use strict';

// Shared pieces for route tests: a stand-in for the auth middleware and a helper that
// starts the router on a random local port, sends one request and stops it again.
// Not a test file itself (npm test only runs test/*.test.js).
const express = require('express');

// Replaces src/middleware/auth for this test process, so routes see a signed-in user
// without a real token. Call it BEFORE requiring the route under test.
// current() is read on every request and returns { userId, role, db }, so a test can
// switch the user's role or fake database between requests.
function mockAuth(current) {
  const authPath = require.resolve('../../src/middleware/auth');
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      requireAuth(req, res, next) {
        const signedIn = current();
        req.user = { id: signedIn.userId };
        req.profile = { role: signedIn.role, account_status: 'active' };
        req.supabase = signedIn.db;
        next();
      },
      requireRole: (...roles) => (req, res, next) => {
        if (!roles.includes(req.profile.role)) {
          return res.status(403).json({ message: 'Insufficient permissions' });
        }
        next();
      },
    },
  };
}

// Mounts router at mountPath, sends one request to mountPath + path and returns
// { status, body } with the JSON body. body (optional) is sent as JSON.
async function callRoute(mountPath, router, { method = 'GET', path = '', body } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(mountPath, router);

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${mountPath}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// A fake Supabase client with only the plants table, for the plant tag routes.
// row: what a plants lookup finds (null = no plant). update: what a plants update returns.
// lookupLabel: when set, every lookup is recorded in calls under that name.
// rpcResult: when set, any rpc() call is recorded and returns it.
function fakePlantsDb({ row, update, lookupLabel, rpcResult }) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      if (table !== 'plants') throw new Error(`Unexpected table: ${table}`);
      return {
        select() {
          return {
            eq() { return this; },
            async maybeSingle() {
              if (lookupLabel) calls.push(lookupLabel);
              return { data: row, error: null };
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
  if (rpcResult !== undefined) {
    db.rpc = async name => {
      calls.push(['rpc', name]);
      return { data: rpcResult, error: null };
    };
  }
  return db;
}

module.exports = { mockAuth, callRoute, fakePlantsDb };
