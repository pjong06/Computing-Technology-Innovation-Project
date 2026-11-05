// Public-key, real-account camera acceptance. Passwords stay in memory only.
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
require('dotenv').config({ path: [path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../../Steven-Sprint2-Security/backend/.env')], quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { expiryEvidence } = require('./accessAssertions');
const fixture = { id: '01642a63-a3cd-4afe-b193-bbe1b9462235', alert: 'e6b5792a-c2c7-40c8-8627-bda87873f157',
  object: '985fc35a-d1ba-4794-82c2-0ac8bde220b3/e6b5792a-c2c7-40c8-8627-bda87873f157/01642a63-a3cd-4afe-b193-bbe1b9462235.jpg' };
const allAccounts = [['officer', 'stevenchengyujay@gmail.com'], ['botanist', 'scyjay06@gmail.com'],
  ['researcher', 'stevenchengyujay+researcher@gmail.com']];
const rows = [];
const record = (name, pass, detail = {}) => { rows.push({ name, result: pass ? 'PASS' : 'FAIL', ...detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server;
function password() {
  const command = '[Console]::Error.Write("Password (hidden; Enter to skip): "); ' +
    '$s=Read-Host -AsSecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); ' +
    'try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} ' +
    'finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}';
  return execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-Command', command],
    { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
}
async function main() {
  if (process.platform !== 'win32' || !process.stdin.isTTY) {
    rows.push({ name: 'Interactive real-account test', result: 'BLOCKED', reason: 'Run in local Windows PowerShell; never send passwords in chat' }); return;
  }
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  let publicKey = key?.startsWith('sb_publishable_');
  try { publicKey ||= JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch {}
  if (!publicKey || new URL(process.env.SUPABASE_URL).hostname !== 'yzhxjzbzslnveskkwvfy.supabase.co') throw Error('Matching public project configuration required');
  const clientFor = () => createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const selectedRoles = process.argv.find(arg => arg.startsWith('--roles='))?.slice(8).split(',');
  if (selectedRoles && selectedRoles.some(role => !allAccounts.some(([r]) => r === role))) throw Error('Unknown test role');
  const accounts = selectedRoles ? allAccounts.filter(([role]) => selectedRoles.includes(role)) : allAccounts;
  let base;
  if (process.argv.includes('--local-api')) {
    const express = require('express');
    const app = express();
    app.disable('x-powered-by');
    app.use('/api/iot', require('../src/middleware/auth').requireAuth, require('../src/routes/iotCamera').createCameraRouter());
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  } else {
    base = 'https://niah-backend.onrender.com';
  }
  console.log(`Testing ${process.argv.includes('--local-api') ? 'local camera API with real JWT/RLS' : 'deployed Render camera API'}; no camera capture or uploads.`);
  const request = (suffix, token) => fetch(base + '/api/iot/alerts/' + fixture.alert + '/camera' + suffix,
    { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store', signal: AbortSignal.timeout(30000), redirect: 'error' });
  record('Anonymous API denied', (await request('/cloud')).status === 401);
  const anon = await clientFor().storage.from('camera-evidence').download(fixture.object);
  record('Anonymous direct object denied', Boolean(anon.error) && !anon.data);
  for (const [role, email] of accounts) {
    console.log(`\n${role}: ${email}`);
    const client = clientFor();
    let secret = password();
    if (!secret) { rows.push({ name: role + ' login', result: 'BLOCKED', reason: 'Skipped locally' }); continue; }
    try {
      const login = await client.auth.signInWithPassword({ email, password: secret }); secret = '';
      if (login.error || !login.data.session) {
        const known = ['invalid_credentials', 'email_not_confirmed', 'over_request_rate_limit', 'user_banned'];
        record(role + ' login', false, { status: login.error?.status || null,
          code: known.includes(login.error?.code) ? login.error.code : 'other_auth_error' }); continue;
      }
      const profile = await client.from('profiles').select('id,role,account_status').eq('id', login.data.user.id).single();
      const verified = !profile.error && profile.data.role === role && profile.data.account_status === 'active';
      record(role + ' verified active profile', verified); if (!verified) continue;
      const allowed = role === 'officer';
      const metadata = await client.from('alert_camera_evidence').select('id').eq('id', fixture.id);
      const visible = !metadata.error && metadata.data?.some(r => r.id === fixture.id);
      const denied = (!metadata.error && Array.isArray(metadata.data) && !metadata.data.length) || metadata.error?.code === '42501';
      record(role + ' metadata RLS', allowed ? visible : denied);
      const bytes = await client.storage.from('camera-evidence').download(fixture.object);
      record(role + ' direct Storage bytes', allowed ? !bytes.error && bytes.data?.size === 631 : Boolean(bytes.error) && !bytes.data);
      const token = login.data.session.access_token;
      const list = await request('/cloud', token);
      record(role + ' API list permission', list.status === (allowed ? 200 : 403), { status: list.status });
      if (allowed && list.ok) { const body = await list.json(); record('Officer API lists known evidence', body.data?.some(r => r.id === fixture.id)); }
      const linkResponse = await request('/' + fixture.id + '/url', token);
      record(role + ' API signing permission', linkResponse.status === (allowed ? 200 : 403), { status: linkResponse.status });
      if (allowed && linkResponse.ok) {
        const link = await linkResponse.json();
        const trusted = typeof link.url === 'string' && new URL(link.url).origin === process.env.SUPABASE_URL.replace(/\/$/, '') && link.expires_in === 60;
        record('Signed URL project and TTL 60 seconds', trusted);
        if (trusted) {
          const initial = await fetch(link.url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
          record('Signed URL immediate bytes', initial.ok && (await initial.arrayBuffer()).byteLength === 631);
          console.log('Waiting for 60-second signed link expiry; URL is never printed or saved.');
          await wait(65000);
          const expired = await fetch(link.url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
          const body = await expired.text();
          const expiry = expiryEvidence(expired.status, body);
          record('Signed URL expiry denied with expiry-specific response', expiry.pass, expiry);
        }
      }
    } catch { secret = ''; record(role + ' live checks completed', false, { reason: 'Network or test exception; credentials and response bodies excluded' }); }
    finally { await client.auth.signOut({ scope: 'local' }).catch(() => {}); }
  }
}
main().catch(e => { rows.push({ name: 'Preflight', result: 'BLOCKED', reason: e.message }); }).finally(async () => {
  if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  const result = { tested_at: new Date().toISOString(), mode: process.argv.includes('--local-api') ? 'local-api-real-jwt' : 'deployed-api-real-jwt', fixture, rows };
  const output = path.resolve(__dirname, '..', `camera-access-${Date.now()}-results.json`);
  await fs.writeFile(output, JSON.stringify(result, null, 2));
  console.log(`Results: ${output}`);
  console.log(`PASS ${rows.filter(r => r.result === 'PASS').length}; FAIL ${rows.filter(r => r.result === 'FAIL').length}; BLOCKED ${rows.filter(r => r.result === 'BLOCKED').length}`);
  if (rows.some(r => r.result !== 'PASS')) process.exitCode = 1;
});
