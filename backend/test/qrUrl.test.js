const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const QRCode = require('qrcode');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
const { buildPublicPlantUrl, generatePlantQR, QrConfigurationError } = require('../src/services/qrService');
const { generateQRBatchPDF } = require('../src/services/qrPdfService');
const { createPublicPlantsRouter, createPublicQrHandler } = require('../src/routes/publicPlants');
const { createQrBatchRouter } = require('../src/routes/qrBatch');
const { requireRole } = require('../src/middleware/auth');
const TAG = 'NIAH-PLT-00001';
const BASE = 'https://plants.example.test/p/';

for (const base of [BASE, BASE.slice(0, -1), 'https://plants.example.test/biotrack/p/']) {
  test(`QR destination uses configured URL prefix ${base}`, () => {
    assert.equal(buildPublicPlantUrl(TAG, base), base.replace(/\/?$/, '/') + TAG);
  });
}
for (const base of ['', 'javascript:alert(1)', 'http://public.example.test/p/',
  'https://user:password@plants.example.test/p/', 'https://plants.example.test/p/?token=secret',
  'https://plants.example.test/p/#secret', 'https://plants.example.test/other/']) {
  test('unsafe or mismatched QR URL configuration is rejected', () => {
    assert.throws(() => buildPublicPlantUrl(TAG, base), QrConfigurationError);
  });
}

test('private HTTP URLs work only outside production', t => {
  const original = process.env.NODE_ENV;
  t.after(() => { if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original; });
  process.env.NODE_ENV = 'development';
  assert.equal(buildPublicPlantUrl(TAG, 'http://localhost/p/'), `http://localhost/p/${TAG}`);
  process.env.NODE_ENV = 'production';
  assert.throws(() => buildPublicPlantUrl(TAG, 'http://localhost:3000/p/'), QrConfigurationError);
  assert.equal(buildPublicPlantUrl(TAG, BASE), BASE + TAG);
});

test('invalid tags cannot become redirect paths', () => {
  for (const tag of ['../admin', TAG + '?secret=x', TAG + '/extra', '<script>', null]) {
    assert.throws(() => buildPublicPlantUrl(tag, BASE));
  }
});

test('individual QR encodes the URL and preserves the tag value', async t => {
  const payloads = [];
  const encode = QRCode.toDataURL;
  t.mock.method(QRCode, 'toDataURL', async (payload, options) => {
    payloads.push(payload); return encode(payload, options);
  });
  const result = await generatePlantQR(TAG, { publicBaseUrl: BASE });
  assert.equal(result.qrValue, TAG);
  assert.equal(result.publicUrl, BASE + TAG);
  assert.deepEqual(payloads, [BASE + TAG]);
  assert.ok(result.qrCode.startsWith('data:image/png;base64,'));
});

test('batch PDFs encode the same URLs across multiple pages', async t => {
  const payloads = [];
  const encode = QRCode.toBuffer;
  t.mock.method(QRCode, 'toBuffer', async (payload, options) => {
    payloads.push(payload); return encode(payload, options);
  });
  const tags = Array.from({ length: 16 }, (_, i) => `NIAH-PLT-${String(i + 1).padStart(5, '0')}`);
  const pdf = await generateQRBatchPDF(tags, { publicBaseUrl: BASE });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(payloads, tags.map(tag => BASE + tag));
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2);
});

test('batch validation rejects duplicates and invalid tags before generation', async () => {
  for (const tags of [[TAG, TAG], ['../admin'], [], Array(101).fill(TAG)]) {
    await assert.rejects(generateQRBatchPDF(tags, { publicBaseUrl: BASE }));
  }
});

