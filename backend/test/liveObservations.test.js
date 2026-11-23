'use strict';

// Pending work for officers leaves out observations whose plant was soft-deleted (and deleted
// observations), with one rule (src/services/liveObservations.js): Review > Field records,
// the Review count badges (report summary), Overview's "Waiting for review", Review history
// and the plant page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const OFFICER = '11111111-1111-4111-8111-111111111111';
const BOTANIST = '22222222-2222-4222-8222-222222222222';
const LIVE_PLANT = '33333333-3333-4333-8333-333333333333';
const GONE_PLANT = '44444444-4444-4444-8444-444444444444';
const OBS_LIVE = '55555555-5555-4555-8555-555555555555';
const OBS_ON_GONE_PLANT = '66666666-6666-4666-8666-666666666666';
const OBS_DELETED = '77777777-7777-4777-8777-777777777777';

let db;
mockAuth(() => ({ userId: OFFICER, role: 'officer', db }));
const reviewsRouter = require('../src/routes/officerReviews');
const reportsRouter = require('../src/routes/reports');
const plantsRouter = require('../src/routes/officerPlants');
const { createOfficerOverviewRouter } = require('../src/routes/officerOverview');
const {
  deletedPlantIdsAmong, isLiveObservation, livePendingObservations, countLivePendingObservations,
} = require('../src/services/liveObservations');

// A fake Supabase that really applies eq / is / in / not-is-null / range, and answers counts
// (head: true) with the number of matching rows.
function fakeDb(tables) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      const query = { table, filters: [], range: null, op: 'select' };
      calls.push(query);
      const chain = {};
      const keep = (row) => query.filters.every((filter) => filter(row));
      chain.select = (columns, options) => { query.columns = columns; query.head = options?.head; return chain; };
      chain.eq = (column, value) => { query.filters.push((row) => row[column] === value); return chain; };
      chain.neq = (column, value) => { query.filters.push((row) => row[column] !== value); return chain; };
      chain.is = (column, value) => { query.filters.push((row) => (row[column] ?? null) === value); return chain; };
      chain.in = (column, values) => { query.inSize = values.length; query.filters.push((row) => values.includes(row[column])); return chain; };
      chain.not = (column, op, value) => { query.filters.push((row) => (row[column] ?? null) !== value); return chain; };
      for (const name of ['gte', 'lt', 'lte', 'gt']) chain[name] = () => chain;
      chain.order = () => chain;
      chain.limit = (n) => { query.limit = n; return chain; };
      chain.range = (from, to) => { query.range = [from, to]; return chain; };
      const rows = () => {
        let found = (tables[table] || []).filter(keep);
        if (query.range) found = found.slice(query.range[0], query.range[1] + 1);
        if (query.limit) found = found.slice(0, query.limit);
        return found;
      };
      chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      chain.then = (resolve, reject) => {
        const found = rows();
        return Promise.resolve(query.head ? { count: found.length, data: null, error: null } : { data: found, error: null })
          .then(resolve, reject);
      };
      return chain;
    },
    storage: { from: () => ({ createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }) }) },
  };
  return db;
}

function sampleTables() {
  return {
    plants: [
      { id: LIVE_PLANT, qr_code_value: 'NIAH-PLT-00001', species_id: null, plant_status: 'pending', registered_by: BOTANIST, deleted_at: null },
      { id: GONE_PLANT, qr_code_value: 'NIAH-PLT-00014', species_id: null, plant_status: 'pending', registered_by: BOTANIST, deleted_at: '2026-11-20T00:00:00Z' },
    ],
    observations: [
      { id: OBS_LIVE, plant_id: LIVE_PLANT, observer_id: BOTANIST, observed_at: '2026-11-21T00:00:00Z', review_status: 'pending', deleted_at: null },
      // Its plant was deleted: never listed or counted.
      { id: OBS_ON_GONE_PLANT, plant_id: GONE_PLANT, observer_id: BOTANIST, observed_at: '2026-11-22T00:00:00Z', review_status: 'pending', deleted_at: null },
      // Deleted itself.
      { id: OBS_DELETED, plant_id: LIVE_PLANT, observer_id: BOTANIST, observed_at: '2026-11-22T01:00:00Z', review_status: 'pending', deleted_at: '2026-11-22T02:00:00Z' },
    ],
    profiles: [{ id: BOTANIST, full_name: 'Siti Botanist' }, { id: OFFICER, full_name: 'Aina Officer' }],
    observation_reviews: [
      { id: 'r-live', observation_id: OBS_LIVE, reviewer_id: OFFICER, decision: 'rejected', comments: 'Retake', reviewed_at: '2026-11-21T05:00:00Z' },
      { id: 'r-gone', observation_id: OBS_ON_GONE_PLANT, reviewer_id: OFFICER, decision: 'approved', comments: null, reviewed_at: '2026-11-22T05:00:00Z' },
      { id: 'r-deleted', observation_id: OBS_DELETED, reviewer_id: OFFICER, decision: 'approved', comments: null, reviewed_at: '2026-11-22T06:00:00Z' },
    ],
  };
}

