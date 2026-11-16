// Orchestration shared by the real runner and offline failure-path tests.
// Adapters retain credentials; only fixed labels, statuses and booleans are recorded.
async function runUserDeleteAcceptance(io, record, now = Date.now) {
  let fixture;
  let failure;
  let stage = 'Officer login';
  function check(name, pass, details = {}) {
    record(name, pass ? 'PASS' : 'FAIL', details);
    if (!pass) {
      const error = new Error(name);
      error.recorded = true;
      throw error;
    }
  }
  try {
    const officer = await io.loginOfficer();
    check('Officer is verified active by deployed API', officer.role === 'officer');
    stage = 'Create disposable fixture';
    fixture = await io.createFixture();
    check('Fresh fixture identity differs from Officer', !!fixture.id && fixture.id !== officer.id);
    stage = 'Activate only disposable fixture';
    await io.activateFixture(officer, fixture);
    stage = 'Fixture login';
    const session = await io.loginFixture(fixture);
    const originalToken = session.token;
    check('Fixture has a real unexpired session', session.id === fixture.id &&
      !!originalToken && session.expiresAt * 1000 - now() > 30000);
    stage = 'Baseline protected API';
    const before = await io.me(originalToken);
    check('Same JWT before removal: HTTP 200 Botanist', before.status === 200 &&
      before.body?.id === fixture.id && before.body?.role === 'botanist', { http: before.status });
    stage = 'Officer removal API';
    const removal = await io.removeFixture(officer, fixture);
    check('Officer removal API accepted', removal.status === 200, { http: removal.status });
    stage = 'Same JWT denied after removal';
    const after = await io.me(originalToken);
    check('Same unexpired JWT after removal: profile denial HTTP 403', after.status === 403 &&
      after.body?.message === 'Active account required' && session.expiresAt * 1000 > now(),
    { http: after.status, same_jwt: true, jwt_unexpired: session.expiresAt * 1000 > now() });
    stage = 'Auth JWT and database readback';
    check('Original JWT still verified by Auth', await io.tokenStillValid(originalToken, fixture));
    check('Profile retained and suspended', await io.profileSuspended(officer, fixture));
    check('Auth account retained with fixture marker', await io.authRetained(fixture));
    check('Website row removed', await io.websiteAbsent(officer, fixture));
  } catch (error) {
    failure = error;
    if (!error.recorded) record(stage, 'FAIL');
  } finally {
    try {
      const cleaned = await io.cleanup(fixture);
      record('Fixture cleanup independently verified', cleaned ? 'PASS' : 'FAIL');
      if (!cleaned) failure ||= new Error('Cleanup incomplete');
    } catch {
      record('Fixture cleanup independently verified', 'FAIL');
      failure ||= new Error('Cleanup incomplete');
    }
    try { await io.signOut(); } catch {
      record('Sign out test-created sessions', 'FAIL');
      failure ||= new Error('Session cleanup incomplete');
    }
  }
  return { complete: !failure };
}

module.exports = { runUserDeleteAcceptance };
