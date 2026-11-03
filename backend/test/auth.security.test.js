const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAuthRouter } = require('../src/routes/auth');
const { createClient } = require('@supabase/supabase-js');
const ID = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);
const PASSWORD = 'TestOnlyAa1'.repeat(2);
const NOW = 1800000000000;
const CONFIG = { PASSWORD_RECOVERY_ENABLED: 'true', PASSWORD_RESET_REDIRECT_URL: 'https://example.test/recovery' };

test('OTP endpoint verifies recovery proof and updates only verified session', async t => {
  const s = await setup(t);
  const result = await s.request('/verify-and-change-password', { email:'user@example.test',code:'123456',newPassword:PASSWORD });
  assert.equal(result.status,200);
  assert.equal(result.body.success,true);
  assert.deepEqual(s.calls[0],['verify',{email:'user@example.test',token:'123456',type:'recovery'}]);
  assert.deepEqual(s.calls.map(c=>c[0]),['verify','user','update','logout']);
});

test('OTP endpoint rejects invalid/expired proof and overposted identity', async t => {
  const s = await setup(t,{recovery:{data:{user:null,session:null},error:{code:'otp_expired'}}});
  assert.equal((await s.request('/verify-and-change-password',{email:'user@example.test',code:'123456',newPassword:PASSWORD})).status,401);
  assert.equal((await s.request('/verify-and-change-password',{email:'user@example.test',code:'abc',newPassword:PASSWORD})).status,401);
  assert.equal((await s.request('/verify-and-change-password',{email:'user@example.test',code:'123456',newPassword:PASSWORD,user_id:ID})).status,400);
  assert.ok(!s.calls.some(c=>c[0]==='update'));
});

test('staff OTP adapters preserve identifier without exposing resolved email', async t => {
  const s=await setup(t,{staffEmail:'user@example.test'});
  const sent=await s.request('/send-reset-code',{identifier:'STAFF-001'});
  assert.equal(sent.status,202); assert.equal(sent.body.email,'STAFF-001');
  assert.doesNotMatch(JSON.stringify(sent.body),/user@example/);
  assert.equal((await s.request('/verify-and-change-password',{email:sent.body.email,code:'123456',newPassword:PASSWORD})).status,200);
});

test('new OTP mail endpoint keeps unknown staff generic and throttles', async t => {
  const s=await setup(t);
  for(let i=0;i<3;i++)assert.equal((await s.request('/send-reset-code',{identifier:'UNKNOWN-1'})).status,202);
  assert.equal((await s.request('/send-reset-code',{identifier:'UNKNOWN-1'})).status,429);
  assert.equal(s.created(),0);
});

async function setup(t, options = {}) {
  const calls = [];
  const client = { auth: {
    resetPasswordForEmail: async (...args) => { calls.push(['email', ...args]); return { error: options.mailError || null }; },
    verifyOtp: async args => {
      calls.push(['verify', args]);
      if (options.verifyThrows) throw new Error('private upstream details');
      return options.recovery || { data: { user: { id: ID }, session: {
        access_token: 'test-only-session', expires_at: NOW / 1000 + 60, user: { id: ID },
      } }, error: null };
    },
    getUser: async token => { calls.push(['user', token]); return options.user || { data: { user: { id: ID } }, error: null }; },
    updateUser: async args => { calls.push(['update', args]); return { error: options.updateError || null }; },
    signOut: async args => { calls.push(['logout', args]); return { error: null }; },
  } };
  let created = 0;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api/auth', createAuthRouter({ createRecoveryClient: () => { created++; return client; },
    resolveStaffEmail: async () => options.staffEmail || null,
    now: () => NOW, config: options.config || CONFIG }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const request = async (path, body, extraHeaders = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  return { request, calls, created: () => created };
}

