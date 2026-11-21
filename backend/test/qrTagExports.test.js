'use strict';

// QR tag exports: one tag as a PNG label, PDF layouts ("sheet" or "single"), and printing
// chosen tags. Botanists only, own tags only.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const sharp = require('sharp');
const { createTagReservationsRouter } = require('../src/routes/tagReservations');
const { requireRole } = require('../src/middleware/auth');
const { generateQRBatchPDF } = require('../src/services/qrPdfService');
const { generateQrLabelPng } = require('../src/services/qrLabelService');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const BASE = 'https://plants.example.test/p/';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// Reservations in the database; the fake applies the route's filters (reserved_by, tag).
const RESERVATIONS = [
  { qr_code_value: 'NIAH-PLT-00031', reserved_by: ME, bound_plant_id: null },
  { qr_code_value: 'NIAH-PLT-00032', reserved_by: ME, bound_plant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  { qr_code_value: 'NIAH-PLT-00033', reserved_by: ME, bound_plant_id: null },
  { qr_code_value: 'NIAH-PLT-00090', reserved_by: OTHER, bound_plant_id: null },
];

async function setup(t, { role = 'botanist', reserved = ['NIAH-PLT-00031', 'NIAH-PLT-00033'] } = {}) {
  const calls = [];
  const pdfs = [];
  const app = express();
  app.use(express.json());
  app.use(createTagReservationsRouter({
    authenticate(req, _res, next) {
      req.profile = { role };
      req.user = { id: ME };
      req.supabase = {
        from(table) {
          calls.push(['from', table]);
          const filters = [];
          const query = {
            select(columns) { calls.push(['select', columns]); return query; },
            eq(column, value) { calls.push(['eq', column, value]); filters.push((row) => row[column] === value); return query; },
            in(column, values) { calls.push(['in', column, values]); filters.push((row) => values.includes(row[column])); return query; },
            async maybeSingle() { return { data: RESERVATIONS.find((row) => filters.every((f) => f(row))) ?? null, error: null }; },
            then(resolve, reject) {
              return Promise.resolve({ data: RESERVATIONS.filter((row) => filters.every((f) => f(row))), error: null }).then(resolve, reject);
            },
          };
          return query;
        },
        // reserve_plant_tags: the same request_id always gives the same tags.
        async rpc(name, args) {
          calls.push(['rpc', name, args]);
          return { data: reserved.slice(0, args.p_count).map((qr_code_value) => ({ qr_code_value })), error: null };
        },
      };
      next();
    },
    authorize: requireRole,
    checkDestination: () => {},
    generatePDF: async (tags, options) => {
      pdfs.push({ tags, options });
      return generateQRBatchPDF(tags, { ...options, publicBaseUrl: BASE });
    },
    generatePNG: (tag) => generateQrLabelPng(tag, { publicBaseUrl: BASE }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    calls,
    pdfs,
    get: (p) => fetch(url + p),
    post: (p, body) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  };
}

const pageCount = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

// ---- one tag as a PNG ----

test('PNG label: an unused own tag gives a 1000 px PNG with the QR and the tag underneath', async (t) => {
  const s = await setup(t);
  const response = await s.get('/NIAH-PLT-00031/image');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-disposition'), /filename="NIAH-PLT-00031\.png"/);
  const png = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1000);
  assert.ok(meta.height > 1000, 'room for the tag under the QR');
  // White margin all round, black tag text under the QR.
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => data[y * info.width + x];
  for (const [x, y] of [[5, 5], [994, 5], [5, info.height - 5], [994, info.height - 5]]) assert.equal(at(x, y), 255);
  let dark = 0;
  for (let y = 960; y < 1030; y += 1) for (let x = 0; x < info.width; x += 1) if (at(x, y) < 128) dark += 1;
  assert.ok(dark > 2000, 'the tag text is drawn under the QR');
  // Only this botanist's reservation was looked up.
  assert.ok(s.calls.some((c) => c[0] === 'eq' && c[1] === 'reserved_by' && c[2] === ME));
});

test('PNG label: another botanist\'s tag 404, a used tag 409 (use the plant image), bad tag 400, officer 403', async (t) => {
  const s = await setup(t);
  const other = await s.get('/NIAH-PLT-00090/image');
  assert.equal(other.status, 404);
  assert.notEqual(other.headers.get('content-type'), 'image/png');
  assert.equal((await s.get('/NIAH-PLT-00099/image')).status, 404);
  const used = await s.get('/NIAH-PLT-00032/image');
  assert.equal(used.status, 409);
  assert.match((await used.json()).message, /plant's QR image/);

  const before = s.calls.length;
  assert.equal((await s.get('/plant%3Aabc/image')).status, 400);
  assert.equal((await s.get('/niah-plt-00031/image')).status, 400);
  assert.equal(s.calls.length, before, 'invalid tags never reach the database');

  const officer = await setup(t, { role: 'officer' });
  assert.equal((await officer.get('/NIAH-PLT-00031/image')).status, 403);
  assert.equal(officer.calls.length, 0);
});

test('the owned-plant QR image endpoint returns the same label', () => {
  const plants = fs.readFileSync(path.join(__dirname, '../src/routes/plants.js'), 'utf8');
  const route = plants.slice(plants.indexOf('router.get("/:id/qr/image"'));
  assert.match(route.slice(0, 600), /const qrValue = await findOwnedPlantQrTag\(req, res\);/);
  assert.match(route.slice(0, 600), /await generateQrLabelPng\(qrValue\)/);
});

// ---- PDF layout ----

test('reserve-and-print: layout defaults to sheet; "single" is passed on; anything else is refused before reserving', async (t) => {
  const s = await setup(t);
  const sheet = await s.post('/reserve-and-print', { count: 2, request_id: REQUEST });
  assert.equal(sheet.status, 200);
  assert.equal(pageCount(Buffer.from(await sheet.arrayBuffer())), 1, 'two labels on one sheet');
  const single = await s.post('/reserve-and-print', { count: 2, request_id: REQUEST, layout: 'single' });
  assert.equal(single.status, 200);
  assert.equal(pageCount(Buffer.from(await single.arrayBuffer())), 2, 'one label per page');
  assert.deepEqual(s.pdfs.map((p) => p.options.layout), ['sheet', 'single']);

  const before = s.calls.length;
  for (const layout of ['grid', '', 1, null]) {
    assert.equal((await s.post('/reserve-and-print', { count: 2, request_id: REQUEST, layout })).status, 400, String(layout));
  }
  assert.equal(s.calls.length, before, 'no tags reserved for a bad layout');
});

test('reserve-and-print: a retry with the same request_id returns the same tags, in either layout', async (t) => {
  const s = await setup(t);
  for (const layout of ['sheet', 'single', 'sheet']) {
    const response = await s.post('/reserve-and-print', { count: 2, request_id: REQUEST, layout });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-reservation-request-id'), REQUEST);
  }
  const rpcCalls = s.calls.filter((c) => c[0] === 'rpc');
  assert.deepEqual(rpcCalls, Array(3).fill(['rpc', 'reserve_plant_tags', { p_count: 2, p_request_id: REQUEST }]));
  assert.deepEqual(s.pdfs.map((p) => p.tags), Array(3).fill(['NIAH-PLT-00031', 'NIAH-PLT-00033']));
});

test('PDF layouts: a sheet holds 15 labels a page; single gives one page per label; bad layouts throw', async () => {
  const tags = Array.from({ length: 16 }, (_, i) => `NIAH-PLT-${String(i + 1).padStart(5, '0')}`);
  assert.equal(pageCount(await generateQRBatchPDF(tags, { publicBaseUrl: BASE })), 2);
  assert.equal(pageCount(await generateQRBatchPDF(tags, { publicBaseUrl: BASE, layout: 'sheet' })), 2);
  assert.equal(pageCount(await generateQRBatchPDF(tags.slice(0, 3), { publicBaseUrl: BASE, layout: 'single' })), 3);
  await assert.rejects(generateQRBatchPDF(tags, { publicBaseUrl: BASE, layout: 'poster' }), /layout/);
  // Light dashed cut lines between labels on the sheet.
  const source = fs.readFileSync(path.join(__dirname, '../src/services/qrPdfService.js'), 'utf8');
  assert.match(source, /strokeColor\("#B5B5B5"\)\.dash\(/);
});

// ---- print chosen tags ----

test('print selected: own tags (unused or used) in either layout; any tag that is not yours is refused', async (t) => {
  const s = await setup(t);
  const ok = await s.post('/print', { tags: ['NIAH-PLT-00033', 'NIAH-PLT-00032', 'NIAH-PLT-00031'], layout: 'single' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /application\/pdf/);
  assert.equal(pageCount(Buffer.from(await ok.arrayBuffer())), 3);
  assert.deepEqual(s.pdfs.at(-1), { tags: ['NIAH-PLT-00031', 'NIAH-PLT-00032', 'NIAH-PLT-00033'], options: { layout: 'single' } });
  assert.ok(s.calls.some((c) => c[0] === 'eq' && c[1] === 'reserved_by' && c[2] === ME));

  const printed = s.pdfs.length;
  const notMine = await s.post('/print', { tags: ['NIAH-PLT-00031', 'NIAH-PLT-00090'] });
  assert.equal(notMine.status, 403);
  assert.equal(s.pdfs.length, printed, 'nothing printed');
  for (const body of [{ tags: [] }, { tags: ['NIAH-PLT-00031', 'NIAH-PLT-00031'] }, { tags: ['../x'] },
    { tags: ['NIAH-PLT-00031'], layout: 'poster' }, {}]) {
    assert.equal((await s.post('/print', body)).status, 400, JSON.stringify(body));
  }
});
