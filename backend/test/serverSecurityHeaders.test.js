// The real app in src/server.js sends the security headers from
// middleware/portalSecurityHeaders.js on portal pages and API responses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// src/config/supabase.js needs these to load. Placeholders only: no request below reaches
// Supabase, and a real .env (loaded by server.js) is never overridden.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
if (!process.env.SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_KEY && !process.env.SUPABASE_ANON_KEY) {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'placeholder-publishable-key';
}

const app = require('../src/server');

async function withMainApp(run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('main app: X-Frame-Options DENY and nosniff on portal pages and API responses', async () => {
  await withMainApp(async base => {
    for (const [route, status] of [
      ['/portal/login.html', 200],
      ['/api/health', 200],
      ['/api/officer/reviews/pending', 401], // no login
      ['/api/does-not-exist', 404],
    ]) {
      const response = await fetch(base + route);
      await response.text();
      assert.equal(response.status, status, route);
      assert.equal(response.headers.get('x-frame-options'), 'DENY', route);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff', route);
    }

    // Portal pages: CSP in report-only mode, nothing enforced yet.
    const portal = await fetch(base + '/portal/login.html');
    await portal.text();
    assert.match(portal.headers.get('content-security-policy-report-only'), /frame-ancestors 'none'/);
    assert.equal(portal.headers.get('content-security-policy'), null);

    // API responses: the strict API policy.
    const api = await fetch(base + '/api/health');
    await api.text();
    assert.match(api.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(api.headers.get('x-powered-by'), null);
  });
});

test('main app: HSTS only when the request is secure (via the trusted proxy)', async () => {
  await withMainApp(async base => {
    const plain = await fetch(base + '/api/health');
    await plain.text();
    assert.equal(plain.headers.get('strict-transport-security'), null);

    // Behind Render/Cloudflare the proxy says the original request was HTTPS.
    const secure = await fetch(base + '/api/health', { headers: { 'X-Forwarded-Proto': 'https' } });
    await secure.text();
    assert.equal(secure.headers.get('strict-transport-security'), 'max-age=31536000');

    const securePortal = await fetch(base + '/portal/login.html', { headers: { 'X-Forwarded-Proto': 'https' } });
    await securePortal.text();
    assert.equal(securePortal.headers.get('strict-transport-security'), 'max-age=31536000');
  });
});

test('server.js registers the headers once, after disabling x-powered-by and before parsers and routes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.equal(source.match(/createPortalSecurityHeaders\(/g).length, 1);
  assert.match(source, /app\.use\(createPortalSecurityHeaders\(\{ portalCspMode: 'report-only' \}\)\);/);
  assert.match(source, /app\.set\('trust proxy', 3\);/);
  const disabled = source.indexOf("app.disable('x-powered-by')");
  const headers = source.indexOf('app.use(createPortalSecurityHeaders(');
  const firstParser = source.indexOf('express.json(');
  const firstRoute = source.indexOf("app.use('/api/");
  assert.ok(disabled !== -1 && disabled < headers, 'after app.disable');
  assert.ok(headers < firstParser, 'before the body parsers');
  assert.ok(headers < firstRoute, 'before the routes');
});
