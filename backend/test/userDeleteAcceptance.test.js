const test = require('node:test');
const assert = require('node:assert/strict');
const { runUserDeleteAcceptance } = require('../test-support/userDeleteAcceptance');

function fixture(overrides = {}) {
  const calls = [];
  const rows = [];
  let removed = false;
  const io = {
    loginOfficer: async () => ({ id: 'officer-fixture', role: 'officer' }),
    createFixture: async () => ({ id: 'botanist-fixture' }),
    activateFixture: async () => {},
    loginFixture: async () => ({ id: 'botanist-fixture', token: 'local-session-placeholder', expiresAt: 3600 }),
    async me(token) {
      calls.push(['me', token]);
      return removed ? { status: 403, body: { message: 'Active account required' } }
        : { status: 200, body: { id: 'botanist-fixture', role: 'botanist' } };
    },
    async removeFixture() { removed = true; calls.push(['remove']); return { status: 200 }; },
    tokenStillValid: async token => { calls.push(['verify', token]); return true; },
    profileSuspended: async () => true,
    authRetained: async () => true,
    websiteAbsent: async () => true,
    cleanup: async data => { calls.push(['cleanup', data?.id]); return true; },
    signOut: async () => { calls.push(['signOut']); },
    ...overrides,
  };
  return { io, calls, rows, record: (name, result, details) => rows.push({ name, result, ...details }) };
}

test('user-delete acceptance uses identical JWT, verifies retained records, and cleans before sign-out', async () => {
  const { io, calls, rows, record } = fixture();
  assert.deepEqual(await runUserDeleteAcceptance(io, record, () => 0), { complete: true });
  assert.deepEqual(calls.filter(call => call[0] === 'me').map(call => call[1]),
    ['local-session-placeholder', 'local-session-placeholder']);
  assert.ok(calls.findIndex(call => call[0] === 'cleanup') < calls.findIndex(call => call[0] === 'signOut'));
  assert.equal(rows.filter(row => row.result === 'FAIL').length, 0);
  const text = JSON.stringify(rows);
  assert.equal(text.includes('local-session-placeholder'), false);
  assert.equal(text.includes('botanist-fixture'), false);
});

test('user-delete acceptance rejects 401 expiry and unrelated 403 as proof', async () => {
  for (const after of [{ status: 401 }, { status: 403, body: { message: 'Different failure' } }]) {
    let count = 0;
    const { io, calls, rows, record } = fixture({ me: async () => ++count === 1
      ? { status: 200, body: { id: 'botanist-fixture', role: 'botanist' } } : after });
    assert.equal((await runUserDeleteAcceptance(io, record, () => 0)).complete, false);
    assert.ok(rows.some(row => row.result === 'FAIL'));
    assert.ok(calls.some(call => call[0] === 'cleanup'));
  }
});

test('user-delete acceptance refuses expired sessions before deletion', async () => {
  const { io, calls, record } = fixture({
    loginFixture: async () => ({ id: 'botanist-fixture', token: 'local-session-placeholder', expiresAt: 10 }),
  });
  assert.equal((await runUserDeleteAcceptance(io, record, () => 0)).complete, false);
  assert.equal(calls.some(call => call[0] === 'remove'), false);
  assert.ok(calls.some(call => call[0] === 'cleanup'));
});

test('user-delete acceptance fails if Auth rejects original token or retained data is missing', async () => {
  for (const method of ['tokenStillValid', 'profileSuspended', 'authRetained', 'websiteAbsent']) {
    const { io, calls, record } = fixture({ [method]: async () => false });
    assert.equal((await runUserDeleteAcceptance(io, record, () => 0)).complete, false);
    assert.ok(calls.some(call => call[0] === 'cleanup'));
  }
});

test('user-delete acceptance cleans on activation failure and excludes provider error text', async () => {
  const { io, calls, rows, record } = fixture({ activateFixture: async () => { throw new Error('never-log-provider-data'); } });
  assert.equal((await runUserDeleteAcceptance(io, record, () => 0)).complete, false);
  assert.deepEqual(calls.find(call => call[0] === 'cleanup'), ['cleanup', 'botanist-fixture']);
  assert.equal(JSON.stringify(rows).includes('never-log-provider-data'), false);
});

test('user-delete acceptance never completes when cleanup or session sign-out fails', async () => {
  for (const overrides of [{ cleanup: async () => false },
    { cleanup: async () => { throw new Error('cleanup'); } },
    { signOut: async () => { throw new Error('sign out'); } }]) {
    const { io, rows, record } = fixture(overrides);
    assert.equal((await runUserDeleteAcceptance(io, record, () => 0)).complete, false);
    assert.ok(rows.some(row => row.result === 'FAIL'));
  }
});
