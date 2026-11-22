'use strict';

// GET /api/officer/reviews/history - the Review history page: every decision on field
// records (Approved / Sent back) and species requests (Added / Not added), officer only,
// filtered, counted, sorted and paged on the server, loaded in batched queries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const OFFICER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OFFICER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BOTANIST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PLANT_1 = '11111111-1111-4111-8111-111111111111';
const PLANT_2 = '22222222-2222-4222-8222-222222222222';
const SP_1 = '33333333-3333-4333-8333-333333333333';
const SP_REQ_ADDED = '44444444-4444-4444-8444-444444444444';
const SP_REQ_NOT = '55555555-5555-4555-8555-555555555555';
const OBS_FIRST = '66666666-6666-4666-8666-666666666666';
const OBS_LATER = '77777777-7777-4777-8777-777777777777';
const OBS_P2 = '88888888-8888-4888-8888-888888888888';

// A small fake Supabase: filters with in / not-is-null / is, ranges, and a thenable result.
// Every query is recorded. missingDecider: species reviewed_by / reviewed_at do not exist yet.
function fakeDb(tables, { missingDecider = false } = {}) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      const query = { table, filters: [], range: null, columns: '' };
      calls.push(query);
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        in(column, values) { query.filters.push(row => values.includes(row[column])); query.inSize = values.length; return builder; },
        not(column, op, value) { query.filters.push(row => row[column] !== value && row[column] !== undefined); return builder; },
        is(column, value) { query.filters.push(row => (row[column] ?? null) === value); return builder; },
        order() { return builder; },
        limit() { return builder; },
        range(from, to) { query.range = [from, to]; return builder; },
        then(resolve, reject) {
          if (missingDecider && table === 'species' && /reviewed_by/.test(query.columns)) {
            return Promise.resolve({ data: null, error: { code: '42703', message: 'column species.reviewed_by does not exist' } }).then(resolve, reject);
          }
          let rows = (tables[table] || []).filter(row => query.filters.every(keep => keep(row)));
          if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1);
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    storage: {
      from() {
        return {
          createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `https://signed/${path}` })), error: null }),
        };
      },
    },
  };
  return db;
}

function sampleTables() {
  return {
    observation_reviews: [
      { id: 'r1', observation_id: OBS_FIRST, reviewer_id: OFFICER_A, decision: 'approved', comments: null, reviewed_at: '2026-11-20T09:00:00.000Z' },
      { id: 'r2', observation_id: OBS_LATER, reviewer_id: OFFICER_B, decision: 'rejected', comments: 'Photo is blurred, please retake.', reviewed_at: '2026-11-21T10:00:00.000Z' },
      { id: 'r3', observation_id: OBS_P2, reviewer_id: OFFICER_A, decision: 'approved', comments: '', reviewed_at: '2026-01-05T08:00:00.000Z' },
      // Not a decision: never listed.
      { id: 'r4', observation_id: OBS_P2, reviewer_id: OFFICER_A, decision: 'comment', comments: 'note', reviewed_at: '2026-01-06T08:00:00.000Z' },
    ],
    observations: [
      { id: OBS_FIRST, plant_id: PLANT_1, observer_id: BOTANIST, observed_at: '2026-11-01T00:00:00Z', deleted_at: null },
      { id: OBS_LATER, plant_id: PLANT_1, observer_id: BOTANIST, observed_at: '2026-11-15T00:00:00Z', deleted_at: null },
      { id: OBS_P2, plant_id: PLANT_2, observer_id: BOTANIST, observed_at: '2026-01-01T00:00:00Z', deleted_at: null },
    ],
    plants: [
      { id: PLANT_1, species_id: SP_1, qr_code_value: 'NIAH-0001' },
      { id: PLANT_2, species_id: SP_1, qr_code_value: 'NIAH-0002' },
    ],
    species: [
      { id: SP_1, scientific_name: 'Nepenthes ampullaria', proposed_by: null, verification_status: 'approved' },
      { id: SP_REQ_ADDED, scientific_name: 'Begonia niahensis', proposed_by: BOTANIST, verification_status: 'approved',
        review_comment: null, updated_at: '2026-11-19T12:00:00.000Z', reviewed_by: OFFICER_B, reviewed_at: '2026-11-18T12:00:00.000Z' },
      { id: SP_REQ_NOT, scientific_name: 'Licuala dubia', proposed_by: BOTANIST, verification_status: 'rejected',
        review_comment: 'Already in the catalogue as Licuala orbicularis.', updated_at: '2026-10-02T12:00:00.000Z', reviewed_by: null, reviewed_at: null },
      // Still waiting: not a decision.
      { id: '99999999-9999-4999-8999-999999999999', scientific_name: 'Pending one', proposed_by: BOTANIST, verification_status: 'pending', updated_at: '2026-11-21T00:00:00Z' },
    ],
    profiles: [
      { id: OFFICER_A, full_name: 'Aina Officer' },
      { id: OFFICER_B, full_name: 'Ben Officer' },
      { id: BOTANIST, full_name: 'Siti Botanist' },
    ],
    observation_media: [
      { observation_id: OBS_FIRST, file_path: 'p1/first.jpg', is_primary: true },
    ],
  };
}