test('the rule: live = not deleted, and its plant not deleted', async () => {
  const gone = new Set([GONE_PLANT]);
  assert.equal(isLiveObservation({ plant_id: LIVE_PLANT, deleted_at: null }, gone), true);
  assert.equal(isLiveObservation({ plant_id: GONE_PLANT, deleted_at: null }, gone), false);
  assert.equal(isLiveObservation({ plant_id: LIVE_PLANT, deleted_at: '2026-11-22' }, gone), false);
  db = fakeDb(sampleTables());
  assert.deepEqual([...await deletedPlantIdsAmong(db, [LIVE_PLANT, GONE_PLANT, LIVE_PLANT])], [GONE_PLANT]);
  assert.deepEqual((await livePendingObservations(db, 'id')).map((row) => row.id), [OBS_LIVE]);
  assert.equal(await countLivePendingObservations(db), 1);
});

test('deleted plants are looked up in batches of 100 ids, not one query per row', async () => {
  const many = Array.from({ length: 250 }, (_, i) => `plant-${i}`);
  db = fakeDb({ plants: [] });
  await deletedPlantIdsAmong(db, many);
  const lookups = db.calls.filter((call) => call.table === 'plants');
  assert.deepEqual(lookups.map((call) => call.inSize), [100, 100, 50]);
});

test('Review > Field records: a pending observation of a deleted plant is not listed', async () => {
  db = fakeDb(sampleTables());
  const result = await callRoute('/api/officer/reviews', reviewsRouter, { path: '/pending' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map((row) => row.id), [OBS_LIVE]);
});

test('Review count badge (report summary): not counted', async () => {
  db = fakeDb({ ...sampleTables(), species: [] });
  const result = await callRoute('/api/reports', reportsRouter, { path: '/summary' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.pending_observation_count, 1);
});

test('Overview "Waiting for review": not counted', async () => {
  db = fakeDb({ ...sampleTables(), species: [], sensor_stations: [], sensor_readings: [], alerts: [] });
  const overview = createOfficerOverviewRouter({ now: () => new Date('2026-11-22T12:00:00Z') });
  const result = await callRoute('/api/officer/overview', overview, { path: '/' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.pending_field_record_count, 1);
  assert.equal(result.body.data.waiting_review_count, 1);
});

test('Review history: decisions on a deleted plant or a deleted observation are left out', async () => {
  db = fakeDb({ ...sampleTables(), species: [] });
  const result = await callRoute('/api/officer/reviews', reviewsRouter, { path: '/history' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map((row) => row.id), ['review:r-live']);
  assert.equal(result.body.counts.all, 1);
});

test('plant page: a deleted plant is not shown; its banner counts only live observations', async () => {
  db = fakeDb({ ...sampleTables(), plant_map_points: [], plant_media: [], species: [] });
  const gone = await callRoute('/api/officer/plants', plantsRouter, { path: `/${GONE_PLANT}` });
  assert.equal(gone.status, 404);
  const live = await callRoute('/api/officer/plants', plantsRouter, { path: `/${LIVE_PLANT}` });
  assert.equal(live.status, 200);
  // The deleted observation is not among the plant's observations (the banner counts these).
  assert.deepEqual(live.body.data.observations.map((row) => row.id), [OBS_LIVE]);
});

test('one shared rule: every place uses services/liveObservations.js', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('src/routes/officerReviews.js'), /livePendingObservations\(req\.supabase, OBSERVATION_COLUMNS, \{ limit: 100 \}\)/);
  assert.match(read('src/services/reportService.js'), /countLivePendingObservations\(client\)/);
  assert.match(read('src/routes/officerOverview.js'), /countLivePendingObservations\(client\)/);
  assert.match(read('src/services/reviewHistory.js'), /isLiveObservation\(observation, deletedPlants\)/);
});
