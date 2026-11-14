'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const OFFICER_ID = '11111111-1111-4111-8111-111111111111';
const SPECIES_ID = '44444444-4444-4444-8444-444444444444';
const PLANT_ID = '33333333-3333-4333-8333-333333333333';
const OBSERVATION_ID = '55555555-5555-4555-8555-555555555555';
const PHOTO_ID = '66666666-6666-4666-8666-666666666666';

let role = 'officer';
let db;
mockAuth(() => ({ userId: OFFICER_ID, role, db }));

const router = require('../src/routes/officerPlants');

function fakeDb(tables = {}) {
  const calls = [];
  const database = {
    calls,
    from(table) {
      const query = {};
      for (const method of ['select', 'eq', 'in', 'is', 'or', 'limit', 'order', 'range']) {
        query[method] = (...args) => {
          calls.push([table, method, ...args]);
          return query;
        };
      }
      query.maybeSingle = async () => {
        calls.push([table, 'maybeSingle']);
        const answer = tables[table] || { data: [], error: null };
        return { data: answer.single ?? answer.data?.[0] ?? null, error: answer.error || null };
      };
      query.then = (resolve, reject) => {
        const answer = tables[table] || { data: [], error: null };
        return Promise.resolve(answer).then(resolve, reject);
      };
      return query;
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths, expiresIn) {
            calls.push(['storage', bucket, 'createSignedUrls', paths, expiresIn]);
            return {
              data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${encodeURIComponent(path)}` })),
              error: null,
            };
          },
        };
      },
    },
  };
  return database;
}

test('officer plant list applies filters, search, newest sorting and paging without exposing paths', async () => {
  role = 'officer';
  const registeredById = '77777777-7777-4777-8777-777777777777';
  db = fakeDb({
    species: {
      data: [{
        id: SPECIES_ID,
        scientific_name: 'Nepenthes ampullaria',
        common_name: 'Pitcher plant',
        conservation_status: 'LC',
      }],
      error: null,
    },
    plants: {
      data: [{
        id: PLANT_ID,
        qr_code_value: 'NIAH-PLT-00001',
        species_id: SPECIES_ID,
        location_description: 'Near the trail',
        plant_status: 'approved',
        registered_by: registeredById,
        registered_at: '2026-11-02T10:00:00Z',
      }],
      count: 21,
      error: null,
    },
    profiles: { data: [{ id: registeredById, full_name: 'Field Officer' }], error: null },
    observations: {
      data: [
        { plant_id: PLANT_ID, observed_at: '2026-11-01T10:00:00Z' },
        { plant_id: PLANT_ID, observed_at: '2026-11-02T10:00:00Z' },
      ],
      error: null,
    },
    plant_media: {
      data: [{
        id: PHOTO_ID,
        plant_id: PLANT_ID,
        file_path: `${OFFICER_ID}/${PLANT_ID}/primary.jpg`,
        photo_type: 'whole_plant',
        is_primary: true,
        uploaded_by: OFFICER_ID,
      }],
      error: null,
    },
  });

  const result = await callRoute('/api/officer/plants', router, {
    path: `/?search=Nepenthes&species_id=${SPECIES_ID}&plant_status=approved&conservation_status=LC&registered_by=${registeredById}&page=2&page_size=10`,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].tag_code, 'NIAH-PLT-00001');
  assert.equal(result.body.data[0].species.scientific_name, 'Nepenthes ampullaria');
  assert.equal(result.body.data[0].registered_by, 'Field Officer');
  assert.equal(result.body.data[0].last_observation_at, '2026-11-02T10:00:00Z');
  assert.equal(result.body.data[0].observation_count, 2);
  assert.match(result.body.data[0].photo_thumbnail.url, /^https:\/\/signed\.example\//);
  assert.deepEqual(result.body.pagination, { page: 2, page_size: 10, total: 21, total_pages: 3 });
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'range' && call[2] === 10 && call[3] === 19));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'order' &&
    call[2] === 'registered_at' && call[3].ascending === false));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'eq' &&
    call[2] === 'plant_status' && call[3] === 'approved'));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'eq' &&
    call[2] === 'registered_by' && call[3] === registeredById));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'or' &&
    call[2].includes('qr_code_value.ilike') && call[2].includes(`species_id.eq.${SPECIES_ID}`)));
  assert.ok(db.calls.filter((call) => call[1] === 'select').every((call) => !call[2].includes('*')));
  const serialized = JSON.stringify(result.body);
  assert.doesNotMatch(serialized, /file_path|uploaded_by/);
});

test('officer plant detail includes signed photos and observation history without storage paths', async () => {
  role = 'officer';
  db = fakeDb({
    plants: {
      single: {
        id: PLANT_ID,
        qr_code_value: 'NIAH-PLT-00001',
        species_id: SPECIES_ID,
        location_description: 'Near the trail',
        plant_status: 'approved',
        registered_by: OFFICER_ID,
        registered_at: '2026-10-01T08:00:00Z',
      },
      data: [],
      error: null,
    },
    plant_map_points: { single: { latitude: 3.2, longitude: 113.7 } },
    species: {
      data: [{
        id: SPECIES_ID,
        scientific_name: 'Nepenthes ampullaria',
        common_name: 'Pitcher plant',
        conservation_status: 'LC',
      }],
      error: null,
    },
    profiles: {
      data: [
        { id: OFFICER_ID, full_name: 'Registered By' },
        { id: '88888888-8888-4888-8888-888888888888', full_name: 'Field Observer' },
      ],
      error: null,
    },
    observations: {
      data: [{
        id: OBSERVATION_ID,
        plant_id: PLANT_ID,
        observer_id: '88888888-8888-4888-8888-888888888888',
        observed_at: '2026-11-02T10:00:00Z',
        height_cm: 125,
        diameter_cm: 8.5,
        health_status: 'Healthy',
        life_stage: 'Mature',
        review_status: 'rejected',
      }],
      error: null,
    },
    observation_reviews: {
      data: [{
        observation_id: OBSERVATION_ID,
        comments: 'Please recheck the measurements.',
        reviewed_at: '2026-11-03T10:00:00Z',
      }],
      error: null,
    },
    plant_media: {
      data: [{
        id: PHOTO_ID,
        plant_id: PLANT_ID,
        file_path: `${OFFICER_ID}/${PLANT_ID}/whole.jpg`,
        photo_type: 'whole_plant',
        is_primary: true,
        uploaded_by: OFFICER_ID,
      }],
      error: null,
    },
  });

  const result = await callRoute('/api/officer/plants', router, { path: `/${PLANT_ID}` });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.latitude, 3.2);
  assert.equal(result.body.data.longitude, 113.7);
  const plantSelect = db.calls.find(call => call[0] === 'plants' && call[1] === 'select');
  assert.doesNotMatch(plantSelect[2], /latitude|longitude/);
  assert.ok(db.calls.some(call =>
    call[0] === 'plant_map_points' && call[1] === 'eq' && call[2] === 'id' && call[3] === PLANT_ID
  ));
  assert.equal(result.body.data.registered_by, 'Registered By');
  assert.equal(result.body.data.photos.length, 1);
  assert.match(result.body.data.photos[0].url, /^https:\/\/signed\.example\//);
  assert.equal(result.body.data.observations[0].height_cm, 125);
  assert.equal(result.body.data.observations[0].diameter_cm, 8.5);
  assert.equal(result.body.data.observations[0].observer_name, 'Field Observer');
  assert.equal(result.body.data.observations[0].reviewer_comment, 'Please recheck the measurements.');
  assert.doesNotMatch(JSON.stringify(result.body), /file_path|uploaded_by/);
});

test('officer plant detail loads when no map coordinates are recorded', async () => {
  role = 'officer';
  db = fakeDb({ plants: { single: { id: PLANT_ID } } });

  const result = await callRoute('/api/officer/plants', router, { path: `/${PLANT_ID}` });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.latitude, null);
  assert.equal(result.body.data.longitude, null);
});


test('plant catalogue enforces officer access and validates paging before database access', async () => {
  for (const disallowedRole of ['botanist', 'visitor']) {
    role = disallowedRole;
    db = fakeDb();
    const result = await callRoute('/api/officer/plants', router, { path: '/' });
    assert.equal(result.status, 403);
    assert.equal(db.calls.length, 0);
  }

  role = 'officer';
  db = fakeDb();
  for (const path of ['/?page=0', '/?page_size=51', '/?page_size=0']) {
    const result = await callRoute('/api/officer/plants', router, { path });
    assert.equal(result.status, 400);
  }
  assert.equal(db.calls.length, 0);
});

test('plant catalogue facets provide species counts and registered-by options', async () => {
  role = 'officer';
  db = fakeDb({
    plants: {
      data: [
        { species_id: SPECIES_ID, registered_by: OFFICER_ID, plant_status: 'approved' },
        { species_id: SPECIES_ID, registered_by: OFFICER_ID, plant_status: 'pending' },
        { species_id: null, registered_by: OFFICER_ID, plant_status: 'pending' },
      ],
      error: null,
    },
    profiles: { data: [{ id: OFFICER_ID, full_name: 'Field Officer' }], error: null },
  });

  const result = await callRoute('/api/officer/plants', router, { path: '/facets' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.species_counts, [{ species_id: SPECIES_ID, count: 2 }]);
  assert.deepEqual(result.body.data.registered_by, [{ id: OFFICER_ID, name: 'Field Officer' }]);
  assert.deepEqual(result.body.data.plant_statuses, ['approved', 'pending']);
  assert.ok(db.calls.filter((call) => call[1] === 'select').every((call) => !call[2].includes('*')));
});
