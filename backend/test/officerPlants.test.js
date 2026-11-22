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
        data_source: 'inaturalist',
        source_observer: 'Aina Rahman',
        source_licence: 'CC-BY',
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
  // Where a plant came from, who observed it and its licence are not sent.
  for (const key of ['data_source', 'source_observer', 'source_licence']) {
    assert.equal(key in result.body.data[0], false, key);
  }
  assert.equal(result.body.data[0].last_observation_at, '2026-11-02T10:00:00Z');
  assert.equal(result.body.data[0].observation_count, 2);
  assert.match(result.body.data[0].photo_thumbnail.url, /^https:\/\/signed\.example\//);
  assert.equal(result.body.data[0].species_photo, null);
  assert.deepEqual(result.body.pagination, { page: 2, page_size: 10, total: 21, total_pages: 3 });
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'range' && call[2] === 10 && call[3] === 19));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'order' &&
    call[2] === 'registered_at' && call[3].ascending === false));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'eq' &&
    call[2] === 'plant_status' && call[3] === 'approved'));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'eq' &&
    call[2] === 'registered_by' && call[3] === registeredById));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'is' &&
    call[2] === 'deleted_at' && call[3] === null));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'or' &&
    call[2].includes('qr_code_value.ilike') && call[2].includes(`species_id.eq.${SPECIES_ID}`)));
  assert.ok(db.calls.filter((call) => call[1] === 'select').every((call) => !call[2].includes('*')));
  const serialized = JSON.stringify(result.body);
  assert.doesNotMatch(serialized, /file_path|uploaded_by/);
});

test('officer plant list returns a signed species photo fallback without credit fields', async () => {
  role = 'officer';
  const speciesPhotoPath = `${SPECIES_ID}/reference.jpg`;
  db = fakeDb({
    plants: {
      data: [{
        id: PLANT_ID,
        qr_code_value: 'NIAH-PLT-00001',
        species_id: SPECIES_ID,
        data_source: 'inaturalist',
        source_observer: 'Aina Rahman',
        source_licence: 'CC-BY',
        registered_by: OFFICER_ID,
        registered_at: '2026-11-02T10:00:00Z',
      }],
      count: 1,
      error: null,
    },
    species: {
      data: [{
        id: SPECIES_ID,
        scientific_name: 'Nepenthes ampullaria',
        common_name: 'Pitcher plant',
        conservation_status: 'LC',
      }],
      error: null,
    },
    plant_media: { data: [], error: null },
    species_media: {
      data: [{
        id: PHOTO_ID,
        species_id: SPECIES_ID,
        file_path: speciesPhotoPath,
        source: 'inaturalist',
        is_primary: true,
        licence_code: 'cc-by',
        attribution: 'Reference photographer',
        photographer: 'Reference photographer',
        source_url: 'https://private.example/reference',
        uploaded_by: OFFICER_ID,
      }],
      error: null,
    },
  });

  const result = await callRoute('/api/officer/plants', router, { path: '/' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].photo_thumbnail, null);
  assert.deepEqual(result.body.data[0].species_photo, {
    url: `https://signed.example/${encodeURIComponent(speciesPhotoPath)}`,
  });
  assert.doesNotMatch(JSON.stringify(result.body), /file_path|uploaded_by|source_url|licence|attribution|photographer|Reference photographer/);
  assert.ok(db.calls.some(call => call[0] === 'storage' &&
    call[1] === 'species-media' && call[2] === 'createSignedUrls'));
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
        data_source: 'inaturalist',
        source_observer: 'Aina Rahman',
        source_licence: 'CC-BY-NC',
        registered_by: OFFICER_ID,
        registered_at: '2026-10-01T08:00:00Z',
        latitude: 3.2,
        longitude: 113.7,
      },
      data: [],
      error: null,
    },
    plant_map_points: {
      single: {
        id: PLANT_ID,
        latitude: 3.2,
        longitude: 113.7,
      },
      data: [],
      error: null,
    },
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
  assert.equal(result.body.data.registered_by, 'Registered By');
  assert.doesNotMatch(JSON.stringify(result.body), /data_source|source_observer|source_licence|Aina Rahman|inaturalist/);
  assert.equal(result.body.data.species_photo, null);
  assert.equal(result.body.data.photos.length, 1);
  assert.match(result.body.data.photos[0].url, /^https:\/\/signed\.example\//);
  assert.equal(result.body.data.observations[0].height_cm, 125);
  assert.equal(result.body.data.observations[0].diameter_cm, 8.5);
  assert.equal(result.body.data.observations[0].observer_name, 'Field Observer');
  assert.equal(result.body.data.observations[0].reviewer_comment, 'Please recheck the measurements.');
  assert.doesNotMatch(JSON.stringify(result.body), /file_path|uploaded_by/);
  const plantSelect = db.calls.find((call) => call[0] === 'plants' && call[1] === 'select');
  assert.ok(plantSelect);
  assert.doesNotMatch(plantSelect[2], /\blatitude\b|\blongitude\b/);
  assert.ok(db.calls.some((call) => call[0] === 'plant_map_points' && call[1] === 'select' &&
    call[2] === 'id, latitude, longitude'));
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'is' &&
    call[2] === 'deleted_at' && call[3] === null));
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
        { id: PLANT_ID, species_id: SPECIES_ID, registered_by: OFFICER_ID, plant_status: 'approved', data_source: 'field' },
        { id: 'p2', species_id: SPECIES_ID, registered_by: OFFICER_ID, plant_status: 'pending', data_source: 'inaturalist' },
        { id: 'p3', species_id: null, registered_by: OFFICER_ID, plant_status: 'pending', data_source: 'field' },
      ],
      error: null,
    },
    observations: {
      data: [
        { plant_id: PLANT_ID, observed_at: '2026-11-03T08:00:00Z' },
        { plant_id: 'p2', observed_at: '2026-11-10T08:00:00Z' },
        { plant_id: 'p3', observed_at: '2026-11-20T08:00:00Z' }, // a plant with no species
      ],
      error: null,
    },
    profiles: { data: [{ id: OFFICER_ID, full_name: 'Field Officer' }], error: null },
  });

  const result = await callRoute('/api/officer/plants', router, { path: '/facets' });
  assert.equal(result.status, 200);
  // Plant count and when any of the species' plants was last observed (Species catalogue).
  assert.deepEqual(result.body.data.species_counts, [
    { species_id: SPECIES_ID, count: 2, last_observed_at: '2026-11-10T08:00:00Z' },
  ]);
  // Counts per review status (the Plants page tabs).
  assert.deepEqual(result.body.data.status_counts, { approved: 1, pending: 2 });
  assert.ok(db.calls.some((call) => call[0] === 'observations' && call[1] === 'is' &&
    call[2] === 'deleted_at' && call[3] === null));
  assert.deepEqual(result.body.data.registered_by, [{ id: OFFICER_ID, name: 'Field Officer' }]);
  assert.deepEqual(result.body.data.plant_statuses, ['approved', 'pending']);
  assert.deepEqual(result.body.data.data_sources, ['field', 'inaturalist']);
  assert.ok(db.calls.some((call) => call[0] === 'plants' && call[1] === 'is' &&
    call[2] === 'deleted_at' && call[3] === null));
  assert.ok(db.calls.filter((call) => call[1] === 'select').every((call) => !call[2].includes('*')));
});

