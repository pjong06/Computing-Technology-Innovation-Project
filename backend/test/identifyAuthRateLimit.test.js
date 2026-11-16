const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createIdentifyRateLimit } = require('../src/middleware/identifyRateLimit');

// Real auth middleware, with only the external Supabase provider stubbed.
// These are local boundary tests, not live-session acceptance.
process.env.SUPABASE_URL = 'https://identify.example.test';
let profileStatus = 'active';
let providerError = false;
let identifyCalls = 0;
let authCalls = 0;
const configPath = require.resolve('../src/config/supabase');
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: {
    verifier: { auth: { async getUser(token) {
      authCalls++;
      if (providerError) throw new Error('provider unavailable');
      try {
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        if (token.endsWith('.rejected') || claims.exp <= Date.now() / 1000) {
          return { data: { user: null }, error: new Error('invalid') };
        }
        return { data: { user: { id: claims.sub } }, error: null };
      } catch { return { data: { user: null }, error: new Error('invalid') }; }
    } } },
    forUser(token) {
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      return { from() { return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return {
          data: { id: claims.sub, role: claims.sub.split(':')[0], account_status: profileStatus }, error: null,
        }; },
      }; } };
    },
  },
};
const servicePath = require.resolve('../src/services/plantAiService');
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: {
  identifyPlant: async () => { identifyCalls++; return [{ scientificName: 'Test plant' }]; },
  PlantAiError: class extends Error {},
} };
const { createIdentifyRouter } = require('../src/routes/identify');

function tokenFor(user, { expired = false, rejected = false } = {}) {
  const claims = Buffer.from(JSON.stringify({
    sub: user, iss: `${process.env.SUPABASE_URL}/auth/v1`, aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600),
  })).toString('base64url');
  return `test.${claims}.${rejected ? 'rejected' : 'stubbed'}`;
}

async function withApp(options, run) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 3);
  app.use('/api/identify', createIdentifyRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const request = async ({ user = 'botanist:a', ip = '198.51.100.10', token, badBody = false, forged = '' } = {}) => {
      const headers = { 'X-Forwarded-For': `${forged}${ip}, 203.0.113.2, 203.0.113.3` };
      if (user !== null || token) headers.Authorization = `Bearer ${token || tokenFor(user)}`;
      let body;
      if (badBody) { headers['Content-Type'] = 'multipart/form-data'; body = 'invalid multipart'; }
      else {
        body = new FormData();
        body.append('image', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'plant.jpg');
      }
      return fetch(`http://127.0.0.1:${server.address().port}/api/identify`, { method: 'POST', headers, body });
    };
    await run(request);
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test('Identify auth: anonymous, invalid/expired tokens are denied before multipart parsing or AI', async () => {
  identifyCalls = 0;
  await withApp({}, async request => {
    assert.equal((await request({ user: null, badBody: true })).status, 401);
    assert.equal((await request({ token: 'malformed', badBody: true })).status, 401);
    for (const options of [{ expired: true }, { rejected: true }]) {
      assert.equal((await request({ token: tokenFor('botanist:a', options), badBody: true })).status, 401);
    }
    assert.equal(identifyCalls, 0);
  });
});

test('Identify auth: only active botanists and officers can use AI', async () => {
  identifyCalls = 0;
  await withApp({}, async request => {
    for (const role of ['visitor', 'researcher', 'admin']) {
      assert.equal((await request({ user: `${role}:a`, badBody: true })).status, 403);
    }
    for (const status of ['suspended', 'pending']) {
      profileStatus = status;
      assert.equal((await request({ badBody: true })).status, 403);
    }
    profileStatus = 'active';
    assert.equal(identifyCalls, 0);
    for (const role of ['botanist', 'officer']) {
      const response = await request({ user: `${role}:a` });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).success, true);
    }
    assert.equal(identifyCalls, 2);
  });
});

test('Identify auth: provider outage fails closed without invoking AI', async () => {
  identifyCalls = 0;
  providerError = true;
  try {
    await withApp({}, async request => {
      assert.equal((await request()).status, 503);
      assert.equal(identifyCalls, 0);
    });
  } finally { providerError = false; }
});

test('Identify rate limit: user quota follows verified ID across IPs and recovers', async () => {
  identifyCalls = 0;
  let now = 0;
  await withApp({ userLimit: 1, windowMs: 1000, now: () => now }, async request => {
    assert.equal((await request()).status, 200);
    const denied = await request({ ip: '198.51.100.11' });
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('retry-after'), '1');
    assert.equal(denied.headers.get('cache-control'), 'no-store');
    assert.equal(identifyCalls, 1);
    assert.equal((await request({ user: 'botanist:b' })).status, 200);
    now = 1000;
    assert.equal((await request()).status, 200);
  });
});

test('Identify rate limit: IP quota spans users, ignores forged prefix and protects Auth', async () => {
  authCalls = 0;
  await withApp({ ipLimit: 1 }, async request => {
    assert.equal((await request({ user: null })).status, 401);
    const denied = await request({ user: 'officer:b', forged: '192.0.2.44, ' });
    assert.equal(denied.status, 429);
    assert.equal(authCalls, 0);
    assert.equal((await request({ user: 'officer:b', ip: '198.51.100.11' })).status, 200);
  });
});

test('Identify rate limit: bounded capacity and invalid policies', () => {
  assert.throws(() => createIdentifyRateLimit({ limit: 0 }), /Invalid/);
  let now = 0;
  const limiter = createIdentifyRateLimit({ limit: 1, maxClients: 1, windowMs: 1000, now: () => now, keyFor: req => req.ip });
  function request(ip) {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json() {} };
    limiter({ ip }, res, () => {});
    return res.code;
  }
  assert.equal(request('a'), 200);
  assert.equal(request('b'), 503);
  now = 1000;
  assert.equal(request('b'), 200);
});
