// Read-only deployed 7.7 checks. Credentials remain in memory and are never logged.
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const BASE = 'https://niah-backend.onrender.com';
const PROJECT = 'yzhxjzbzslnveskkwvfy.supabase.co';
const DATABASE_ONLY = process.argv.includes('--database-only');
// Retain the old flag as an alias for historical baseline runs.
const SHARED = !process.argv.includes('--iot-policy=officer-only') &&
  !process.argv.includes('--readings-policy=officer-only');
function iotReadAllowed(role, shared = SHARED) {
  return role === 'officer' || (shared && ['botanist', 'researcher'].includes(role));
}
const FIXTURES = {
  sensor_readings: '247a91e7-c43f-48f4-a48d-f853ca04d587',
  alerts: 'c29062b8-c63d-4fdf-b506-ac055ad89afe',
};
const OBSERVATIONS = [
  ['owner_a_draft', '182e431f-a4c2-4c14-8f4a-f4f62e055778', '9ddeea29-c745-40a3-86eb-9d37255b50e5'],
  ['owner_b_draft', 'a5e36f2b-6341-4bf7-b2e5-47c320da630d', '84652657-3980-474c-bf02-d7527253ac9d'],
  ['approved', '16b05675-c36e-4cf8-842f-2bc04a70efd3', null],
  ['soft_deleted', '611c078e-665d-42c3-b3c0-a66fc3d118cc', null],
];
const accounts = [
  ['officer', 'stevenchengyujay@gmail.com'],
  ['botanist', 'scyjay06@gmail.com'],
  ['researcher', 'stevenchengyujay+researcher@gmail.com'],
];
const evidence = { tested_at: new Date().toISOString(), target: DATABASE_ONLY ? `https://${PROJECT}` : BASE,
  mode: DATABASE_ONLY ? 'database-only-real-accounts' : process.argv.includes('--transport-only') ? 'transport-only' : 'transport-and-real-accounts',
  backend_role_api_checks: DATABASE_ONLY ? 'NOT RUN: database-only mode; backend deployment is separate' : 'included unless transport-only',
  reading_expectation: SHARED ? 'active Officer/Botanist/Researcher allowed (new requirement)' : 'Officer-only (pre-rollout baseline)',
  alert_expectation: SHARED ? 'active Officer/Botanist/Researcher allowed (new requirement)' : 'Officer-only (pre-rollout baseline)',
  permission_contract: SHARED ? 'shared-readings-and-alerts' : 'officer-only-baseline',
  deployed_revision: process.env.SEC77_DEPLOYED_SHA || 'NOT VERIFIED: health response does not attest revision',
  fixtures: FIXTURES, observation_fixtures: OBSERVATIONS, rows: [],
  limitations: ['No database or business-record writes; no MQTT publication or subscription',
    'Desktop TLS checks do not prove ESP32 invalid-certificate rejection',
    'No account creation/status mutation, genuine JWT expiry wait, or fresh Storage byte/expiry test',
    'Observation reads cover two Draft owners, one Approved and one soft-deleted row; not the complete lifecycle/write matrix'] };
const output = path.join(__dirname, `sec77-deployed-${Date.now()}-results.json`);
function record(test, result, detail = {}) {
  const row = { test, result, ...detail };
  evidence.rows.push(row);
  console.log(JSON.stringify(row));
}
function save() {
  evidence.completed_at = new Date().toISOString();
  evidence.summary = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED'].map(v =>
    [v.toLowerCase(), evidence.rows.filter(r => r.result === v).length]));
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
}
function handshake(host, port, options = {}) {
  return new Promise(resolve => {
    let settled = false;
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true, ...options });
    function finish(value) {
      if (settled) return;
      settled = true; socket.destroy(); resolve(value);
    }
    socket.setTimeout(12000, () => finish({ ok: false, code: 'TIMEOUT' }));
    socket.once('secureConnect', () => finish({ ok: socket.authorized,
      protocol: socket.getProtocol(), fingerprint: socket.getPeerCertificate().fingerprint256 }));
    socket.once('error', e => finish({ ok: false, code: e.code || 'TLS_ERROR' }));
  });
}
async function request(route, token, authorization) {
  const response = await fetch(BASE + route, { headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(authorization ? { Authorization: authorization } : {}),
  }, redirect: 'error', signal: AbortSignal.timeout(55000) });
  let body;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}
