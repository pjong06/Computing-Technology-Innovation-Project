const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

test('Retired password route cannot load privileged clients or modify accounts', async t => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  const exported = { exports: {} };
  const imports = [];
  vm.runInNewContext(source, {
    module: exported,
    require(name) {
      imports.push(name);
      assert.equal(name, 'express', 'Route must not import Supabase or credential-bearing helpers');
      return express;
    },
    process: { env: new Proxy({}, { get() { assert.fail('Retired route must not read credentials'); } }) },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', exported.exports);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = `http://127.0.0.1:${server.address().port}/api/auth/temp-password`;
  for (const [name, payload, header] of [
    ['empty anonymous request', {}, null],
    ['caller-selected email', { identifier: 'synthetic@example.invalid', tempPassword: 'unit-test-input-only' }, null],
    ['caller-selected staff ID', { identifier: 'SYNTHETIC-STAFF', tempPassword: 'unit-test-input-only' }, null],
    ['request with bearer header', { identifier: 'synthetic@example.invalid', tempPassword: 'unit-test-input-only' }, 'Bearer unit-test-not-a-session'],
  ]) {
    await t.test(name, async () => {
      const response = await fetch(address, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(header ? { Authorization: header } : {}) }, body: JSON.stringify(payload) });
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { code: 'TEMP_PASSWORD_DISABLED', message: 'This password-setting endpoint is no longer available. Use the verified password recovery flow.' });
    });
  }
  assert.deepEqual(imports, ['express']);
});
