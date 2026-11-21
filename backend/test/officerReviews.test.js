'use strict';

// Officer review API used by the web portal's approval queue and rejected list.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const OFFICER = '11111111-1111-4111-8111-111111111111';
const BOTANIST = '22222222-2222-4222-8222-222222222222';
const PLANT = '33333333-3333-4333-8333-333333333333';
const SPECIES = '44444444-4444-4444-8444-444444444444';
const OBS = '55555555-5555-4555-8555-555555555555';

let db;
let role = 'officer';

const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth(req, res, next) {
      req.user = { id: OFFICER };
      req.profile = { role, account_status: 'active' };
      req.supabase = db;
      next();
    },
    requireRole: (...roles) => (req, res, next) => {
      if (!roles.includes(req.profile.role)) return res.status(403).json({ message: 'Insufficient permissions' });
      next();
    },
  },
};

const router = require('../src/routes/officerReviews');

// Fake Supabase: each table answers with tables[name] (rows, or { error }). Every
// call is recorded so tests can check filters.
function fakeDb(tables = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const chain = { table, filters: [] };
      const record = (name) => (...args) => { calls.push([table, name, ...args]); chain.filters.push([name, ...args]); return chain; };
      for (const name of ['select', 'eq', 'is', 'in', 'order', 'limit']) chain[name] = record(name);
      chain.insert = (row) => {
        calls.push([table, 'insert', row]);
        return { select: () => ({ single: async () => tables[`${table}:insert`] ?? { data: { id: 'review-1', ...row }, error: null } }) };
      };
      chain.maybeSingle = async () => {
        const answer = tables[`${table}:single`];
        return answer ?? { data: null, error: null };
      };
      chain.then = (resolve, reject) => {
        const answer = tables[table];
        const result = answer && answer.error ? { data: null, error: answer.error } : { data: answer ?? [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      };
      return chain;
    },
  };
}