test('source filter only accepts known values and filters the active catalogue', async () => {
  role = 'officer';
  db = fakeDb({ plants: { data: [], count: 0, error: null } });

  const result = await callRoute('/api/officer/plants', router, {
    path: '/?source=inaturalist',
  });
  assert.equal(result.status, 200);
  assert.ok(db.calls.some(call => call[0] === 'plants' && call[1] === 'eq' &&
    call[2] === 'data_source' && call[3] === 'inaturalist'));
  assert.ok(db.calls.some(call => call[0] === 'plants' && call[1] === 'is' &&
    call[2] === 'deleted_at' && call[3] === null));

  db = fakeDb();
  assert.equal((await callRoute('/api/officer/plants', router, {
    path: '/?source=other',
  })).status, 400);
  assert.equal(db.calls.length, 0);
});

test('deleted plant details are not returned', async () => {
  role = 'officer';
  db = fakeDb({ plants: { single: null, data: [], error: null } });
  const result = await callRoute('/api/officer/plants', router, { path: `/${PLANT_ID}` });
  assert.equal(result.status, 404);
  assert.ok(db.calls.some(call => call[0] === 'plants' && call[1] === 'is' &&
    call[2] === 'deleted_at' && call[3] === null));
});

test('officer plant detail returns species photo fallback only when no plant photos exist', async () => {
  role = 'officer';
  const speciesPhotoPath = `${SPECIES_ID}/reference.jpg`;
  db = fakeDb({
    plants: {
      single: {
        id: PLANT_ID,
        qr_code_value: 'NIAH-PLT-00001',
        species_id: SPECIES_ID,
        plant_status: 'approved',
        data_source: 'field',
        registered_by: OFFICER_ID,
        registered_at: '2026-10-01T08:00:00Z',
      },
      data: [],
      error: null,
    },
    plant_map_points: {
      single: { id: PLANT_ID, latitude: 3.2, longitude: 113.7 },
      data: [],
      error: null,
    },
    species: {
      data: [{
        id: SPECIES_ID,
        scientific_name: 'Nepenthes ampullaria',
        common_name: 'Pitcher plant',
        conservation_status: 'LC',
      }],
      error: null,
    },
    profiles: { data: [], error: null },
    observations: { data: [], error: null },
    plant_media: { data: [], error: null },
    species_media: {
      data: [{
        id: PHOTO_ID,
        species_id: SPECIES_ID,
        file_path: speciesPhotoPath,
        source: 'sfc',
        is_primary: true,
        licence_code: null,
        attribution: null,
        photographer: null,
        uploaded_by: OFFICER_ID,
      }],
      error: null,
    },
  });

  const result = await callRoute('/api/officer/plants', router, { path: `/${PLANT_ID}` });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.species_photo, {
    url: `https://signed.example/${encodeURIComponent(speciesPhotoPath)}`,
  });
  assert.deepEqual(result.body.data.photos, []);
  assert.doesNotMatch(JSON.stringify(result.body), /file_path|uploaded_by/);
  const columns = db.calls.find(call => call[0] === 'species_media' && call[1] === 'select');
  assert.ok(columns);
  assert.doesNotMatch(columns[2], /\*/);
  assert.doesNotMatch(columns[2], /uploaded_by/);
});

