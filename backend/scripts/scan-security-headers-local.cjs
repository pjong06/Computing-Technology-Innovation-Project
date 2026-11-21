// Local-only passive comparison. Requires our isolated ZAP daemon on port 8097.
// Does not start src/server.js, load .env, log in, or contact Render/Supabase.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createPortalSecurityHeaders } = require('../src/middleware/portalSecurityHeaders');
const ZAP = 'http://127.0.0.1:8097';
const output = path.resolve(__dirname, '../../docs/security/zap-local-headers-20261117-final');

async function zap(route, params = {}) {
  const response = await fetch(`${ZAP}/${route}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || data.code) throw new Error(`Local ZAP ${route}: ${data.code || response.status}`);
  return data;
}

async function start(withHeaders) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 3);
  if (withHeaders) app.use(createPortalSecurityHeaders());
  app.get('/api/health', (_req, res) => res.json({ fixture: true }));
  app.use('/portal', express.static(path.resolve(__dirname, '../../frontend')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const baseline = await start(false);
  const candidate = await start(true);
  const rows = [];
  fs.mkdirSync(output, { recursive: true });
  try {
    // Only use this with our dedicated daemon, never a manual browser session.
    await zap('JSON/core/action/newSession/', { name: '', overwrite: 'false' });
    const name = `Standalone header comparison ${Date.now()}`;
    await zap('JSON/context/action/newContext/', { contextName: name });
    await zap('JSON/context/action/includeInContext/', { contextName: name,
      regex: `http://127\\.0\\.0\\.1:(${baseline.server.address().port}|${candidate.server.address().port})/.*` });
    await zap('JSON/context/action/setContextInScope/', { contextName: name, booleanInScope: 'true' });
    await zap('JSON/pscan/action/setScanOnlyInScope/', { onlyInScope: 'true' });
    await zap('JSON/core/action/setMode/', { mode: 'protect' });
    for (const [stage, target] of [['baseline', baseline], ['standalone-report-only', candidate]]) {
      for (const route of ['/api/health', '/portal/login.html', '/portal/map.html', '/portal/css/style.css', '/portal/js/shared.js']) {
        const url = new URL(route, target.origin);
        const request = `GET ${url} HTTP/1.1\r\nHost: ${url.host}\r\nX-Forwarded-Proto: https\r\nConnection: close\r\n\r\n`;
        const result = await zap('JSON/core/action/sendRequest/', { request, followRedirects: 'false' });
        const header = result.sendRequest?.[0]?.responseHeader || '';
        const headers = Object.fromEntries(['Content-Security-Policy','Content-Security-Policy-Report-Only',
          'X-Frame-Options','X-Content-Type-Options','Strict-Transport-Security'].map(key =>
          [key, header.match(new RegExp('^' + key + ':\\s*([^\\r\\n]+)', 'im'))?.[1] || null]));
        rows.push({ stage, path: route, status: Number(header.match(/^HTTP\/\S+\s+(\d+)/)?.[1]) || null, headers });
      }
    }
    const deadline = Date.now() + 30000;
    let queue;
    do {
      queue = Number((await zap('JSON/pscan/view/recordsToScan/')).recordsToScan);
      if (!queue) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    const evidence = { scope: 'Local fixture only, existing portal files unmodified; no JS browser execution or production integration. X-Forwarded-Proto simulates HTTPS; not a real TLS/HSTS deployment test.',
      mode: 'report-only portal CSP', passive_queue: queue,
      active_scans: (await zap('JSON/ascan/view/scans/')).scans.length,
      baseline_origin: baseline.origin, candidate_origin: candidate.origin, requests: rows };
    fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(evidence, null, 2));
    for (const [label, target] of [['baseline', baseline], ['candidate', candidate]]) {
      const alerts = await zap('JSON/alert/view/alerts/', { baseurl: target.origin, start: '0', count: '1000' });
      fs.writeFileSync(path.join(output, `${label}-alerts.json`), JSON.stringify(alerts, null, 2));
    }
    const response = await fetch(`${ZAP}/OTHER/core/other/htmlreport/`, { signal: AbortSignal.timeout(30000) });
    fs.writeFileSync(path.join(output, 'zap-local-report.html'), await response.text());
    if (queue || rows.some(row => row.status !== 200)) throw new Error('Local comparison incomplete');
    console.log('Local passive comparison saved. Strict portal CSP and production reassessment remain pending.');
  } finally {
    await Promise.all([baseline.server, candidate.server].map(server => new Promise(resolve => server.close(resolve))));
  }
}

main().catch(error => { console.error(`Local-only comparison failed: ${error.message}. No production changes were made.`); process.exitCode = 1; });