async function start(t, router) {
  const app = express(); app.disable('x-powered-by'); app.use(express.json()); app.use(router);
  app.get('/unrelated', (_req, res) => res.send('existing portal'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  return `http://127.0.0.1:${server.address().port}`;
}

function publicRouter(result, calls) {
  return createPublicPlantsRouter({ client: { rpc: async (...args) => {
    calls.push(args); if (result instanceof Error) throw result; return result;
  } } });
}

test('visitor page renders only allowed fields and escapes stored content', async t => {
  const calls = [];
  const row = { scientific_name: 'Shorea albida', common_name: '<script>alert(1)</script>',
    description: 'Approved description\nSource: iNaturalist observation https://www.inaturalist.org/observations/123',
    reference_image_url: 'https://example.test/legacy.jpg',
    reference_observation_url: 'https://example.test/observation',
    reference_image_credit: 'Legacy photographer', reference_image_license: 'CC-BY-NC',
    conservation_status: 'EN', habitat: 'Peat forest',
    latitude: 99.123456, longitude: 88.654321, location_description: 'SECRET_LOCATION',
    registered_by: 'SECRET_STAFF', access_token: 'SECRET_TOKEN' };
  const url = await start(t, publicRouter({ data: [row], error: null }, calls));
  const response = await fetch(url + '/p/' + TAG); const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Shorea albida/); assert.match(html, /Endangered/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /99.123456|88.654321|SECRET_LOCATION|SECRET_STAFF|SECRET_TOKEN|legacy\.jpg|Legacy photographer|CC-BY-NC|iNaturalist observation/);
  assert.deepEqual(calls, [['public_plant_by_qr_v2', { p_qr: TAG }]]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(html, /src="\/public-assets\/logo\.png" alt="Niah Biotrack"/);
  assert.match(html, /rel="icon" type="image\/png" href="\/public-assets\/logo\.png"/);
  assert.doesNotMatch(html, /reference-photo/);
});

test('visitor renders an approved species reference photo with escaped credit and stripped metadata', async t => {
  const sharp = require('sharp');
  const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: 'green' } })
    .withExif({ IFD0: { Copyright: 'PRIVATE_METADATA' } }).jpeg().toBuffer();
  const filters = [];
  const downloads = [];
  const client = {
    rpc: async () => ({ data: [{ scientific_name: 'Shorea albida' }] }),
    from(table) {
      return {
        select() { return this; },
        eq(...args) { filters.push([table, ...args]); return this; },
        order() { return this; },
        limit() { return this; },
        abortSignal() { return this; },
        async maybeSingle() { return { data: { id: 'catalogue-species' } }; },
        then(resolve) { resolve({ data: [
          { file_path: 'missing' },
          { file_path: 'invalid' },
          { file_path: 'private-storage-path', source: 'inaturalist', photographer: '<Name>',
            licence_code: 'cc-by', source_url: 'https://example.test/location' },
        ] }); },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'species-media');
        return { async download(filePath) {
          downloads.push(filePath);
          if (filePath === 'missing') return { error: new Error('not found') };
          return { data: new Blob([filePath === 'invalid' ? '<svg/>' : original]) };
        } };
      },
    },
  };
  const url = await start(t, createPublicPlantsRouter({ client }));
  const response = await fetch(url + '/p/' + TAG);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /img-src 'self' data:/);
  assert.match(html, /Conservation status: Not recorded/);
  assert.match(html, /Species reference photo · &lt;Name&gt; · iNaturalist · CC-BY/);
  assert.doesNotMatch(html, /private-storage-path|example\.test\/location/);
  const image = Buffer.from(html.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/)[1], 'base64');
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 720);
  assert.deepEqual(downloads, ['missing', 'invalid', 'private-storage-path']);
  assert.deepEqual(filters, [
    ['species', 'scientific_name', 'Shorea albida'],
    ['species', 'verification_status', 'approved'],
    ['species_media', 'species_id', 'catalogue-species'],
    ['species_media', 'media_type', 'image/jpeg'],
  ]);
});

test('iNaturalist source is escaped plain text on the visitor page and exposed by the QR API', async t => {
  const row = {
    scientific_name: 'Shorea albida',
    data_source: 'inaturalist',
    source_observer: '<Observer>',
    source_licence: 'CC-BY-NC',
    source_url: 'https://www.inaturalist.org/observations/123',
  };
  const client = { rpc: async () => ({ data: [row], error: null }) };
  const router = createPublicPlantsRouter({ client });
  router.get('/api/public/plants/by-qr', createPublicQrHandler(client));
  const url = await start(t, router);

  const page = await fetch(url + '/p/' + TAG);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Source: iNaturalist observation by &lt;Observer&gt; \(CC-BY-NC\)/);
  assert.doesNotMatch(html, /<a\b|source_url|inaturalist\.org/);

  const api = await fetch(url + '/api/public/plants/by-qr?code=' + TAG);
  const body = await api.json();
  assert.equal(body.data.data_source, 'inaturalist');
  assert.equal(body.data.source_observer, '<Observer>');
  assert.equal(body.data.source_licence, 'CC-BY-NC');
  assert.equal(body.data.source_url, undefined);
});

test('invalid visitor tags never query the database', async t => {
  const calls = []; const url = await start(t, publicRouter({ data: [], error: null }, calls));
  assert.equal((await fetch(url + '/p/invalid')).status, 400);
  assert.deepEqual(calls, []);
});

test('unavailable or unapproved public records return 404', async t => {
  const url = await start(t, publicRouter({ data: [], error: null }, []));
  const response = await fetch(url + '/p/' + TAG);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /no approved public record/);
});