test('facet statuses and sources are sorted with a compare function (SonarCloud S2871)', async () => {
  role = 'officer';
  db = fakeDb({
    plants: {
      data: [
        { species_id: null, registered_by: null, plant_status: 'rejected', data_source: 'inaturalist' },
        { species_id: null, registered_by: null, plant_status: 'pending', data_source: 'field' },
        { species_id: null, registered_by: null, plant_status: 'approved', data_source: 'inaturalist' },
      ],
      error: null,
    },
    profiles: { data: [], error: null },
  });

  const result = await callRoute('/api/officer/plants', router, { path: '/facets' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.plant_statuses, ['approved', 'pending', 'rejected']);
  assert.deepEqual(result.body.data.data_sources, ['field', 'inaturalist']);
});

test('plant detail (redesigned page): observation notes, GPS accuracy and photo captions, nothing internal', async () => {
  role = 'officer';
  const OBSERVER = '88888888-8888-4888-8888-888888888888';
  db = fakeDb({
    plants: {
      single: {
        id: PLANT_ID, qr_code_value: 'NIAH-PLT-00001', species_id: SPECIES_ID, plant_status: 'approved',
        registered_by: OFFICER_ID, registered_at: '2026-08-01T08:00:00Z', gps_accuracy_m: 4.6,
      },
      data: [],
      error: null,
    },
    plant_map_points: { single: { id: PLANT_ID, latitude: 3.8, longitude: 113.78 }, data: [], error: null },
    species: { data: [{ id: SPECIES_ID, scientific_name: 'Nepenthes ampullaria' }], error: null },
    profiles: { data: [{ id: OFFICER_ID, full_name: 'Registered By' }, { id: OBSERVER, full_name: 'Siti Botanist' }], error: null },
    observations: {
      data: [{ id: OBSERVATION_ID, plant_id: PLANT_ID, observer_id: OBSERVER, observed_at: '2026-11-02T10:00:00Z',
        height_cm: 140, review_status: 'pending', notes: '  New pitchers forming.  ' }],
      error: null,
    },
    observation_reviews: { data: [], error: null },
    plant_media: {
      data: [{ id: PHOTO_ID, plant_id: PLANT_ID, file_path: 'a/b/whole.jpg', photo_type: 'whole_plant', is_primary: true,
        uploaded_by: OBSERVER, created_at: '2026-08-01T09:00:00Z', client_record_id: 'secret-client-id' }],
      error: null,
    },
  });
  const result = await callRoute('/api/officer/plants', router, { path: `/${PLANT_ID}` });
  assert.equal(result.status, 200);
  const plant = result.body.data;
  assert.equal(plant.gps_accuracy_m, 4.6);
  assert.equal(plant.observations[0].notes, 'New pitchers forming.');
  assert.equal(plant.photos[0].taken_at, '2026-08-01T09:00:00Z');
  assert.equal(plant.photos[0].added_by_name, 'Siti Botanist');
  // Only the listed photo fields: no storage path, uploader id or client id.
  assert.deepEqual(Object.keys(plant.photos[0]).sort(),
    ['added_by_name', 'expires_in', 'id', 'is_primary', 'photo_type', 'taken_at', 'url']);
  assert.doesNotMatch(JSON.stringify(result.body), /file_path|uploaded_by|secret-client-id/);
  // The photos are this plant's (by plant id); the notes come with the observations.
  assert.ok(db.calls.some(call => call[0] === 'plant_media' && call[1] === 'eq' && call[2] === 'plant_id' && call[3] === PLANT_ID));
  assert.ok(db.calls.some(call => call[0] === 'observations' && call[1] === 'select' && /, notes$/.test(call[2])));
  assert.ok(db.calls.some(call => call[0] === 'plants' && call[1] === 'select' && /gps_accuracy_m/.test(call[2])));
});
