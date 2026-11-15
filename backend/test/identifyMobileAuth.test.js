const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

// Exercise the actual mobile request builder, replacing only native/provider APIs.
// No phone, real session, network or filesystem image is used.
function loadIdentify({ session = null, error = null } = {}) {
  const filename = path.join(__dirname, '../../niah-biotrack/src/services/identifyPlant.ts');
  let source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'));
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const requests = [];
  const context = vm.createContext({
    process: { env: { EXPO_PUBLIC_API_BASE_URL: 'https://backend.example.test' } },
    supabase: { auth: { getSession: async () => ({ data: { session }, error }) } },
    File: class { constructor() { this.exists = true; this.size = 4; } },
    FormData: class { fields = []; append(...args) { this.fields.push(args); } },
    fetch: async (...args) => {
      requests.push(args);
      return { ok: true, json: async () => ({ success: true, suggestions: [{ scientificName: 'Test plant' }] }) };
    },
  });
  vm.runInContext(`${source}\nglobalThis.identify = identifyPlant;`, context, { filename });
  return { identify: context.identify, requests };
}

test('Mobile identify: no session or session error prevents upload', async () => {
  for (const options of [{}, { error: new Error('session unavailable') }]) {
    const { identify, requests } = loadIdentify(options);
    await assert.rejects(identify({ uri: 'file:///plant.jpg' }), /Please sign in/);
    assert.equal(requests.length, 0);
  }
});

test('Mobile identify: current session token accompanies multipart upload and abort signal', async () => {
  const { identify, requests } = loadIdentify({ session: { access_token: 'local-test-placeholder' } });
  const signal = new AbortController().signal;
  const suggestions = await identify({ uri: 'file:///plant.jpg' }, signal);
  assert.equal(suggestions[0].scientificName, 'Test plant');
  assert.equal(requests.length, 1);
  const [url, options] = requests[0];
  assert.equal(url, 'https://backend.example.test/api/identify');
  assert.equal(options.headers.Authorization, 'Bearer local-test-placeholder');
  assert.equal(options.headers['Content-Type'], undefined);
  assert.equal(options.body.fields[0][0], 'image');
  assert.equal(options.signal, signal);
});