let signedIn = { userId: OFFICER_A, role: 'officer', db: fakeDb(sampleTables()) };
mockAuth(() => signedIn);
const router = require('../src/routes/officerReviews');

const get = path => callRoute('/api/officer/reviews', router, { path });
const as = (role, db = fakeDb(sampleTables())) => { signedIn = { userId: OFFICER_A, role, db }; return db; };

test('review history is for officers only: botanists and researchers get 403 and nothing is read', async () => {
  for (const role of ['botanist', 'researcher']) {
    const db = as(role);
    const response = await get('/history');
    assert.equal(response.status, 403, role);
    assert.equal(db.calls.length, 0, `${role}: no database calls`);
  }
});

test('lists every decision newest first, with types, decisions, deciders, reasons and counts', async () => {
  as('officer');
  const { status, body } = await get('/history');
  assert.equal(status, 200);
  assert.deepEqual(body.data.map(row => [row.id, row.kind, row.decision]), [
    ['review:r2', 'observation', 'sent_back'],
    ['review:r1', 'new_plant', 'approved'],
    ['species:' + SP_REQ_ADDED, 'species_request', 'added'],
    ['species:' + SP_REQ_NOT, 'species_request', 'not_added'],
    ['review:r3', 'new_plant', 'approved'],
  ]);
  const [sentBack, firstRecord, added, notAdded, older] = body.data;
  assert.equal(sentBack.reason, 'Photo is blurred, please retake.');
  assert.equal(sentBack.decided_by, 'Ben Officer');
  assert.equal(sentBack.botanist, 'Siti Botanist');
  assert.equal(sentBack.tag, 'NIAH-0001');
  assert.equal(sentBack.scientific_name, 'Nepenthes ampullaria');
  assert.equal(sentBack.plant_id, PLANT_1);
  assert.equal(firstRecord.thumbnail_url, 'https://signed/p1/first.jpg');
  assert.equal(sentBack.thumbnail_url, null);
  // Species requests: who requested, the decider when recorded, and the species to open.
  assert.equal(added.botanist, 'Siti Botanist');
  assert.equal(added.decided_by, 'Ben Officer');
  assert.equal(added.decided_at, '2026-11-18T12:00:00.000Z');
  assert.equal(added.species_id, SP_REQ_ADDED);
  assert.equal(added.plant_id, null);
  // Older species decisions have no recorded decider: updated_at and no "by".
  assert.equal(notAdded.decided_by, null);
  assert.equal(notAdded.decided_at, '2026-10-02T12:00:00.000Z');
  assert.equal(notAdded.reason, 'Already in the catalogue as Licuala orbicularis.');
  // An empty comment is no reason.
  assert.equal(older.reason, null);

  assert.deepEqual(body.counts, { all: 5, approved: 2, sent_back: 1, added: 1, not_added: 1 });
  assert.deepEqual(body.officers, [{ id: OFFICER_A, name: 'Aina Officer' }, { id: OFFICER_B, name: 'Ben Officer' }]);
  assert.deepEqual(body.pagination, { page: 1, page_size: 10, total: 5, total_pages: 1 });
});

test('filters: type, decision, officer, date range, search and sort', async () => {
  as('officer');
  const ids = async path => (await get(path)).body.data.map(row => row.id);
  assert.deepEqual(await ids('/history?type=field_record'), ['review:r2', 'review:r1', 'review:r3']);
  assert.deepEqual(await ids('/history?type=new_plant'), ['review:r1', 'review:r3']);
  assert.deepEqual(await ids('/history?type=observation'), ['review:r2']);
  assert.deepEqual(await ids('/history?type=species_request'), ['species:' + SP_REQ_ADDED, 'species:' + SP_REQ_NOT]);
  assert.deepEqual(await ids('/history?decision=approved'), ['review:r1', 'review:r3']);
  assert.deepEqual(await ids('/history?type=species_request&decision=not_added'), ['species:' + SP_REQ_NOT]);
  assert.deepEqual(await ids(`/history?officer=${OFFICER_B}`), ['review:r2', 'species:' + SP_REQ_ADDED]);
  assert.deepEqual(await ids('/history?from=2026-11-18&to=2026-11-20'), ['review:r1', 'species:' + SP_REQ_ADDED]);
  assert.deepEqual(await ids('/history?q=niah-0002'), ['review:r3']);
  assert.deepEqual(await ids('/history?q=BEGONIA'), ['species:' + SP_REQ_ADDED]);
  assert.equal((await ids('/history?q=siti')).length, 5, 'search covers the botanist');
  assert.deepEqual(await ids('/history?sort=oldest&type=field_record'), ['review:r3', 'review:r1', 'review:r2']);
});

