'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const SPECIES_ID = '44444444-4444-4444-8444-444444444444';
const PLANT_ID = '33333333-3333-4333-8333-333333333333';
const OBSERVATION_ID = '55555555-5555-4555-8555-555555555555';

let role = 'officer';
let db;
mockAuth(() => ({ userId: '11111111-1111-4111-8111-111111111111', role, db }));

const router = require('../src/routes/reports');

function fakeDb(tables = {}, counts = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = { table, start: 0, end: Infinity };
      for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit', 'gte', 'lte']) {
        query[method] = (...args) => {
          calls.push([table, method, ...args]);
          if (method === 'limit') query.limitValue = args[0];
          return query;
        };
      }
      query.range = (start, end) => {
        calls.push([table, 'range', start, end]);
        query.start = start;
        query.end = end;
        return query;
      };
      query.then = (resolve, reject) => {
        const answer = tables[table] || { data: [], error: null };
        const rows = answer.data || [];
        const data = rows.slice(query.start, query.end + 1);
        const result = {
          data,
          count: counts[table] ?? answer.count ?? rows.length,
          error: answer.error || null,
        };
        return Promise.resolve(result).then(resolve, reject);
      };
      return query;
    },
  };
}

function get(path) {
  return callRoute('/api/reports', router, { path });
}

test('report summary returns real table counts and is officer-only', async () => {
  role = 'officer';
  db = fakeDb({}, { species: 8, observations: 3, plants: 42 });
  const result = await get('/summary');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, {
    species_count: 8,
    endangered_count: 8,
    pending_observation_count: 3,
    plant_count: 42,
  });
  assert.ok(db.calls.some(call => call[0] === 'species' && call[1] === 'in' &&
    call[2] === 'conservation_status' && call[3].join(',') === 'CR,EN'));

  role = 'researcher';
  db = fakeDb();
  assert.equal((await get('/summary')).status, 403);
  assert.equal(db.calls.length, 0);
  role = 'officer';
});

test('species inventory includes family, conservation words, and active plant totals', async () => {
  role = 'officer';
  db = fakeDb({
    species: {
      data: [{
        id: SPECIES_ID,
        scientific_name: 'Nepenthes ampullaria',
        common_name: 'Pitcher plant',
        conservation_status: 'CR',
        taxonomy: { family: 'Nepenthaceae' },
      }],
    },
    plants: { data: [{ species_id: SPECIES_ID }, { species_id: SPECIES_ID }] },
  });

  const result = await get('/inventory?from=2026-01-01&to=2026-12-31');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.total, 1);
  assert.deepEqual(result.body.data.rows[0], {
    scientific_name: 'Nepenthes ampullaria',
    common_name: 'Pitcher plant',
    family: 'Nepenthaceae',
    conservation_status: 'Critically Endangered',
    plant_count: 2,
  });
  assert.ok(db.calls.some(call => call[0] === 'species' && call[1] === 'eq' &&
    call[2] === 'verification_status' && call[3] === 'approved'));
  assert.ok(db.calls.some(call => call[0] === 'species' && call[1] === 'gte' &&
    call[2] === 'created_at' && call[3] === '2026-01-01T00:00:00.000Z'));
});

test('field observations include species, plant, botanist, health and review details', async () => {
  role = 'officer';
  db = fakeDb({
    observations: {
      data: [{
        id: OBSERVATION_ID,
        plant_id: PLANT_ID,
        observer_id: '22222222-2222-4222-8222-222222222222',
        observed_at: '2026-11-02T03:00:00Z',
        health_status: 'healthy',
        life_stage: 'flowering',
        height_cm: 40,
        diameter_cm: null,
        review_status: 'pending',
      }],
    },
    plants: { data: [{ id: PLANT_ID, species_id: SPECIES_ID, qr_code_value: 'NIAH-PLT-1' }] },
    profiles: { data: [{ id: '22222222-2222-4222-8222-222222222222', full_name: 'Aina Rahman' }] },
    species: { data: [{ id: SPECIES_ID, scientific_name: 'Nepenthes ampullaria' }] },
  });

  const result = await get('/botanist?from=2026-11-01');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.title, 'Field observations');
  assert.deepEqual(result.body.data.rows[0], {
    observed_at: '2026-11-02',
    scientific_name: 'Nepenthes ampullaria',
    plant_tag: 'NIAH-PLT-1',
    botanist: 'Aina Rahman',
    health_status: 'healthy',
    life_stage: 'flowering',
    height_cm: 40,
    diameter_cm: '',
    review_status: 'pending',
  });
});

test('plant locations use the map view and are officer-only', async () => {
  role = 'officer';
  db = fakeDb({
    plants: { data: [{ id: PLANT_ID, created_at: '2026-10-12T00:00:00Z' }] },
    plant_map_points: {
      data: [{
        id: PLANT_ID,
        species_id: SPECIES_ID,
        qr_code_value: 'NIAH-PLT-1',
        plant_status: 'healthy',
        location_description: 'Trail entrance',
        latitude: 3.2,
        longitude: 113.7,
      }],
    },
    species: { data: [{ id: SPECIES_ID, scientific_name: 'Nepenthes ampullaria' }] },
  });

  const result = await get('/locations?to=2026-10-31');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.rows[0], {
    scientific_name: 'Nepenthes ampullaria',
    plant_tag: 'NIAH-PLT-1',
    landmark: 'Trail entrance',
    latitude: 3.2,
    longitude: 113.7,
    plant_status: 'healthy',
  });
  assert.ok(db.calls.some(call => call[0] === 'plant_map_points'));
  assert.ok(db.calls.some(call => call[0] === 'plants' && call[1] === 'lte' &&
    call[2] === 'created_at' && call[3] === '2026-10-31T23:59:59.999Z'));

  role = 'visitor';
  db = fakeDb();
  assert.equal((await get('/locations')).status, 403);
  assert.equal(db.calls.length, 0);
  role = 'officer';
});

test('report database errors return a generic message', async () => {
  role = 'officer';
  const originalError = console.error;
  console.error = () => {};
  try {
    db = fakeDb({ species: { error: { message: 'SECRET_DATABASE_DETAILS' } } });
    const result = await get('/inventory');
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { message: 'Could not load species report' });
    assert.ok(!JSON.stringify(result.body).includes('SECRET_DATABASE_DETAILS'));
  } finally {
    console.error = originalError;
  }
});