for (const headers of [{}, { authorization: 'Bearer test-only-normal-login' }]) {
  test('old password endpoint never creates an admin or recovery client', async t => {
    const s = await setup(t);
    assert.equal((await s.request('/temp-password', { identifier: 'victim@example.test', tempPassword: PASSWORD }, headers)).status, 410);
    assert.equal(s.created(), 0);
    assert.deepEqual(s.calls, []);
  });
}

test('missing recovery proof cannot modify any password', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/reset-password', { password: PASSWORD })).status, 401);
  assert.equal(s.created(), 0);
});

for (const errorCode of ['otp_expired', 'otp_disabled', 'invalid_token']) {
  test(`Supabase rejects ${errorCode} before password update`, async t => {
    const s = await setup(t, { recovery: { data: { session: null, user: null }, error: { code: errorCode } } });
    const r = await s.request('/reset-password', { token_hash: HASH, password: PASSWORD });
    assert.equal(r.status, 401);
    assert.ok(!s.calls.some(c => c[0] === 'update'));
    assert.doesNotMatch(JSON.stringify(r.body), new RegExp(HASH));
  });
}

for (const expires of [NOW / 1000 - 1, NOW / 1000, undefined]) {
  test(`expired or missing session expiry ${expires} is rejected`, async t => {
    const s = await setup(t, { recovery: { data: { user: { id: ID }, session: {
      access_token: 'test-only-session', expires_at: expires, user: { id: ID },
    } }, error: null } });
    assert.equal((await s.request('/reset-password', { token_hash: HASH, password: PASSWORD })).status, 401);
    assert.ok(!s.calls.some(c => c[0] === 'update'));
  });
}

test('forged identity and ordinary login tokens cannot replace recovery verification', async t => {
  const s = await setup(t);
  for (const extra of [{ user_id: ID }, { type: 'recovery' }, { access_token: 'test-only-normal-login' }]) {
    assert.equal((await s.request('/reset-password', { token_hash: HASH, password: PASSWORD, ...extra })).status, 400);
  }
  assert.equal(s.created(), 0);
});

for (const user of [{ data: { user: null }, error: { message: 'invalid JWT' } },
  { data: { user: { id: 'other-user' } }, error: null }]) {
  test('server-side user verification failure blocks password update', async t => {
    const s = await setup(t, { user });
    assert.equal((await s.request('/reset-password', { token_hash: HASH, password: PASSWORD })).status, 401);
    assert.ok(!s.calls.some(c => c[0] === 'update'));
  });
}

test('verified unexpired recovery session updates only its own user', async t => {
  const s = await setup(t);
  const r = await s.request('/reset-password', { token_hash: HASH, password: PASSWORD });
  assert.equal(r.status, 200);
  assert.deepEqual(s.calls.map(c => c[0]), ['verify', 'user', 'update', 'logout']);
  assert.deepEqual(s.calls[0][1], { token_hash: HASH, type: 'recovery' });
  assert.deepEqual(s.calls[2][1], { password: PASSWORD });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.doesNotMatch(JSON.stringify(r.body), /test-only-session/);
});

test('upstream errors are sanitized and recovery session is cleaned up', async t => {
  const s = await setup(t, { verifyThrows: true });
  const r = await s.request('/reset-password', { token_hash: HASH, password: PASSWORD });
  assert.equal(r.status, 503);
  assert.doesNotMatch(JSON.stringify(r.body), /private upstream details/);
  assert.equal(s.calls.at(-1)[0], 'logout');
});

test('weak passwords are rejected before consuming recovery proof', async t => {
  const s = await setup(t);
  for (const password of ['short', 'lowercaseonly123', 'X'.repeat(129)]) {
    assert.equal((await s.request('/reset-password', { token_hash: HASH, password })).status, 400);
  }
  assert.equal(s.created(), 0);
});

test('provider password policy rejection does not report success', async t => {
  const s = await setup(t, { updateError: { code: 'weak_password' } });
  assert.equal((await s.request('/reset-password', { token_hash: HASH, password: PASSWORD })).status, 400);
});

