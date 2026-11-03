const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { hasExpectedClaims } = require('../src/middleware/verifiedJwtClaims');

// ---- 1. requireAuth (the real middleware) refuses accounts that aren't active staff ----

// An isolated trusted test key, not a Supabase production signing key.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const projectUrl = 'https://activation-test.example';
const userId = 'test-user';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function signedToken() {
  const claims = { iss: `${projectUrl}/auth/v1`, aud: 'authenticated', sub: userId };
  const payload = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode(claims)}`;
  return `${payload}.${crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url')}`;
}

// Loads src/middleware/auth.js with a fake Supabase that returns `profile`.
function requireAuthWithProfile(profile) {
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
          return { data: { user: valid ? { id: userId } : null }, error: valid ? null : new Error('Invalid signature') };
        } } },
        forUser() {
          return { from() { return { select() { return { eq() { return { async maybeSingle() {
            return { data: profile, error: null };
          } }; } }; } }; } };
        },
      };
    },
  });
  return exported.exports.requireAuth;
}

async function runRequireAuth(profile) {
  const middleware = requireAuthWithProfile(profile);
  const result = { status: 200, nextCalled: false, body: null };
  const req = { get: name => (name.toLowerCase() === 'authorization' ? `Bearer ${signedToken()}` : undefined) };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await middleware(req, res, () => { result.nextCalled = true; });
  return result;
}

for (const [name, profile] of [
  ['a self-registered pending account with no role', { id: userId, role: null, account_status: 'pending' }],
  ['a pending account that still has the botanist role', { id: userId, role: 'botanist', account_status: 'pending' }],
  ['a suspended officer', { id: userId, role: 'officer', account_status: 'suspended' }],
  ['an active account with no role', { id: userId, role: null, account_status: 'active' }],
  ['an active account with a non-staff role', { id: userId, role: 'visitor', account_status: 'active' }],
  ['a user with no profile row', null],
]) {
  test(`requireAuth refuses ${name}`, async () => {
    const result = await runRequireAuth(profile);
    assert.equal(result.status, 403);
    assert.equal(result.nextCalled, false);
  });
}

test('requireAuth still lets an active botanist through', async () => {
  const result = await runRequireAuth({ id: userId, role: 'botanist', account_status: 'active' });
  assert.equal(result.nextCalled, true);
});

// ---- 2. The migration: sign-ups start pending; users can't write role/status ----

const repoRoot = path.join(__dirname, '../..');
const migration = fs.readFileSync(
  path.join(repoRoot, 'supabase/migrations/20261105090000_signup_pending_approval.sql'), 'utf8');
// The CREATE OR REPLACE body of one function in the migration.
function functionBody(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start !== -1, `${name} is defined`);
  const end = migration.indexOf('$function$;', start);
  return migration.slice(start, end);
}

test('migration runs as one transaction', () => {
  assert.match(migration, /^BEGIN;$/m);
  assert.match(migration, /^COMMIT;$/m);
});

test('new sign-ups get a pending profile and an inactive website_users row', () => {
  const body = functionBody('handle_website_signup');
  assert.match(body, /values \(new\.id, shown_name, 'botanist', 'pending'\)/);
  assert.doesNotMatch(body, /'active'\)/);
  assert.match(body, /new\.email, 'Botanist', false,/);
  // Role and status come from the function, never from the user's sign-up metadata.
  assert.doesNotMatch(body, /raw_user_meta_data->>'(role|account_status|active)'/);
});

test('syncing an inactive website_users row keeps a pending profile pending', () => {
  const body = functionBody('sync_website_user_to_profile');
  assert.match(body, /when account_status = ''pending'' then ''pending''/);
  assert.match(body, /case when %L::boolean then ''active''/);
});

test('signed-in users lose UPDATE on role and account_status, keep full_name', () => {
  assert.match(migration, /REVOKE UPDATE ON TABLE public\.profiles FROM authenticated, anon;/);
  assert.match(migration, /REVOKE UPDATE \(role, account_status\) ON public\.profiles FROM authenticated, anon;/);
  assert.match(migration, /GRANT UPDATE \(full_name\) ON public\.profiles TO authenticated;/);
  assert.doesNotMatch(migration, /GRANT UPDATE \([^)]*(role|account_status)/);
});

test('existing accounts and policies are left alone', () => {
  assert.doesNotMatch(migration, /^\s*UPDATE public\.profiles/im);
  assert.doesNotMatch(migration, /DROP POLICY|CREATE POLICY|ALTER POLICY/i);
});

// ---- 3. Web portal: no public sign-up page or link ----

test('the web portal has no public sign-up page or link', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'frontend/signup.html')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'frontend/js/signup.js')), false);
  const login = fs.readFileSync(path.join(repoRoot, 'frontend/login.html'), 'utf8');
  assert.doesNotMatch(login, /signup\.html|Create an account/i);
  const shared = fs.readFileSync(path.join(repoRoot, 'frontend/js/shared.js'), 'utf8');
  const openPages = shared.slice(shared.indexOf('const OPEN_PAGES'), shared.indexOf('];', shared.indexOf('const OPEN_PAGES')));
  assert.doesNotMatch(openPages, /signup/);
});