async function withApp(run) {
  const app = express();
  app.use(express.json());
  app.use('/api/officer/reviews', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/officer/reviews`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

async function call(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

const observation = {
  id: OBS, plant_id: PLANT, observer_id: BOTANIST, observed_at: '2026-11-02T03:00:00Z',
  notes: 'Two flowers open', review_status: 'pending', health_status: 'healthy',
  life_stage: 'flowering', height_cm: 40, diameter_cm: null,
};
const details = {
  plants: [{
    id: PLANT, qr_code_value: 'NIAH-PLT-00001', location_description: 'Left of boardwalk',
    species_id: SPECIES, plant_status: 'pending',
  }],
  species: [{ id: SPECIES, scientific_name: 'Nepenthes ampullaria', common_name: 'Pitcher plant' }],
  profiles: [{ id: BOTANIST, full_name: 'Aina Rahman' }],
};

test('only officers can use the review API', async () => {
  for (const other of ['botanist', 'researcher', 'visitor']) {
    role = other;
    db = fakeDb();
    await withApp(async base => {
      assert.equal((await call(`${base}/pending`)).status, 403);
      assert.equal((await call(`${base}/rejected`)).status, 403);
      assert.equal((await call(`${base}/${OBS}/photos`)).status, 403);
      assert.equal((await call(`${base}/${OBS}/decision`, 'POST', { decision: 'approved' })).status, 403);
    });
    assert.equal(db.calls.length, 0);
  }
  role = 'officer';
});

test('pending and rejected observations return short-lived photo links to officers', async () => {
  const media = { id: 'photo-1', file_path: 'visits/leaf.jpg', caption: 'Leaf' };
  const signedUrl = 'https://example.test/signed-leaf';

  for (const review_status of ['pending', 'rejected']) {
    db = fakeDb({
      'observations:single': { data: { id: OBS, review_status, deleted_at: null }, error: null },
      observation_media: [media],
    });
    db.storage = {
      from(bucket) {
        assert.equal(bucket, 'observation-media');
        return {
          async createSignedUrls(paths, expiresIn) {
            assert.deepEqual(paths, [media.file_path]);
            assert.equal(expiresIn, 60);
            return { data: [{ path: media.file_path, signedUrl }], error: null };
          },
        };
      },
    };

    await withApp(async base => {
      const result = await call(`${base}/${OBS}/photos`);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { data: [{ ...media, url: signedUrl, expires_in: 60 }] });
    });
  }
});

test('approved and deleted observations do not use the review photo lookup', async () => {
  for (const record of [
    { review_status: 'approved', deleted_at: null },
    { review_status: 'rejected', deleted_at: '2026-11-02T00:00:00Z' },
  ]) {
    db = fakeDb({
      'observations:single': { data: { id: OBS, ...record }, error: null },
    });
    await withApp(async base => assert.equal((await call(`${base}/${OBS}/photos`)).status, 409));
    assert.ok(db.calls.every(([table]) => table === 'observations'));
  }
});

test('pending observations come with plant, species and botanist details', async () => {
  db = fakeDb({ observations: [observation], ...details });
  await withApp(async base => {
    const result = await call(`${base}/pending`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, [{
      ...observation,
      observer_name: 'Aina Rahman',
      plant: {
        id: PLANT, tag_code: 'NIAH-PLT-00001', location_description: 'Left of boardwalk',
        plant_status: 'pending', scientific_name: 'Nepenthes ampullaria', common_name: 'Pitcher plant',
        // GPS, accuracy and morphology for the detail card (none recorded here).
        latitude: null, longitude: null, gps_accuracy_m: null, morphology: null,
      },
      previous_observation: null,
      thumbnail_url: null, // no photos on this observation
    }]);
  });
  // Newest first.
  assert.ok(db.calls.some(c => c[0] === 'observations' && c[1] === 'order' && c[2] === 'observed_at' && c[3].ascending === false));
  assert.ok(db.calls.some(c => c[0] === 'observations' && c[1] === 'eq' && c[2] === 'review_status' && c[3] === 'pending'));
  assert.ok(db.calls.some(c => c[0] === 'observations' && c[1] === 'is' && c[2] === 'deleted_at' && c[3] === null));
  assert.ok(db.calls.some(c => c[0] === 'plants' && c[1] === 'select' &&
    c[2] === 'id, qr_code_value, location_description, species_id, plant_status'));
});

test('a missing plant or profile leaves those fields empty instead of failing', async () => {
  db = fakeDb({ observations: [observation], plants: [], species: [], profiles: [] });
  await withApp(async base => {
    const result = await call(`${base}/pending`);
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].plant, null);
    assert.equal(result.body.data[0].observer_name, null);
  });
});

test('an empty queue makes no extra lookups', async () => {
  db = fakeDb({ observations: [] });
  await withApp(async base => assert.deepEqual((await call(`${base}/pending`)).body, { data: [] }));
  assert.ok(db.calls.every(c => c[0] === 'observations'));
});

test('rejected observations include the latest rejection comment', async () => {
  db = fakeDb({
    observations: [{ ...observation, review_status: 'rejected' }],
    ...details,
    observation_reviews: [
      { observation_id: OBS, decision: 'rejected', comments: 'Photo is blurry', reviewed_at: '2026-11-03T05:00:00Z' },
      { observation_id: OBS, decision: 'rejected', comments: 'Older reason', reviewed_at: '2026-11-01T05:00:00Z' },
    ],
  });
  await withApp(async base => {
    const result = await call(`${base}/rejected`);
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].rejection_comment, 'Photo is blurry');
    assert.equal(result.body.data[0].rejected_at, '2026-11-03T05:00:00Z');
    assert.equal(result.body.data[0].plant.scientific_name, 'Nepenthes ampullaria');
  });
  assert.ok(db.calls.some(c => c[0] === 'observations' && c[1] === 'eq' && c[3] === 'rejected'));
});

test('database failures are reported without details', async () => {
  db = fakeDb({ observations: [observation], plants: { error: { message: 'SECRET_DATABASE_DETAILS' } } });
  await withApp(async base => {
    const result = await call(`${base}/pending`);
    assert.equal(result.status, 500);
    assert.ok(!JSON.stringify(result.body).includes('SECRET'));
  });
});

test('a decision must be approved or rejected', async () => {
  db = fakeDb();
  await withApp(async base => {
    assert.equal((await call(`${base}/${OBS}/decision`, 'POST', { decision: 'maybe' })).status, 400);
    assert.equal((await call(`${base}/not-a-uuid/decision`, 'POST', { decision: 'approved' })).status, 400);
  });
  assert.equal(db.calls.length, 0);
});

test('a decision on a pending observation is saved as an officer review', async () => {
  db = fakeDb({ 'observations:single': { data: { id: OBS, review_status: 'pending', deleted_at: null }, error: null } });
  await withApp(async base => {
    const result = await call(`${base}/${OBS}/decision`, 'POST', { decision: 'rejected', comments: '  Photo is blurry ' });
    assert.equal(result.status, 201);
  });
  const insert = db.calls.find(c => c[1] === 'insert');
  assert.deepEqual(insert, ['observation_reviews', 'insert', {
    observation_id: OBS, reviewer_id: OFFICER, decision: 'rejected', comments: 'Photo is blurry',
  }]);
});

test('a decision on an observation that is no longer pending is refused (409)', async () => {
  db = fakeDb({ 'observations:single': { data: { id: OBS, review_status: 'approved', deleted_at: null }, error: null } });
  await withApp(async base => {
    assert.equal((await call(`${base}/${OBS}/decision`, 'POST', { decision: 'approved' })).status, 409);
  });
  assert.equal(db.calls.filter(c => c[1] === 'insert').length, 0);
});

// ---- Approving needs an approved species; database refusals are explained ----

const pendingObservation = {
  'observations:single': { data: { id: OBS, plant_id: PLANT, review_status: 'pending', deleted_at: null }, error: null },
  'plants:single': { data: { id: PLANT, species_id: SPECIES }, error: null },
};

async function decide(tables, body) {
  db = fakeDb(tables);
  let result;
  await withApp(async base => {
    result = await call(`${base}/${OBS}/decision`, 'POST', body);
  });
  return result;
}

test('approving is refused with a clear reason when the species is not approved yet', async () => {
  const result = await decide({
    ...pendingObservation,
    'species:single': { data: { id: SPECIES, scientific_name: 'Nepenthes ampullaria', verification_status: 'pending' }, error: null },
  }, { decision: 'approved' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'species_not_approved');
  assert.match(result.body.message, /Nepenthes ampullaria is not an approved species yet/);
  assert.equal(db.calls.filter(c => c[1] === 'insert').length, 0);
});

test('approving is refused with a clear reason when the plant has no species', async () => {
  const result = await decide({
    ...pendingObservation,
    'plants:single': { data: { id: PLANT, species_id: null }, error: null },
  }, { decision: 'approved' });
  assert.equal(result.status, 409);
  assert.match(result.body.message, /has no species yet/);
  assert.equal(db.calls.filter(c => c[1] === 'insert').length, 0);
});

test('approving a visit of an approved species saves the review', async () => {
  const result = await decide({
    ...pendingObservation,
    'species:single': { data: { id: SPECIES, scientific_name: 'Nepenthes ampullaria', verification_status: 'approved' }, error: null },
  }, { decision: 'approved' });
  assert.equal(result.status, 201);
  assert.deepEqual(db.calls.find(c => c[1] === 'insert'), ['observation_reviews', 'insert', {
    observation_id: OBS, reviewer_id: OFFICER, decision: 'approved', comments: null,
  }]);
});

test('rejecting needs a reason', async () => {
  for (const comments of [undefined, '', '   ']) {
    const result = await decide(pendingObservation, { decision: 'rejected', comments });
    assert.equal(result.status, 400);
    assert.equal(result.body.message, 'Please give a reason for rejecting this observation');
  }
});

test('a rule raised by the database is shown as it is, not as a generic error', async () => {
  const result = await decide({
    ...pendingObservation,
    'observation_reviews:insert': { data: null, error: { code: 'P0001', message: 'Observation must be Pending; approval requires an approved species' } },
  }, { decision: 'rejected', comments: 'Blurry' });
  assert.equal(result.status, 409);
  assert.equal(result.body.message, 'Observation must be Pending; approval requires an approved species');
});

test('a permission refusal from the database says so in plain words', async () => {
  const result = await decide({
    ...pendingObservation,
    'observation_reviews:insert': { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } },
  }, { decision: 'rejected', comments: 'Blurry' });
  assert.equal(result.status, 403);
  assert.match(result.body.message, /did not allow this review for your account/);
  assert.doesNotMatch(result.body.message, /row-level security/);
});

test('an unexpected database error stays generic', async () => {
  const result = await decide({
    ...pendingObservation,
    'observation_reviews:insert': { data: null, error: { code: 'XX000', message: 'SECRET_DATABASE_DETAILS' } },
  }, { decision: 'rejected', comments: 'Blurry' });
  assert.equal(result.status, 500);
  assert.equal(result.body.message, 'Could not save observation review');
});

test('review lists come with thumbnails signed in one batch (primary photo first)', async () => {
  const OTHER_OBS = '66666666-6666-4666-8666-666666666666';
  const signCalls = [];
  for (const path of ['/pending', '/rejected']) {
    signCalls.length = 0;
    db = fakeDb({
      observations: [observation, { ...observation, id: OTHER_OBS }],
      ...details,
      observation_reviews: [],
      observation_media: [
        { observation_id: OBS, file_path: 'u/obs/first.jpg', is_primary: false },
        { observation_id: OBS, file_path: 'u/obs/primary.jpg', is_primary: true },
      ],
    });
    db.storage = {
      from(bucket) {
        assert.equal(bucket, 'observation-media');
        return {
          async createSignedUrls(paths, expiresIn) {
            signCalls.push([paths, expiresIn]);
            return { data: paths.map(p => ({ path: p, signedUrl: `https://signed/${p}` })), error: null };
          },
        };
      },
    };
    await withApp(async base => {
      const result = await call(`${base}${path}`);
      assert.equal(result.status, 200, path);
      const byId = Object.fromEntries(result.body.data.map(row => [row.id, row.thumbnail_url]));
      assert.equal(byId[OBS], 'https://signed/u/obs/primary.jpg', path);
      assert.equal(byId[OTHER_OBS], null, `${path}: no photo, no thumbnail`);
    });
    assert.equal(signCalls.length, 1, `${path}: one batch request, not one per photo`);
    assert.deepEqual(signCalls[0], [['u/obs/primary.jpg'], 600]);
  }
});

