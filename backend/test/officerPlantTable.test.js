'use strict';

// The officer Plants table and plant detail page: species family and rank, column sorting,
// field notes, and printing the QR tags of chosen plants (officer only, any botanist's plant).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

process.env.PUBLIC_PLANT_BASE_URL = 'https://plants.example.test/p/';

const OFFICER_ID = '11111111-1111-4111-8111-111111111111';
const SPECIES_ID = '44444444-4444-4444-8444-444444444444';
const PLANT_A = '33333333-3333-4333-8333-333333333333';
const PLANT_B = '33333333-3333-4333-8333-333333333334';
const PLANT_C = '33333333-3333-4333-8333-333333333335';

let role = 'officer';
let db;
mockAuth(() => ({ userId: OFFICER_ID, role, db }));
const router = require('../src/routes/officerPlants');

function fakeDb(tables = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = {};
      for (const method of ['select', 'eq', 'in', 'is', 'or', 'limit', 'order', 'range']) {
        query[method] = (...args) => {
          calls.push([table, method, ...args]);
          return query;
        };
      }
      const answer = () => tables[table] || { data: [], error: null };
      query.maybeSingle = async () => ({ data: answer().single ?? answer().data?.[0] ?? null, error: null });
      query.then = (resolve, reject) => Promise.resolve(answer()).then(resolve, reject);
      return query;
    },
    storage: { from: () => ({ createSignedUrls: async (paths) => ({ data: paths.map((path) => ({ path, signedUrl: 'https://signed.example/x' })), error: null }) }) },
  };
}

// Sends a POST and returns the raw response (the QR route answers with a PDF, not JSON).
async function postRaw(path, body) {
  const app = express();
  app.use(express.json());
  app.use('/api/officer/plants', router);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/officer/plants${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const speciesRow = { id: SPECIES_ID, scientific_name: 'Nepenthes', common_name: null, conservation_status: 'VU', taxonomy: { family: 'Nepenthaceae' } };

test('plant list: species family and rank, and sorting by a column', async () => {
  role = 'officer';
  db = fakeDb({
    species: { data: [speciesRow], error: null },
    plants: {
      data: [{ id: PLANT_A, qr_code_value: 'NIAH-PLT-00001', species_id: SPECIES_ID, plant_status: 'approved', registered_at: '2026-11-02T10:00:00Z' }],
      count: 1,
      error: null,
    },
  });
  const result = await callRoute('/api/officer/plants', router, { path: '/?sort=tag&dir=desc&page_size=10' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].species.family, 'Nepenthaceae');
  assert.equal(result.body.data[0].species.rank, 'Genus');
  assert.equal('taxonomy' in result.body.data[0].species, false);
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'order' &&
    call[2] === 'qr_code_value' && call[3].ascending === false));

  // Location ascending; newest stays the default; anything else is refused before the database.
  await callRoute('/api/officer/plants', router, { path: '/?sort=location&dir=asc' });
  assert.ok(db.calls.some((call) => call[1] === 'order' && call[2] === 'location_description' && call[3].ascending === true));
  for (const bad of ['/?sort=species', '/?sort=tag&dir=sideways']) {
    db = fakeDb();
    const refused = await callRoute('/api/officer/plants', router, { path: bad });
    assert.equal(refused.status, 400, bad);
    assert.equal(db.calls.length, 0);
  }
});

test('plant detail: field notes (morphology and notes) and the species family', async () => {
  role = 'officer';
  db = fakeDb({
    species: { data: [speciesRow], error: null },
    plants: { single: { id: PLANT_A, species_id: SPECIES_ID, morphology: ' Climber with pitchers ', description: '' }, error: null },
    plant_map_points: { single: null, error: null },
  });
  const result = await callRoute('/api/officer/plants', router, { path: `/${PLANT_A}` });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.morphology, 'Climber with pitchers');
  assert.equal(result.body.data.notes, null);
  assert.equal(result.body.data.species.family, 'Nepenthaceae');
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'select' && /morphology, description/.test(call[2])));
});

test('QR tags: an officer prints any plant with a real tag; others are skipped and counted', async () => {
  role = 'officer';
  db = fakeDb({
    plants: {
      data: [
        { id: PLANT_A, qr_code_value: 'NIAH-PLT-00002' },
        { id: PLANT_B, qr_code_value: `plant:${PLANT_B}` }, // placeholder, no physical tag
        { id: PLANT_C, qr_code_value: 'NIAH-PLT-00001' },
      ],
      error: null,
    },
  });
  const result = await postRaw('/qr-tags', { plant_ids: [PLANT_A, PLANT_B, PLANT_C] });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-type'), 'application/pdf');
  assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(result.headers.get('x-printed-count'), '2');
  assert.equal(result.headers.get('x-skipped-count'), '1');
  // Only active plants are read.
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'is' && call[2] === 'deleted_at' && call[3] === null));
});

test('QR tags: nothing printable, bad input, and non-officers are refused', async () => {
  role = 'officer';
  db = fakeDb({ plants: { data: [{ id: PLANT_B, qr_code_value: null }], error: null } });
  const none = await callRoute('/api/officer/plants', router, { method: 'POST', path: '/qr-tags', body: { plant_ids: [PLANT_B] } });
  assert.equal(none.status, 400);
  assert.match(none.body.message, /None of the selected plants has a NIAH-PLT tag/);

  for (const body of [{}, { plant_ids: [] }, { plant_ids: ['not-a-uuid'] }, { plant_ids: [PLANT_A, PLANT_A] },
    { plant_ids: Array.from({ length: 101 }, (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`) }]) {
    db = fakeDb();
    const refused = await callRoute('/api/officer/plants', router, { method: 'POST', path: '/qr-tags', body });
    assert.equal(refused.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(db.calls.length, 0);
  }

  role = 'botanist';
  db = fakeDb();
  const botanist = await callRoute('/api/officer/plants', router, { method: 'POST', path: '/qr-tags', body: { plant_ids: [PLANT_A] } });
  assert.equal(botanist.status, 403);
  assert.equal(db.calls.length, 0);
  role = 'officer';
});
