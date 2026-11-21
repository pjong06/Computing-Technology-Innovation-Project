'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const frontend = path.resolve(__dirname, '../../frontend/js');

function authFixture() {
  const calls = [];
  // Model two independent sessions belonging to the same account. Global logout
  // would revoke both; local logout must leave the second session usable.
  const sessions = { current: true, other: true };
  return {
    calls, sessions,
    auth: {
      async signOut(options) {
        calls.push(options);
        sessions.current = false;
        if (options?.scope !== 'local') sessions.other = false;
        return { error: null };
      },
    },
  };
}

test('manual portal logout removes local state without revoking another session', async () => {
  const source = fs.readFileSync(path.join(frontend, 'shared.js'), 'utf8');
  const start = source.indexOf('async function logout()');
  assert(start >= 0);
  const end = source.indexOf('\n}', start) + 2;
  const f = authFixture(), removed = [];
  const context = vm.createContext({
    sb: { auth: f.auth }, SESSION_KEY: 'portal-session',
    localStorage: { removeItem: key => removed.push(key) }, location: {},
  });
  vm.runInContext(source.slice(start, end), context);
  await context.logout();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].scope, 'local');
  assert.equal(f.sessions.current, false);
  assert.equal(f.sessions.other, true);
  assert.deepEqual(removed, ['portal-session']);
  assert.equal(context.location.href, 'login.html');
});

for (const scenario of ['username mismatch', 'permission lookup fails', 'visitor role']) {
  test('login cleanup for ' + scenario + ' preserves another session', async () => {
    const f = authFixture(), nodes = new Map();
    f.auth.signInWithPassword = async () => ({
      data: { user: { user_metadata: { username: 'steven' } } }, error: null,
    });
    const input = { 'login-username': scenario === 'username mismatch' ? 'different' : 'steven', 'login-email': 'staff@example.com', 'login-password': 'fixture-only', 'auth-error': '' };
    for (const [id, value] of Object.entries(input)) nodes.set(id, { value, textContent: '', hidden: true });
    let homeCalls = 0;
    const context = vm.createContext({
      sb: { auth: f.auth }, getCurrentUser: () => null,
      document: { getElementById: id => nodes.get(id) },
      sameText: (a, b) => a.toLowerCase() === b.toLowerCase(),
      async api() {
        if (scenario === 'permission lookup fails') throw new Error('Authentication service unavailable');
        return { role: 'visitor' };
      },
      localStorage: { removeItem() {} }, SESSION_KEY: 'portal-session',
      goToHome: () => { homeCalls++; }, startSession() { throw new Error('Refused login must not start a session'); },
    });
    vm.runInContext(fs.readFileSync(path.join(frontend, 'login.js'), 'utf8'), context);
    await context.doLogin();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].scope, 'local');
    assert.equal(f.sessions.current, false);
    assert.equal(f.sessions.other, true);
    assert.equal(homeCalls, 0);
    assert.equal(nodes.get('auth-error').hidden, false);
  });
}