test('recovery stays disabled until deployment configuration is confirmed', async t => {
  const s = await setup(t, { config: {} });
  assert.equal((await s.request('/forgot-password', { email: 'user@example.test' })).status, 503);
  assert.equal((await s.request('/reset-password', { token_hash: HASH, password: PASSWORD })).status, 503);
  assert.equal(s.created(), 0);
});

test('email delivery uses only the configured redirect and generic responses', async t => {
  const s = await setup(t, { mailError: { message: 'unknown account or provider failure' } });
  const r = await s.request('/forgot-password', { email: ' USER@Example.test ', redirectTo: 'https://attacker.test' });
  assert.equal(r.status, 202);
  assert.deepEqual(s.calls[0], ['email', 'user@example.test', { redirectTo: CONFIG.PASSWORD_RESET_REDIRECT_URL }]);
  assert.doesNotMatch(JSON.stringify(r.body), /unknown account|provider failure/);
});

for (const redirect of ['javascript:alert(1)', 'http://untrusted.test', 'https://user:pass@example.test/recovery']) {
  test('unsafe recovery redirect is rejected', async t => {
    const s = await setup(t, { config: { ...CONFIG, PASSWORD_RESET_REDIRECT_URL: redirect } });
    assert.equal((await s.request('/forgot-password', { email: 'user@example.test' })).status, 503);
    assert.equal(s.created(), 0);
  });
}

test('email input validation and process-local throttling limit abuse', async t => {
  const s = await setup(t);
  assert.equal((await s.request('/forgot-password', { email: 'invalid' })).status, 400);
  for (let i = 0; i < 3; i++) assert.equal((await s.request('/forgot-password', { email: 'user@example.test' })).status, 202);
  assert.equal((await s.request('/forgot-password', { email: 'user@example.test' })).status, 429);
  assert.equal(s.calls.filter(c => c[0] === 'email').length, 3);
});

test('normal Supabase password login still uses the user endpoint', async () => {
  const requests = [];
  const client = createClient('https://example.supabase.co', 'test-only-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ access_token: 'test-only-login', token_type: 'bearer',
        expires_in: 3600, refresh_token: 'test-only-refresh', user: { id: ID } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  const result = await client.auth.signInWithPassword({ email: 'user@example.test', password: PASSWORD });
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, ID);
  assert.match(requests[0].url, /auth\/v1\/token\?grant_type=password/);
  assert.equal(requests[0].body.email, 'user@example.test');
  assert.ok(requests.every(r => !r.url.includes('/admin/')));
});


test('normal registration still uses Supabase signup without an admin API', async () => {
  const requests = [];
  const client = createClient('https://example.supabase.co', 'test-only-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ id: ID, email: 'user@example.test', identities: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  const result = await client.auth.signUp({ email: 'user@example.test', password: PASSWORD });
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, ID);
  assert.match(requests[0].url, /auth\/v1\/signup/);
  assert.ok(requests.every(r => !r.url.includes('/admin/')));
});


test('email validation rejects malformed and adversarial inputs before contacting Auth', async t => {
  const s = await setup(t);
  for (const email of ['', '@example.test', 'a@@example.test', 'a@example',
    'a@.test', 'a@example.', 'a b@example.test', 'a@example. test',
    'a\tb@example.test', 'a\u00a0b@example.test', 'a@' + 'x'.repeat(250),
    'a@' + '.'.repeat(20000), 123, null]) {
    assert.equal((await s.request('/forgot-password', { email })).status, 400);
  }
  assert.equal(s.created(), 0);
});

test('linear email validation preserves ordinary email normalization and subdomains', async t => {
  const s = await setup(t);
  for (const email of [' User.Name+tag@Example.test ', 'user@sub.example.test', 'a@b.c']) {
    assert.equal((await s.request('/forgot-password', { email })).status, 202);
  }
  assert.equal(s.calls[0][1], 'user.name+tag@example.test');
  assert.equal(s.calls.filter(c => c[0] === 'email').length, 3);
});