test('if thumbnails cannot be signed, the review list still loads without them', async () => {
  db = fakeDb({
    observations: [observation],
    ...details,
    observation_media: [{ observation_id: OBS, file_path: 'u/obs/primary.jpg', is_primary: true }],
  });
  db.storage = { from: () => ({ async createSignedUrls() { return { data: null, error: { message: 'storage down' } }; } }) };
  await withApp(async base => {
    const result = await call(`${base}/pending`);
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].thumbnail_url, null);
  });
});

// ---- The review page's detail card ----

test('pending records carry the GPS point, accuracy, morphology and the previous approved visit', async () => {
  const visit = { ...observation, observed_at: '2026-11-19T07:30:00Z', height_cm: 160 };
  db = fakeDb({
    observations: [
      visit,
      // Approved visits of the same plant, newest first (as the query orders them).
      { plant_id: PLANT, observed_at: '2026-11-25T01:00:00Z', height_cm: 170 }, // after this visit: ignored
      { plant_id: PLANT, observed_at: '2026-11-12T02:00:00Z', height_cm: 150 },
      { plant_id: PLANT, observed_at: '2026-10-01T02:00:00Z', height_cm: 120 },
    ],
    ...details,
    plant_map_points: [{ id: PLANT, latitude: 3.8147558, longitude: 113.7793922 }],
    plants: [{ ...details.plants[0], gps_accuracy_m: 4.6, morphology: 'Climbing, lower pitchers green' }],
  });
  await withApp(async base => {
    const result = await call(`${base}/pending`);
    assert.equal(result.status, 200);
    const row = result.body.data.find(item => item.id === OBS);
    assert.equal(row.plant.latitude, 3.8147558);
    assert.equal(row.plant.longitude, 113.7793922);
    assert.equal(row.plant.gps_accuracy_m, 4.6);
    assert.equal(row.plant.morphology, 'Climbing, lower pitchers green');
    assert.deepEqual(row.previous_observation, { observed_at: '2026-11-12T02:00:00Z', height_cm: 150 });
  });
  // Previous visits: approved and not hidden only.
  assert.ok(db.calls.some(c => c[0] === 'observations' && c[1] === 'eq' && c[2] === 'review_status' && c[3] === 'approved'));
});

test('if the extra details cannot be read, the queue still loads without them', async () => {
  db = fakeDb({ observations: [observation], ...details, plant_map_points: { error: { message: 'PRIVATE' } } });
  await withApp(async base => {
    const result = await call(`${base}/pending`);
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].plant.latitude, null);
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE/);
  });
});