test('decision counts follow every filter except the decision itself', async () => {
  as('officer');
  const { body } = await get('/history?type=field_record&decision=sent_back');
  assert.deepEqual(body.counts, { all: 3, approved: 2, sent_back: 1, added: 0, not_added: 0 });
  assert.equal(body.pagination.total, 1);
  const species = await get('/history?type=species_request');
  assert.deepEqual(species.body.counts, { all: 2, approved: 0, sent_back: 0, added: 1, not_added: 1 });
});

test('pages of the filtered list, and wide pages for the CSV export without thumbnails', async () => {
  as('officer');
  const second = await get('/history?page=2&page_size=2');
  assert.deepEqual(second.body.data.map(row => row.id), ['species:' + SP_REQ_ADDED, 'species:' + SP_REQ_NOT]);
  assert.deepEqual(second.body.pagination, { page: 2, page_size: 2, total: 5, total_pages: 3 });
  const past = await get('/history?page=9&page_size=2');
  assert.deepEqual(past.body.data, []);

  const db = as('officer');
  const exportPage = await get('/history?page_size=1000');
  assert.equal(exportPage.body.data.length, 5);
  assert.equal(exportPage.body.data[0].thumbnail_url, undefined);
  assert.equal(db.calls.some(call => call.table === 'observation_media'), false, 'no photo links for the export');
});

test('bad filters are refused with a plain message before anything is read', async () => {
  for (const query of ['page=0', 'page_size=0', 'page_size=1001', 'type=plants', 'decision=maybe', 'officer=not-a-uuid',
    'from=21-11-2026', 'from=2026-11-21&to=2026-11-01', 'sort=random', 'q=' + 'x'.repeat(101)]) {
    const db = as('officer');
    const response = await get('/history?' + query);
    assert.equal(response.status, 400, query);
    assert.equal(response.body.message, 'Choose the filters from the lists.');
    assert.equal(db.calls.length, 0, query);
  }
});

test('loads in batched queries, not one per decision', async () => {
  const tables = sampleTables();
  for (let index = 0; index < 250; index += 1) {
    tables.observation_reviews.push({ id: `bulk${index}`, observation_id: OBS_LATER, reviewer_id: OFFICER_A, decision: 'approved', comments: null, reviewed_at: '2025-06-01T00:00:00.000Z' });
  }
  const db = as('officer', fakeDb(tables));
  const { status, body } = await get('/history');
  assert.equal(status, 200);
  assert.equal(body.pagination.total, 255);
  assert.ok(db.calls.length <= 12, `${db.calls.length} queries for 255 decisions`);
  assert.ok(db.calls.every(call => !call.inSize || call.inSize <= 100), 'id lists go in groups of 100 or fewer');
});

test('works before the species decider columns exist: species decisions without a "by"', async () => {
  const tables = sampleTables();
  tables.species = tables.species.map(({ reviewed_by, reviewed_at, ...row }) => row);
  as('officer', fakeDb(tables, { missingDecider: true }));
  const { status, body } = await get('/history?type=species_request');
  assert.equal(status, 200);
  const added = body.data.find(row => row.species_id === SP_REQ_ADDED);
  assert.equal(added.decided_by, null);
  assert.equal(added.decided_at, '2026-11-19T12:00:00.000Z');
});

test('a database error gives a plain message', async () => {
  const db = fakeDb(sampleTables());
  const from = db.from.bind(db);
  db.from = table => (table === 'observation_reviews'
    ? { select() { return this; }, in() { return this; }, order() { return this; }, range() { return Promise.resolve({ data: null, error: { message: 'boom' } }); } }
    : from(table));
  as('officer', db);
  const original = console.error;
  console.error = () => {};
  try {
    const response = await get('/history');
    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'Could not load the review history.');
  } finally {
    console.error = original;
  }
});