for (const result of [{ error: { message: 'SECRET_DATABASE_ERROR' } }, new Error('SECRET_DATABASE_ERROR')]) {
  test('database failures produce safe visitor error pages', async t => {
    const url = await start(t, publicRouter(result, []));
    const response = await fetch(url + '/p/' + TAG);
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /SECRET_DATABASE_ERROR/);
  });
}

test('visitor assets do not alter security policy on existing portal routes', async t => {
  const url = await start(t, publicRouter({ data: [], error: null }, []));
  const css = await fetch(url + '/public-assets/plant.css');
  assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
  const logo = await fetch(url + '/public-assets/logo.png');
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.equal(logo.headers.get('cache-control'), 'no-store');
  const existing = await fetch(url + '/unrelated');
  assert.equal(existing.headers.get('content-security-policy'), null);
});

test('visitor requests are rate limited', async t => {
  const calls = []; const url = await start(t, publicRouter({ data: [], error: null }, calls));
  for (let i = 0; i < 60; i++) assert.equal((await fetch(url + '/p/' + TAG)).status, 404);
  const response = await fetch(url + '/p/' + TAG);
  assert.equal(response.status, 429); assert.ok(response.headers.get('retry-after'));
  assert.equal(calls.length, 120);
});

async function batchSetup(t, role, plants, generatePDF) {
  const calls = [];
  const router = createQrBatchRouter({ authorize: requireRole, generatePDF,
    authenticate(req, res, next) {
      if (!role) return res.status(401).json({ message: 'Bearer token required' });
      req.user = { id: 'owner' }; req.profile = { role };
      req.supabase = { from: () => ({ select: () => ({ in: async () => { calls.push('lookup'); return { data: plants, error: null }; } }) }) };
      next();
    } });
  const app = express.Router(); app.use('/api/qr-batch', router);
  const url = await start(t, app);
  return { calls, send: tags => fetch(url + '/api/qr-batch/print', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tags }),
  }) };
}
for (const [role, expected] of [[null, 401], ['officer', 403]]) {
  test('batch printing keeps its existing botanist access requirement', async t => {
    const s = await batchSetup(t, role, [], () => { throw new Error('must not run'); });
    assert.equal((await s.send([TAG])).status, expected); assert.deepEqual(s.calls, []);
  });
}

test('batch printing denies tags owned by another botanist', async t => {
  const s = await batchSetup(t, 'botanist', [{ qr_code_value: TAG, registered_by: 'other' }],
    () => { throw new Error('must not run'); });
  assert.equal((await s.send([TAG])).status, 403);
});

test('owned tags retain PDF output and no-store headers', async t => {
  let received;
  const s = await batchSetup(t, 'botanist', [{ qr_code_value: TAG, registered_by: 'owner' }],
    async tags => { received = tags; return Buffer.from('%PDF-test-only'); });
  const response = await s.send([TAG]);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/pdf/);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(received, [TAG]);
});

test('missing QR destination produces 503 rather than leaking configuration details', async t => {
  const s = await batchSetup(t, 'botanist', [{ qr_code_value: TAG, registered_by: 'owner' }],
    async () => { throw new QrConfigurationError(); });
  const response = await s.send([TAG]); assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: 'Public QR URL is not configured' });
});


test('DEMO records are explicitly distinguished from real research and officer review', async t => {
  const url = await start(t, publicRouter({ data: [{ scientific_name: 'DEMO - fictional plant',
    description: 'DEMO: not real research data', conservation_status: 'DD' }], error: null }, []));
  const response = await fetch(url + '/p/' + TAG); const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Demonstration record/);
  assert.match(html, /does not represent officer review/);
});

test('pending tag discloses only verification status on web and API', async t => {
  const client = { async rpc(fn) {
    return { data: fn === 'public_plant_tag_is_pending' ? true : [], error: null };
  } };
  const router = createPublicPlantsRouter({ client });
  router.get('/api/public/plants/by-qr', createPublicQrHandler(client));
  const url = await start(t, router);
  const response = await fetch(url + '/p/' + TAG);
  assert.equal(response.status, 404);
  const html = await response.text();
  assert.match(html, /Being verified/);
  assert.match(html, /This plant is being verified by Sarawak Forestry/);
  assert.doesNotMatch(html, new RegExp(TAG));
  const api = await fetch(url + '/api/public/plants/by-qr?code=' + TAG);
  assert.equal(api.status, 404);
  assert.deepEqual(await api.json(), {
    code: 'plant_pending_verification',
    message: 'This plant is being verified by Sarawak Forestry. Check back later.',
  });
});