function denied(response, status) {
  return response.status === status && response.body &&
    typeof response.body.message === 'string' &&
    Object.keys(response.body).every(key => key === 'message');
}
async function transport() {
  const health = await request('/api/health');
  const healthy = health.status === 200 && health.body?.message === 'Niah Biodiversity Backend API is running';
  record('Render HTTPS health', healthy ? 'PASS' : 'FAIL', { http: health.status });
  for (const route of ['/api/me', '/api/plants', '/api/observations', '/api/iot/readings/history', '/api/iot/alerts']) {
    for (const [name, header] of [['missing', undefined], ['malformed', 'Bearer invalid-test-token']]) {
      const response = await request(route, null, header);
      record(`JWT ${name} ${route}`, denied(response, 401) ? 'PASS' : 'FAIL', { http: response.status });
    }
  }
  const root = new URL(BASE);
  const backendTls = await handshake(root.hostname, 443);
  record('Render certificate trust and hostname', backendTls.ok ? 'PASS' : 'FAIL', backendTls);
  const badName = { checkServerIdentity: (_, cert) => tls.checkServerIdentity('wrong-host.invalid', cert) };
  const backendWrong = await handshake(root.hostname, 443, badName);
  record('Desktop client rejects Render hostname mismatch', backendWrong.code === 'ERR_TLS_CERT_ALTNAME_INVALID' ? 'PASS' : 'FAIL', backendWrong);
  let broker;
  try { broker = new URL(process.env.MQTT_URL); } catch {}
  if (!broker || broker.protocol !== 'mqtts:' || process.env.MQTT_ALLOW_INSECURE_TLS === 'true') {
    record('MQTT TLS tests', 'BLOCKED', { reason: 'Verified mqtts configuration unavailable' });
    return;
  }
  const caFile = [process.env.SEC77_MQTT_CA_FILE,
    path.resolve(__dirname, '../iot/firmware/include/mqtt_root_ca.h'),
    path.resolve(__dirname, '../../Computing-Technology-Innovation-Project/iot/firmware/include/mqtt_root_ca.h')]
    .find(file => file && fs.existsSync(file));
  if (!caFile) { record('MQTT firmware CA', 'BLOCKED', { reason: 'Set SEC77_MQTT_CA_FILE to the public firmware CA header' }); return; }
  const ca = fs.readFileSync(caFile, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
  if (!ca) { record('MQTT firmware CA', 'BLOCKED'); return; }
  const host = broker.hostname, port = Number(broker.port || 8883);
  const accepted = await handshake(host, port, { ca });
  record('Desktop MQTT TLS with firmware CA', accepted.ok ? 'PASS' : 'FAIL', accepted);
  const rejected = await handshake(host, port, { ca, ...badName });
  record('Desktop MQTT wrong-host rejection', rejected.code === 'ERR_TLS_CERT_ALTNAME_INVALID' ? 'PASS' : 'FAIL', rejected);
  const unrelatedCa = tls.rootCertificates.find(cert => cert.trim() !== ca.trim());
  const wrongCa = await handshake(host, port, { ca: unrelatedCa });
  const certificateErrors = new Set(['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_UNTRUSTED']);
  record('Desktop MQTT untrusted-CA rejection', certificateErrors.has(wrongCa.code) ? 'PASS' : 'FAIL', wrongCa);
  if (!process.env.MQTT_USERNAME || !process.env.MQTT_PASSWORD) {
    record('Authenticated MQTT TLS connection', 'BLOCKED', { reason: 'Local broker credentials unavailable' });
  } else {
    const mqtt = require('mqtt');
    const result = await new Promise(resolve => {
      let finished = false;
      const client = mqtt.connect(process.env.MQTT_URL, { ca, rejectUnauthorized: true,
        username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD,
        clientId: `sec77-readonly-${Date.now()}`, reconnectPeriod: 0, connectTimeout: 12000 });
      const timer = setTimeout(() => done({ ok: false, code: 'TIMEOUT' }), 15000);
      function done(value) {
        if (finished) return;
        finished = true; clearTimeout(timer); client.end(true); resolve(value);
      }
      client.once('connect', () => done({ ok: true, publish: false, subscribe: false }));
      client.once('error', error => done({ ok: false, code: String(error.code || 'MQTT_ERROR') }));
    });
    record('Authenticated MQTT TLS connection', result.ok ? 'PASS' : 'FAIL', result);
  }
}
function password() {
  const command = '[Console]::Error.Write("Password (hidden; Enter to skip): "); ' +
    '$s=Read-Host -AsSecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); ' +
    'try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} ' +
    'finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}';
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8',
  });
}
async function realAccounts() {
  if (!process.stdin.isTTY || process.platform !== 'win32') {
    record('Real-account checks', 'BLOCKED', { reason: 'Run locally in interactive Windows PowerShell; never submit passwords in chat' });
    return;
  }
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  let publicKey = key?.startsWith('sb_publishable_');
  try { publicKey ||= JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch {}
  if (!publicKey || new URL(process.env.SUPABASE_URL).hostname !== PROJECT) {
    record('Real-account configuration', 'BLOCKED', { reason: 'Matching Supabase URL and publishable/anon key required' });
    return;
  }
  const { createClient } = require('@supabase/supabase-js');
  const makeClient = () => createClient(process.env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  async function direct(client, role, userId) {
    for (const [table, id] of Object.entries(FIXTURES)) {
      const allow = iotReadAllowed(role);
      const r = await client.from(table).select('id').eq('id', id);
      const found = Array.isArray(r.data) && r.data.some(row => row.id === id);
      const refusal = !found && ((!r.error && Array.isArray(r.data) && r.data.length === 0) || r.error?.code === '42501');
      record(`RLS ${role} ${table}`, (allow ? !r.error && found : refusal) ? 'PASS' : 'FAIL',
        { expected: allow ? 'known row visible' : 'known row denied', fixture_found: found, error_code: r.error?.code || null });
    }
    for (const [name, id, owner] of OBSERVATIONS) {
      const allow = role === 'officer' || (role !== 'anonymous' &&
        (name === 'approved' || (owner === userId && role === 'botanist')));
      const r = await client.from('observations').select('id').eq('id', id);
      const found = Array.isArray(r.data) && r.data.some(row => row.id === id);
      const refusal = !found && ((!r.error && Array.isArray(r.data) && r.data.length === 0) || r.error?.code === '42501');
      record(`RLS ${role} observation ${name}`, (allow ? !r.error && found : refusal) ? 'PASS' : 'FAIL',
        { expected: allow ? 'known row visible' : 'known row denied', fixture_found: found, error_code: r.error?.code || null });
    }
  }
  await direct(makeClient(), 'anonymous');
  for (const [role, email] of accounts) {
    console.log(`\n${role}: ${email}`);
    const client = makeClient();
    let secret = password();
    let signedIn = false;
    if (!secret) { record(`Login ${role}`, 'BLOCKED', { reason: 'Skipped by operator' }); continue; }
    try {
      const login = await client.auth.signInWithPassword({ email, password: secret }); secret = '';
      if (login.error || !login.data.session) { record(`Login ${role}`, 'FAIL'); continue; }
      signedIn = true;
      const token = login.data.session.access_token;
      let identity;
      if (DATABASE_ONLY) {
        const profile = await client.from('profiles').select('id,role,account_status').eq('id', login.data.user.id).maybeSingle();
        identity = !profile.error && profile.data?.id === login.data.user.id &&
          profile.data?.role === role && profile.data?.account_status === 'active';
      } else {
        const me = await request('/api/me', token);
        identity = me.status === 200 && me.body?.role === role && me.body?.id === login.data.user.id;
      }
      record(`Verified identity ${role}`, identity ? 'PASS' : 'FAIL');
      if (!identity) continue;
      for (const route of DATABASE_ONLY ? [] : ['/api/iot/readings/history', '/api/iot/alerts']) {
        const allow = iotReadAllowed(role);
        const r = await request(route, token);
        const passed = allow ? r.status === 200 && Array.isArray(r.body?.data) && r.body.data.length > 0 : denied(r, 403);
        record(`API ${role} ${route}`, passed ? 'PASS' : 'FAIL', { http: r.status, expected: allow ? 'readable data' : '403 without data' });
      }
      await direct(client, role, login.data.user.id);
    } catch { record(`Account checks ${role}`, 'FAIL', { reason: 'Request failed; private details omitted' }); }
    finally { secret = ''; if (signedIn) await client.auth.signOut({ scope: 'local' }).catch(() => {}); }
  }
}
async function main() {
  fs.writeFileSync(output, '{}', { flag: 'wx' });
  try {
    if (DATABASE_ONLY) {
      await realAccounts();
    } else {
      await transport();
      if (!process.argv.includes('--transport-only')) await realAccounts();
      else record('Real-account API/RLS checks', 'BLOCKED', { reason: 'Not run in transport-only mode' });
    }
  } catch (e) { record('Run completion', 'BLOCKED', { reason: 'Preflight/transport failure', code: e.code || 'ERROR' }); }
  finally { save(); console.log(`Evidence: ${output}`); console.log(JSON.stringify(evidence.summary)); }
  if (evidence.summary.fail || evidence.summary.blocked) process.exitCode = 1;
}
if (process.argv.includes('--self-test')) {
  const assert = require('node:assert/strict');
  assert.equal(denied({ status: 401, body: { message: 'Denied' } }, 401), true);
  assert.equal(denied({ status: 401, body: { message: 'Denied', data: [] } }, 401), false);
  assert.equal(denied({ status: 500, body: { message: 'Denied' } }, 401), false);
  assert.equal(denied({ status: 403, body: null }, 403), null);
  for (const role of ['officer', 'botanist', 'researcher', 'anonymous', 'visitor', 'admin', 'unknown']) {
    assert.equal(iotReadAllowed(role, true), ['officer', 'botanist', 'researcher'].includes(role));
    assert.equal(iotReadAllowed(role, false), role === 'officer');
  }
  console.log('18 offline response/permission checks PASS; no network or passwords used');
} else main().catch(() => { console.error('Test stopped; private details omitted'); process.exitCode = 1; });
