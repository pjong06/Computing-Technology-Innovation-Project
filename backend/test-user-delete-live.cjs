// Run locally in interactive Windows PowerShell. No passwords/tokens in argv/results.
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID, randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { runUserDeleteAcceptance } = require('./test-support/userDeleteAcceptance');

const PROJECT = 'yzhxjzbzslnveskkwvfy.supabase.co';
const API = 'https://niah-backend.onrender.com';
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
class PreflightError extends Error {}

function readOfficerEmail(env = process.env) {
  const email = typeof env.TASK4_OFFICER_EMAIL === 'string' ? env.TASK4_OFFICER_EMAIL.trim() : '';
  if (!email) throw new PreflightError('Set TASK4_OFFICER_EMAIL locally before running this test.');
  return email;
}

function readPassword() {
  const command = '[Console]::Error.Write("Officer password (hidden): "); ' +
    '$s=Read-Host -AsSecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); ' +
    'try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} ' +
    'finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}';
  return execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-Command', command], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
}

function checkResult(result, label) {
  if (result?.error) throw new Error(label);
  return result.data;
}

function keyRole(key) {
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; }
  catch { return null; }
}

async function main() {
  if (process.platform !== 'win32' || !process.stdin.isTTY) {
    throw new PreflightError('Run in interactive Windows PowerShell; do not send passwords in chat.');
  }
  require('dotenv').config({ path: [path.join(__dirname, '.env'),
    path.resolve(__dirname, '../../Steven-Sprint2-Security/backend/.env')], quiet: true });
  const officerEmail = readOfficerEmail();
  const url = process.env.SUPABASE_URL;
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  const serverKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.IOT_DATABASE_SERVER_KEY;
  if (!url || new URL(url).origin !== `https://${PROJECT}`) throw new PreflightError('Expected Niah Supabase HTTPS project configuration.');
  if (!(publicKey?.startsWith('sb_publishable_') || keyRole(publicKey) === 'anon')) throw new PreflightError('Missing local Supabase public key.');
  if (!(serverKey?.startsWith('sb_secret_') || keyRole(serverKey) === 'service_role')) {
    throw new PreflightError('Missing backend-only SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY / IOT_DATABASE_SERVER_KEY. Configure locally; never send it in chat.');
  }
  const { createClient } = require('@supabase/supabase-js');
  const makeClient = key => createClient(url, key, { auth: authOptions, global: {
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(25000) }),
  } });
  const admin = makeClient(serverKey), officerClient = makeClient(publicKey), fixtureClient = makeClient(publicKey);
  const probeClient = makeClient(publicKey);
  const recoveryArg = process.argv.find(arg => arg.startsWith('--cleanup-run='));
  if (process.argv.slice(2).some(arg => !arg.startsWith('--cleanup-run='))) throw new PreflightError('Unsupported option.');
  const run = recoveryArg ? recoveryArg.slice('--cleanup-run='.length) : randomUUID();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(run)) throw new PreflightError('Invalid cleanup run ID.');
  const email = `sec-task4-${run}@example.com`;
  const name = `Task 4 disposable ${run}`;
  const output = path.join(__dirname, `user-delete-${Date.now()}-results.json`);
  const report = { run, mode: recoveryArg ? 'cleanup-only' : 'acceptance', status: 'IN PROGRESS',
    api: API, started_at: new Date().toISOString(), rows: [],
    scope: 'Deployed API, real Officer and disposable Botanist sessions. Only disposable fixture records changed. Tokens, passwords and account IDs excluded.' };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
  const record = (test, result, details = {}) => {
    report.rows.push({ test, result, ...details }); save(); console.log(`${result} ${test}`);
  };
  let officerSession;
  let creationAttempted = false;
  let knownId;
  let cancelled = false;
  const cancel = () => { cancelled = true; console.log('Cancellation requested; cleaning this run only.'); };
  process.once('SIGINT', cancel);
  function continueRun() { if (cancelled) throw new Error('Cancelled'); }
  async function apiRequest(route, token, body) {
    continueRun();
    const response = await fetch(`${API}${route}`, { method: body === undefined ? 'GET' : 'PUT',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(60000) });
    let parsed;
    try { parsed = await response.json(); } catch { parsed = null; }
    return { status: response.status, body: parsed };
  }
  function owned(user) {
    return user?.email === email && user?.user_metadata?.source === 'website' &&
      user?.user_metadata?.task4_run === run && user?.user_metadata?.name === name && user.id !== officerSession?.user.id;
  }
  async function getOwned(id) {
    const user = checkResult(await admin.auth.admin.getUserById(id), 'Fixture ownership could not be verified')?.user;
    if (!owned(user)) throw new Error('Fixture ownership mismatch');
    return user;
  }
  async function findOwned() {
    for (let page = 1; page <= 100; page++) {
      const data = checkResult(await admin.auth.admin.listUsers({ page, perPage: 100 }), 'Fixture lookup failed');
      const found = data.users.find(user => owned(user));
      if (found) return found;
      if (data.users.length < 100) return null;
    }
    throw new Error('Fixture lookup incomplete');
  }
  async function exactRow(table, id, columns) {
    return checkResult(await officerClient.from(table).select(columns).eq('id', id).maybeSingle(), 'Fixture readback failed');
  }
  const io = {
    async loginOfficer() {
      const health = await fetch(`${API}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(90000) });
      if (health.status !== 200) throw new Error('Backend preflight failed');
      await health.text();
      console.log('Uses the configured Officer email. Only its password is needed.');
      let password = readPassword();
      const login = await officerClient.auth.signInWithPassword({ email: officerEmail, password });
      password = '';
      officerSession = checkResult(login, 'Officer login failed')?.session;
      if (!officerSession) throw new Error('Officer session missing');
      const me = await apiRequest('/api/me', officerSession.access_token);
      if (me.status !== 200 || me.body?.id !== officerSession.user.id) throw new Error('Officer API verification failed');
      return { id: officerSession.user.id, role: me.body.role };
    },
    async createFixture() {
      continueRun();
      creationAttempted = true;
      let password = `${randomBytes(32).toString('base64url')}Aa1!`;
      const data = checkResult(await admin.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { source: 'website', name, username: `task4_${run}`, task4_run: run } }), 'Fixture creation failed');
      if (!owned(data?.user)) throw new Error('Created fixture identity mismatch');
      knownId = data.user.id;
      return { id: knownId, password };
    },
    async activateFixture(_officer, fixture) {
      continueRun();
      await getOwned(fixture.id);
      const result = await apiRequest('/api/web-data/users', officerSession.access_token, {
        rows: [{ id: fixture.id, name, username: `task4_${run}`, email, role: 'Botanist', active: true }], removed: [],
      });
      if (result.status !== 200) throw new Error('Fixture activation failed');
      const profile = await exactRow('profiles', fixture.id, 'role,account_status');
      if (profile?.role !== 'botanist' || profile.account_status !== 'active') throw new Error('Fixture profile not active');
    },
    async loginFixture(fixture) {
      continueRun();
      const login = await fixtureClient.auth.signInWithPassword({ email, password: fixture.password });
      fixture.password = '';
      const data = checkResult(login, 'Fixture login failed');
      if (!data?.session) throw new Error('Fixture session missing');
      return { id: data.user.id, token: data.session.access_token, expiresAt: data.session.expires_at };
    },
    me: token => apiRequest('/api/me', token),
    async removeFixture(_officer, fixture) {
      await getOwned(fixture.id);
      return apiRequest('/api/web-data/users', officerSession.access_token, { rows: [], removed: [fixture.id] });
    },
    async tokenStillValid(token, fixture) {
      const result = await probeClient.auth.getUser(token);
      return !result.error && result.data.user?.id === fixture.id;
    },
    async profileSuspended(_officer, fixture) {
      return (await exactRow('profiles', fixture.id, 'account_status'))?.account_status === 'suspended';
    },
    async authRetained(fixture) { return !!(await getOwned(fixture.id)); },
    async websiteAbsent(_officer, fixture) { return !(await exactRow('website_users', fixture.id, 'id')); },
    async cleanup(fixture) {
      if (!creationAttempted && !recoveryArg) return true;
      const user = fixture?.id || knownId ? await getOwned(fixture?.id || knownId) : await findOwned();
      if (!user) return true;
      // Only this run's exact ID and metadata may be removed. Never delete audit/business data.
      const website = await exactRow('website_users', user.id, 'id');
      if (website) {
        checkResult(await officerClient.from('website_users').delete().eq('id', user.id), 'Fixture website cleanup failed');
        if (await exactRow('website_users', user.id, 'id')) throw new Error('Fixture website still present');
      }
      const localSession = await fixtureClient.auth.getSession();
      if (localSession.data.session) {
        checkResult(await fixtureClient.auth.signOut({ scope: 'local' }), 'Fixture session cleanup failed');
      }
      checkResult(await admin.auth.admin.deleteUser(user.id), 'Fixture Auth cleanup failed');
      const removed = await admin.auth.admin.getUserById(user.id);
      const authAbsent = removed.error?.status === 404 && !removed.data?.user;
      const profileAbsent = !(await exactRow('profiles', user.id, 'id'));
      const websiteAbsent = !(await exactRow('website_users', user.id, 'id'));
      return authAbsent && profileAbsent && websiteAbsent;
    },
    async signOut() {
      for (const client of [fixtureClient, officerClient]) {
        const session = await client.auth.getSession();
        if (session.data.session) checkResult(await client.auth.signOut({ scope: 'local' }), 'Test session sign-out failed');
      }
    },
  };
  save();
  console.log('Creates one disposable account, tests deployed deletion, then removes only that fixture.');
  let complete = false;
  try {
    if (recoveryArg) {
      const officer = await io.loginOfficer();
      if (officer.role !== 'officer') throw new Error('Active Officer required');
      complete = await io.cleanup();
      record('Recover and independently verify this run cleanup', complete ? 'PASS' : 'FAIL');
    } else {
      complete = (await runUserDeleteAcceptance(io, record)).complete;
    }
  } catch {
    record('Runner completed without setup or network error', 'FAIL');
  } finally {
    if (recoveryArg) {
      try { await io.signOut(); } catch {
        complete = false;
        record('Sign out test-created sessions', 'FAIL');
      }
    }
    report.status = complete ? 'COMPLETE' : 'INCOMPLETE';
    report.finished_at = new Date().toISOString(); save();
    process.removeListener('SIGINT', cancel);
    console.log(`Results: ${output}`);
    if (!complete) console.log(`If fixture cleanup failed, rerun: npm run test:user-delete:live -- --cleanup-run=${run}`);
    process.exitCode = complete ? 0 : 1;
  }
}

if (require.main === module) main().catch(error => {
  console.error(error instanceof PreflightError ? error.message
    : 'Preflight failed. Check local project/public/server-key configuration and interactive PowerShell. No secrets are printed.');
  process.exitCode = 1;
});

module.exports = { main, readOfficerEmail };
