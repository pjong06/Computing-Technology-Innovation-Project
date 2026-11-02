// Short live-account regression after the SEC-03 claim guard change.
const { ask } = require('./test-security-accounts.cjs');
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
async function main() {
  if (!process.stdin.isTTY) throw new Error('Run in interactive PowerShell.');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  const url = process.env.SUPABASE_URL;
  let role; try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; } catch {}
  if (!url?.startsWith('https://') || !(key?.startsWith('sb_publishable_') || role === 'anon')) throw new Error('HTTPS and public key required.');
  const occupied = await new Promise(resolve => { const socket = net.connect(3003, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
  if (occupied) throw new Error('Port 3003 occupied.');
  const makeClient = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const auth = makeClient(), probe = makeClient();
  const out = { started_at: new Date().toISOString(), status: 'IN PROGRESS', results: [], scope: 'Local backend claim regression and revocation of only the session created by this test. No mobile logout/device storage assertions.' };
  const file = path.join(__dirname, `auth-session-${Date.now()}-results.json`);
  const save = () => fs.writeFileSync(file, JSON.stringify(out, null, 2));
  function result(test, pass, detail = {}) { out.results.push({ test, result: pass ? 'PASS' : 'FAIL', ...detail }); save(); console.log(`${pass ? 'PASS' : 'FAIL'}: ${test}`); if (!pass) throw new Error('Assertion failed; see sanitized evidence.'); }
  let child, refresh, token;
  async function me(bearer) { const response = await fetch('http://127.0.0.1:3003/api/me', { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, signal: AbortSignal.timeout(15000) }); let body; try { body = await response.json(); } catch {} return { status: response.status, body }; }
  try {
    child = spawn(process.execPath, ['src/server.js'], { cwd: __dirname, env: { ...process.env, PORT: '3003', MQTT_URL: '' }, stdio: 'ignore', windowsHide: true });
    let ready = false;
    for (let i = 0; i < 60; i++) { try { const response = await fetch('http://127.0.0.1:3003/api/health', { signal: AbortSignal.timeout(1500) }); await response.text(); if (response.status === 200) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
    if (!ready) throw new Error('Backend startup failed before credential input.');
    console.log('This test creates a new login session and signs out only that session; no database records are changed.');
    const input = await ask('Email (Enter = Researcher): ');
    let password = await ask('Password (hidden): ', true);
    const login = await auth.auth.signInWithPassword({ email: input.trim() || 'stevenchengyujay+researcher@gmail.com', password }); password = '';
    if (login.error || !login.data.session) throw new Error('Login failed.');
    token = login.data.session.access_token; refresh = login.data.session.refresh_token;
    const before = await me(token);
    result('Real Supabase JWT passes new issuer/audience/subject guard', before.status === 200 && before.body?.id === login.data.user.id, { http: before.status });
    const logout = await auth.auth.signOut({ scope: 'local' });
    result('Local sign-out request accepted', !logout.error, { code: logout.error?.code });
    const local = await auth.auth.getSession();
    result('Auth client session cleared', !local.error && local.data.session === null);
    const renewal = await probe.auth.refreshSession({ refresh_token: refresh });
    result('Revoked refresh token cannot create a new session', !!renewal.error && !renewal.data.session && ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(renewal.error.code), { code: renewal.error?.code, http: renewal.error?.status });
    const after = await me(token);
    out.results.push({ test: 'Previously issued access JWT after logout', result: 'OBSERVATION', http: after.status, meaning: after.status === 200 ? 'Access JWT remains usable until expiry; immediate access revocation is not guaranteed by local logout.' : after.status === 401 ? 'Backend rejected this access JWT after logout in this run.' : 'Unexpected response; investigate before acceptance.' });
    console.log(`Access JWT after logout: HTTP ${after.status} (observation, not an immediate-revocation requirement).`);
    out.status = [200, 401].includes(after.status) ? 'COMPLETE' : 'INCOMPLETE'; out.finished_at = new Date().toISOString(); save();
    console.log(`Results: ${path.basename(file)}`);
  } catch (error) { out.status = 'INCOMPLETE'; out.error = error.code || error.message; save(); throw error; }
  finally { try { await auth.auth.signOut({ scope: 'local' }); await probe.auth.signOut({ scope: 'local' }); } catch {} token = refresh = undefined; child?.kill(); process.stdin.pause(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
