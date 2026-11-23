'use strict';

// "This plant" details for staff: approved plants (own and other botanists') carry location
// (coordinates for botanists and officers), location note, morphology, notes and the latest
// approved observation in the plant list and the tag lookup. Other botanists' pending or
// rejected plants are never returned. Visitor endpoints stay without these details.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { mockAuth, callRoute } = require('./helpers/routeTestKit');
const { latestObservation } = require('../src/services/plantDetails');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
let role = 'botanist';
let db;
mockAuth(() => ({ userId: ME, role, db }));
const plantRouter = require('../src/routes/plants');
const { createPublicPlantsRouter, createPublicQrHandler } = require('../src/routes/publicPlants');

// A database that applies the filters the routes use (RLS is the real gate; the routes also
// drop other botanists' unapproved plants themselves).
function fakeDb(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      let range = null;
      const rows = () => (tables[table] || []).filter(r => filters.every(f => f(r)));
      const query = {
        select(columns) { calls.push([table, 'select', columns]); return query; },
        order() { return query; },
        limit() { return query; },
        range(a, b) { range = [a, b]; return query; },
        eq(c, v) { filters.push(r => r[c] === v); return query; },
        is(c, v) { filters.push(r => (r[c] ?? null) === v); return query; },
        in(c, v) { calls.push([table, 'in', c, v]); filters.push(r => v.includes(r[c])); return query; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve, reject) {
          const all = rows();
          return Promise.resolve({ data: range ? all.slice(range[0], range[1] + 1) : all, count: all.length, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc() { return { data: [], error: null }; },
    storage: { from() { return { async list() { return { data: [], error: null }; }, async createSignedUrls(paths) { return { data: paths.map(p => ({ path: p, signedUrl: 'https://x/s' })), error: null }; } }; } },
  };
}

const plant = (id, by, status, extra = {}) => ({
  id, qr_code_value: `NIAH-PLT-0000${id.slice(-1)}`, species_id: null, plant_status: status, registered_by: by,
  registered_at: '2026-10-01T00:00:00Z', deleted_at: null, location_description: null, morphology: null,
  description: null, gps_accuracy_m: null, species: null, ...extra,
});
const TABLES = () => ({
  plants: [
    plant('p1', OTHER, 'approved', { location_description: 'Limestone slope, Zone B', morphology: 'Fleshy herb.', description: 'Healthy clump.', gps_accuracy_m: 4.5 }),
    plant('p2', OTHER, 'pending'),
    plant('p3', OTHER, 'rejected'),
    plant('p4', ME, 'pending'),
  ],
  plant_map_points: [{ id: 'p1', latitude: 3.8147, longitude: 113.7793 }, { id: 'p2', latitude: 3.9, longitude: 113.9 }],
  observations: [
    { plant_id: 'p1', observed_at: '2026-11-10T00:00:00Z', height_cm: null, diameter_cm: 12.25, health_status: 'stressed', life_stage: null, review_status: 'approved', deleted_at: null },
    { plant_id: 'p1', observed_at: '2026-10-02T00:00:00Z', height_cm: 85, diameter_cm: 10, health_status: 'healthy', life_stage: 'mature', review_status: 'approved', deleted_at: null },
    { plant_id: 'p1', observed_at: '2026-11-15T00:00:00Z', height_cm: 999, diameter_cm: 999, health_status: 'dead', life_stage: 'seedling', review_status: 'pending', deleted_at: null },
    { plant_id: 'p1', observed_at: '2026-11-16T00:00:00Z', height_cm: 777, review_status: 'approved', deleted_at: '2026-11-17T00:00:00Z' },
  ],
});

const P1_DETAILS = {
  latitude: 3.8147,
  longitude: 113.7793,
  gps_accuracy_m: 4.5,
  location_note: 'Limestone slope, Zone B',
  morphology: 'Fleshy herb.',
  notes: 'Healthy clump.',
  // Newest approved, active observation per field; never a pending or deleted one.
  latest_observation: { observed_at: '2026-11-10T00:00:00Z', height_m: 0.85, diameter_cm: 12.25, health_status: 'stressed', life_stage: 'mature' },
};

test('plant list: another botanist\'s approved plant comes with all details, including coordinates', async () => {
  role = 'botanist';
  db = fakeDb(TABLES());
  const result = await callRoute('/api/plants', plantRouter, { path: '/?page=1' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const byId = Object.fromEntries(result.body.data.map(row => [row.id, row]));
  assert.deepEqual(byId.p1.details, P1_DETAILS);
  // Pending or rejected plants of another botanist are not returned; the botanist's own pending
  // plant is (without server details: own plants use the phone's data).
  assert.deepEqual(Object.keys(byId).sort(), ['p1', 'p4']);
  assert.equal(byId.p4.details, null);
  // Batched: one coordinates query and one observations query for the whole page.
  assert.equal(db.calls.filter(c => c[0] === 'plant_map_points' && c[1] === 'select').length, 1);
  // (The own-plant thumbnail lookup reads observations separately, for photos.)
  assert.equal(db.calls.filter(c => c[0] === 'observations' && c[1] === 'select' && /health_status/.test(c[2])).length, 1);
  assert.deepEqual(db.calls.find(c => c[0] === 'plant_map_points' && c[1] === 'in')[3], ['p1']);
  // Never who registered it, and the raw columns are only inside "details".
  for (const row of result.body.data) {
    for (const key of ['registered_by', 'location_description', 'morphology', 'description', 'latitude']) {
      assert.ok(!(key in row), `${row.id}: ${key}`);
    }
  }
});

test('officers see the same details; researchers get them without coordinates', async () => {
  role = 'officer';
  db = fakeDb(TABLES());
  const officer = await callRoute('/api/plants', plantRouter, { path: '/?page=1' });
  assert.deepEqual(officer.body.data.find(row => row.id === 'p1').details, P1_DETAILS);
  role = 'researcher';
  db = fakeDb(TABLES());
  const researcher = await callRoute('/api/plants', plantRouter, { path: '/?page=1' });
  const details = researcher.body.data.find(row => row.id === 'p1').details;
  assert.equal(details.latitude, null);
  assert.equal(details.longitude, null);
  assert.equal(details.gps_accuracy_m, null);
  assert.equal(details.location_note, 'Limestone slope, Zone B');
  assert.ok(!db.calls.some(c => c[0] === 'plant_map_points'), 'coordinates are not even read');
  role = 'botanist';
});

test('tag lookup: another botanist\'s approved plant has all details; pending or rejected ones are not found', async () => {
  role = 'botanist';
  db = fakeDb(TABLES());
  const found = await callRoute('/api/plants', plantRouter, { path: '/tag/NIAH-PLT-00001' });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.deepEqual(found.body.data.details, P1_DETAILS);
  assert.equal(found.body.data.registered_by, undefined);
  for (const tag of ['NIAH-PLT-00002', 'NIAH-PLT-00003']) {
    db = fakeDb(TABLES());
    assert.equal((await callRoute('/api/plants', plantRouter, { path: `/tag/${tag}` })).status, 404, tag);
  }
});

test('latest observation: newest value per field, height in metres', () => {
  assert.equal(latestObservation([]), null);
  assert.deepEqual(latestObservation([
    { observed_at: '2026-11-02', height_cm: 120, diameter_cm: null, health_status: '', life_stage: 'flowering' },
    { observed_at: '2026-11-01', height_cm: 90, diameter_cm: 8.5, health_status: 'healthy', life_stage: 'mature' },
  ]), { observed_at: '2026-11-02', height_m: 1.2, diameter_cm: 8.5, health_status: 'healthy', life_stage: 'flowering' });
});

test('visitor page and QR API: no coordinates for allowed statuses, and 404 for endangered ones', async (t) => {
  // Even if the public function still sent coordinates (before the migration), no public
  // response may contain them, and threatened statuses must be hidden from visitors.
  for (const status of ['LC', 'NT', 'VU', 'EN', 'CR', 'DD', null]) {
    await checkVisitorEndpoints(t, status);
  }
});

const RESTRICTED_STATUSES = new Set(['VU', 'EN', 'CR']);

async function checkVisitorEndpoints(t, status) {
  const row = { scientific_name: 'Begonia niahensis', conservation_status: status, description: 'A begonia.',
    latitude: 3.8147, longitude: 113.7793, gps_accuracy_m: 4.5, location_description: 'Limestone slope, Zone B' };
  const client = {
    async rpc(name) { return name === 'public_plant_by_qr_v2' ? { data: [row], error: null } : { data: false, error: null }; },
    from() { throw new Error('visitor endpoints read no tables'); },
    storage: { from() { return { async list() { return { data: [], error: null }; } }; } },
  };
  const router = createPublicPlantsRouter({ client });
  router.get('/api/public/plants/by-qr', createPublicQrHandler(client));
  const app = express();
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}`;

  const pageRes = await fetch(`${url}/p/NIAH-PLT-00001`);
  const page = await pageRes.text();
  const apiRes = await fetch(`${url}/api/public/plants/by-qr?code=NIAH-PLT-00001`);
  const api = await apiRes.json();

  if (RESTRICTED_STATUSES.has(status)) {
    assert.equal(pageRes.status, 404, String(status));
    assert.doesNotMatch(page, /Begonia niahensis|3\.8147|113\.7793|Limestone slope/, String(status));
    assert.equal(apiRes.status, 404, String(status));
    assert.equal(api.data, undefined, String(status));
    assert.doesNotMatch(JSON.stringify(api), /Begonia niahensis|3\.8147|113\.7793|4\.5/, String(status));
    return;
  }

  assert.equal(pageRes.status, 200, String(status));
  assert.doesNotMatch(page, /3\.8147|113\.7793|latitude|longitude|Limestone slope/, String(status));
  assert.equal(apiRes.status, 200, String(status));
  for (const key of ['latitude', 'longitude', 'gps_accuracy_m', 'location', 'details']) {
    assert.equal(key in api.data, false, `${status}: ${key}`);
  }
  assert.doesNotMatch(JSON.stringify(api), /3\.8147|113\.7793|4\.5/, String(status));
}