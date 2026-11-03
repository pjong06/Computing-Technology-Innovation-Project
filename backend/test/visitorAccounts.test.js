const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { hasExpectedClaims } = require('../src/middleware/verifiedJwtClaims');

// Visitor accounts: /api/me admits them; every staff route keeps refusing them.

// An isolated trusted test key, not a Supabase production signing key.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const projectUrl = 'https://visitor-test.example';
const userId = 'test-user';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function signedToken() {
  const claims = { iss: `${projectUrl}/auth/v1`, aud: 'authenticated', sub: userId };
  const payload = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode(claims)}`;
  return `${payload}.${crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url')}`;
}

// Loads the REAL src/middleware/auth.js with a fake Supabase that returns `profile`.
function authModuleWithProfile(profile) {
  const source = fs.readFileSync(path.join(__dirname, '../src/middleware/auth.js'), 'utf8');
  const exported = { exports: {} };
  vm.runInNewContext(source, {
    module: exported,
    process: { env: { SUPABASE_URL: projectUrl } },
    require(name) {
      if (name === './bearerToken') return require('../src/middleware/bearerToken');
      if (name === './verifiedJwtClaims') return { hasExpectedClaims };
      if (name !== '../config/supabase') throw new Error('Unexpected test dependency');
      return {
        verifier: { auth: { async getUser(token) {
          const parts = token.split('.');
          const valid = crypto.verify(null, Buffer.from(parts.slice(0, 2).join('.')), publicKey, Buffer.from(parts[2], 'base64url'));
          return { data: { user: valid ? { id: userId, email: 'v@example.com' } : null }, error: valid ? null : new Error('bad') };
        } } },
        forUser() {
          return { from() { return { select() { return { eq() { return { async maybeSingle() {
            return { data: profile, error: null };
          } }; } }; } }; } };
        },
      };
    },
  });
  return exported.exports;
}

async function run(middleware) {
  const result = { status: 200, nextCalled: false, body: null, req: null };
  const req = { get: name => (name.toLowerCase() === 'authorization' ? `Bearer ${signedToken()}` : undefined) };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await middleware(req, res, () => { result.nextCalled = true; });
  result.req = req;
  return result;
}

const activeVisitor = { id: userId, role: 'visitor', account_status: 'active' };

test('staff routes (requireAuth) refuse an active visitor account', async () => {
  const result = await run(authModuleWithProfile(activeVisitor).requireAuth);
  assert.equal(result.status, 403);
  assert.equal(result.body.message, 'Active staff profile required');
  assert.equal(result.nextCalled, false);
});

test('requireAccount admits an active visitor (for /api/me only)', async () => {
  const result = await run(authModuleWithProfile(activeVisitor).requireAccount);
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.profile.role, 'visitor');
});

for (const [name, profile] of [
  ['a pending visitor', { id: userId, role: 'visitor', account_status: 'pending' }],
  ['a suspended visitor', { id: userId, role: 'visitor', account_status: 'suspended' }],
  ['an unknown role', { id: userId, role: 'guest', account_status: 'active' }],
  ['no profile', null],
]) {
  test(`requireAccount still refuses ${name}`, async () => {
    const result = await run(authModuleWithProfile(profile).requireAccount);
    assert.equal(result.status, 403);
    assert.equal(result.nextCalled, false);
  });
}

test('requireAccount still admits active staff', async () => {
  const result = await run(authModuleWithProfile({ id: userId, role: 'botanist', account_status: 'active' }).requireAccount);
  assert.equal(result.nextCalled, true);
});

test('role checks refuse visitors for every staff role', () => {
  const { requireRole } = authModuleWithProfile(activeVisitor);
  for (const roles of [['botanist'], ['officer'], ['botanist', 'officer'], ['botanist', 'officer', 'researcher']]) {
    let status = 200;
    let passed = false;
    requireRole(...roles)(
      { profile: activeVisitor },
      { status(code) { status = code; return this; }, json() { return this; } },
      () => { passed = true; }
    );
    assert.equal(status, 403, roles.join(','));
    assert.equal(passed, false);
  }
});

test('/api/me returns the visitor role', async () => {
  const { createMeRouter } = require('../src/routes/me');
  const app = express();
  app.use('/api/me', createMeRouter({
    authenticate(req, res, next) {
      req.user = { id: userId, email: 'v@example.com' };
      req.profile = activeVisitor;
      next();
    },
  }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/me`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: userId, email: 'v@example.com', role: 'visitor' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('no route other than /api/me admits visitor accounts', () => {
  const routesDir = path.join(__dirname, '../src/routes');
  for (const file of fs.readdirSync(routesDir)) {
    if (!file.endsWith('.js') || file === 'me.js') continue;
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    assert.doesNotMatch(source, /requireAccount|ACCOUNT_ROLES/, file);
  }
  const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.doesNotMatch(server, /requireAccount/);
});
