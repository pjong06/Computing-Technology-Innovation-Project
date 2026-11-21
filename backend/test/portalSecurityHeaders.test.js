const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPortalSecurityHeaders } = require('../src/middleware/portalSecurityHeaders');

async function withServer(options, run, trustProxy = false) {
  const app = express();
  app.disable('x-powered-by');
  app.set('env', 'test');
  app.set('trust proxy', trustProxy);
  app.use(createPortalSecurityHeaders(options));
  app.use(express.json());
  app.get('/portal/page.html', (_req, res) => res.type('html').send('<!doctype html><title>Local fixture</title>'));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/private', (_req, res) => res.status(401).json({ message: 'Denied' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('security headers cover portal, API denial, missing routes and parser errors', async () => {
  await withServer({}, async base => {
    for (const [route, options, status] of [
      ['/portal/page.html', {}, 200], ['/api/private', {}, 401], ['/missing', {}, 404],
      ['/api/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }, 400],
    ]) {
      const response = await fetch(base + route, options);
      await response.text();
      assert.equal(response.status, status);
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      // Express's final error handler supplies its own default-src 'none'.
      // X-Frame-Options DENY above still protects those error documents.
      const policy = response.headers.get('content-security-policy');
      if (route.startsWith('/portal/')) assert.match(response.headers.get('content-security-policy-report-only'), /frame-ancestors 'none'/);
      else assert.match(policy, /default-src 'none'/);
      assert.equal(response.headers.get('strict-transport-security'), null);
    }
  });
});

test('staged portal CSP preserves legacy execution while reporting a restrictive candidate', async () => {
  await withServer({}, async base => {
    const response = await fetch(base + '/portal/page.html');
    const policy = response.headers.get('content-security-policy');
    const report = response.headers.get('content-security-policy-report-only');
    assert.equal(policy, null);
    assert.match(report, /object-src 'none'/);
    assert.match(report, /script-src-attr 'none'/);
    assert.match(report, /connect-src 'self' https:\/\/yzhxjzbzslnveskkwvfy.supabase.co wss:/);
    assert.match(report, /fonts.googleapis.com/);
    assert.match(report, /server.arcgisonline.com/);
    assert.equal(/unsafe-inline|unsafe-eval|https:;|\*/.test(report), false);
  });
});

test('explicit enforce mode applies the candidate rather than report-only', async () => {
  await withServer({ portalCspMode: 'enforce', inlineStyleHashes: ['sha256-' + 'A'.repeat(43) + '='] }, async base => {
    const response = await fetch(base + '/portal/page.html');
    const policy = response.headers.get('content-security-policy');
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /script-src-attr 'none'/);
    assert.match(policy, /style-src-attr 'none'/);
    assert.match(policy, /'sha256-A{43}='/);
    assert.equal(response.headers.get('content-security-policy-report-only'), null);
  });
});

test('HSTS requires HTTPS from Express proxy handling, not an untrusted forwarded header', async () => {
  await withServer({}, async base => {
    const response = await fetch(base + '/api/health', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(response.headers.get('strict-transport-security'), null);
  });
  await withServer({}, async base => {
    const response = await fetch(base + '/api/health', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(response.headers.get('strict-transport-security').includes('includeSubDomains'), false);
  }, 3);
});

test('JSON responses retain JSON MIME and strict non-portal CSP', async () => {
  await withServer({}, async base => {
    const response = await fetch(base + '/api/health');
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test('policy configuration rejects malformed modes, origins and injected style hashes', () => {
  for (const options of [
    { portalCspMode: 'disabled' }, { supabaseOrigin: 'http://project.example' },
    { supabaseOrigin: 'https://user:password@project.example' },
    { supabaseOrigin: 'https://project.example/path' }, { inlineStyleHashes: ["bad'; script-src *"] },
  ]) assert.throws(() => createPortalSecurityHeaders(options));
});
