const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
const { createKnowledgeRouter } = require('../src/routes/knowledge');
const { requireRole } = require('../src/middleware/auth');

const USER = '11111111-1111-4111-8111-111111111111';
const SPECIES = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const TAXONOMY = '44444444-4444-4444-8444-444444444444';

// Fake Supabase: every awaited query takes the next result from `results`, in order,
// and records its calls in `queries` (one array per query).
async function setup(t, results = [], role = 'botanist') {
  const queries = [];
  const database = {
    from(table) {
      const calls = [['from', table]];
      queries.push(calls);
      const query = {};
      for (const method of ['select', 'eq', 'ilike', 'in', 'order', 'limit', 'range', 'insert', 'update', 'single', 'maybeSingle']) {
        query[method] = (...args) => { calls.push([method, ...args]); return query; };
      }
      query.then = (resolve, reject) =>
        Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve, reject);
      return query;
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge', createKnowledgeRouter({
    supabase: database,
    // Authentication is a fixture; role enforcement uses the real middleware.
    requireAuth(req, res, next) {
      if (!role) return res.status(401).json({ message: 'Bearer token required' });
      req.user = { id: USER };
      req.profile = { role };
      req.supabase = database;
      next();
    },
    requireRole,
  }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  async function request(path, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/knowledge${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  return { queries, request };
}

const insertOf = queries => queries.flat().find(c => c[0] === 'insert');
const updateOf = queries => queries.flat().find(c => c[0] === 'update');

test('botanist proposal is always saved as pending by the signed-in user', async t => {
  const { request, queries } = await setup(t, [
    { data: null, error: null },          // no earlier upload with this client_record_id
    { data: [], error: null },            // no species with this name
    { data: { id: SPECIES, verification_status: 'pending' }, error: null },
  ]);
  const response = await request('/species/proposals', 'POST', {
    scientific_name: '  Nepenthes example  ', client_record_id: CLIENT,
    common_name: ' Example pitcher ', family: ' Nepenthaceae ', description: 'Red pitchers',
  });
  assert.equal(response.status, 201);
  assert.deepEqual(insertOf(queries)[1], {
    scientific_name: 'Nepenthes example', client_record_id: CLIENT,
    verification_status: 'pending', proposed_by: USER, created_by: USER,
    common_name: 'Example pitcher', proposed_family: 'Nepenthaceae', description: 'Red pitchers',
  });
});

test('client-sent approval and ownership fields are ignored', async t => {
  const { request, queries } = await setup(t, [
    { data: null, error: null }, { data: [], error: null }, { data: { id: SPECIES }, error: null },
  ]);
  assert.equal((await request('/species/proposals', 'POST', {
    scientific_name: 'Shorea example', client_record_id: CLIENT,
    verification_status: 'approved', proposed_by: SPECIES, created_by: SPECIES,
    taxonomy_id: TAXONOMY, review_comment: 'ok',
  })).status, 201);
  const row = insertOf(queries)[1];
  assert.equal(row.verification_status, 'pending');
  assert.equal(row.proposed_by, USER);
  assert.equal(row.created_by, USER);
  assert.ok(!('taxonomy_id' in row));
  assert.ok(!('review_comment' in row));
});

test('duplicate scientific name (any letter case) is rejected before insert', async t => {
  const { request, queries } = await setup(t, [
    { data: null, error: null },
    { data: [{ id: SPECIES, verification_status: 'approved' }], error: null },
  ]);
  const response = await request('/species/proposals', 'POST', {
    scientific_name: 'NEPENTHES_ example%', client_record_id: CLIENT,
  });
  assert.equal(response.status, 409);
  assert.equal(insertOf(queries), undefined);
  // Matched literally: % and _ are escaped so they aren't wildcards.
  const ilike = queries.flat().find(c => c[0] === 'ilike');
  assert.deepEqual(ilike, ['ilike', 'scientific_name', 'NEPENTHES\\_ example\\%']);
});

test('a duplicate hidden by RLS is caught by the unique index (23505)', async t => {
  const { request } = await setup(t, [
    { data: null, error: null }, { data: [], error: null }, { data: null, error: { code: '23505' } },
  ]);
  assert.equal((await request('/species/proposals', 'POST', {
    scientific_name: 'Shorea example', client_record_id: CLIENT,
  })).status, 409);
});

test('a retried upload returns the saved proposal instead of a duplicate', async t => {
  const saved = { id: SPECIES, client_record_id: CLIENT, verification_status: 'pending' };
  const { request, queries } = await setup(t, [{ data: saved, error: null }]);
  const response = await request('/species/proposals', 'POST', {
    scientific_name: 'Shorea example', client_record_id: CLIENT,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, saved);
  assert.equal(insertOf(queries), undefined);
});

test('invalid proposals never query the database', async t => {
  const { request, queries } = await setup(t);
  for (const body of [
    {}, { client_record_id: CLIENT }, { scientific_name: 'x'.repeat(201), client_record_id: CLIENT },
    { scientific_name: 'Shorea example' }, { scientific_name: 'Shorea example', client_record_id: 'bad' },
    { scientific_name: 'Shorea example', client_record_id: CLIENT, common_name: '   ' },
    { scientific_name: 'Shorea example', client_record_id: CLIENT, family: 'x'.repeat(201) },
  ]) {
    assert.equal((await request('/species/proposals', 'POST', body)).status, 400);
  }
  assert.equal(queries.length, 0);
});

test('botanist reads only their own proposals', async t => {
  const { request, queries } = await setup(t, [{ data: [{ id: SPECIES }], error: null, count: 1 }]);
  const response = await request('/species/proposals/mine');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, [{ id: SPECIES }]);
  assert.ok(queries[0].some(c => c[0] === 'eq' && c[1] === 'proposed_by' && c[2] === USER));
});

for (const [role, status] of [[null, 401], ['officer', 403], ['researcher', 403]]) {
  test(`proposal routes refuse ${role || 'unauthenticated'} users`, async t => {
    const { request, queries } = await setup(t, [], role);
    assert.equal((await request('/species/proposals', 'POST', {
      scientific_name: 'Shorea example', client_record_id: CLIENT,
    })).status, status);
    assert.equal((await request('/species/proposals/mine')).status, status);
    assert.equal(queries.length, 0);
  });
}

for (const [role, status] of [[null, 401], ['botanist', 403], ['researcher', 403]]) {
  test(`${role || 'unauthenticated'} user cannot review a proposal`, async t => {
    const { request, queries } = await setup(t, [], role);
    assert.equal((await request(`/species/proposals/${SPECIES}/review`, 'PATCH', { decision: 'approved' })).status, status);
    assert.equal(queries.length, 0);
  });
}

test('officer approves a pending proposal and can link taxonomy', async t => {
  const { request, queries } = await setup(t, [
    { data: { id: SPECIES, verification_status: 'approved' }, error: null },
  ], 'officer');
  const response = await request(`/species/proposals/${SPECIES}/review`, 'PATCH', {
    decision: 'approved', taxonomy_id: TAXONOMY,
  });
  assert.equal(response.status, 200);
  // Who decided and when are recorded too (for Review history).
  const { reviewed_at: approvedAt, ...approved } = updateOf(queries)[1];
  assert.deepEqual(approved, {
    verification_status: 'approved', review_comment: null, taxonomy_id: TAXONOMY, reviewed_by: USER,
  });
  assert.ok(Math.abs(Date.parse(approvedAt) - Date.now()) < 60000);
  // Only a row that is still pending can change.
  assert.ok(queries[0].some(c => c[0] === 'eq' && c[1] === 'verification_status' && c[2] === 'pending'));
});

test('officer rejection needs a comment and stores it', async t => {
  const { request, queries } = await setup(t, [
    { data: { id: SPECIES, verification_status: 'rejected' }, error: null },
  ], 'officer');
  assert.equal((await request(`/species/proposals/${SPECIES}/review`, 'PATCH', { decision: 'rejected' })).status, 400);
  assert.equal(queries.length, 0);
  assert.equal((await request(`/species/proposals/${SPECIES}/review`, 'PATCH', {
    decision: 'rejected', comment: '  Already listed as a synonym  ', taxonomy_id: TAXONOMY,
  })).status, 200);
  // A rejection never links taxonomy.
  const { reviewed_at: rejectedAt, ...rejected } = updateOf(queries)[1];
  assert.deepEqual(rejected, { verification_status: 'rejected', review_comment: 'Already listed as a synonym', reviewed_by: USER });
  assert.ok(Math.abs(Date.parse(rejectedAt) - Date.now()) < 60000);
});

test('invalid reviews never query the database', async t => {
  const { request, queries } = await setup(t, [], 'officer');
  assert.equal((await request('/species/proposals/bad/review', 'PATCH', { decision: 'approved' })).status, 400);
  for (const body of [{}, { decision: 'archived' }, { decision: 'approved', taxonomy_id: 'bad' },
    { decision: 'approved', comment: '   ' }]) {
    assert.equal((await request(`/species/proposals/${SPECIES}/review`, 'PATCH', body)).status, 400);
  }
  assert.equal(queries.length, 0);
});

test('reviewing a proposal that is no longer pending returns 409, a missing one 404', async t => {
  const { request } = await setup(t, [
    { data: null, error: null }, { data: { id: SPECIES, verification_status: 'approved' }, error: null },
    { data: null, error: null }, { data: null, error: null },
  ], 'officer');
  assert.equal((await request(`/species/proposals/${SPECIES}/review`, 'PATCH', { decision: 'approved' })).status, 409);
  assert.equal((await request(`/species/proposals/${SPECIES}/review`, 'PATCH', { decision: 'approved' })).status, 404);
});

test('database failures return a generic message', async t => {
  const { request } = await setup(t, [{ data: null, error: { message: 'SECRET_DATABASE_DETAILS' } }]);
  const response = await request('/species/proposals', 'POST', { scientific_name: 'Shorea example', client_record_id: CLIENT });
  assert.equal(response.status, 500);
  assert.ok(!JSON.stringify(response.body).includes('SECRET'));
});

// ---- Officer list of pending proposals ----

test('officer lists pending proposals with the proposing botanist name', async t => {
  const { request, queries } = await setup(t, [
    {
      data: [{
        id: SPECIES, scientific_name: 'Nepenthes example', proposed_by: USER,
        verification_status: 'pending', created_at: '2026-11-14T09:00:00Z',
      }],
      error: null, count: 1,
    },
    { data: [{ id: USER, full_name: 'Aina Rahman' }], error: null },
  ], 'officer');
  const response = await request('/species/proposals/pending');
  assert.equal(response.status, 200);
  assert.equal(response.body.data[0].proposer_name, 'Aina Rahman');
  assert.equal(response.body.data[0].created_at, '2026-11-14T09:00:00Z');
  assert.deepEqual(response.body.pagination, { page: 1, page_size: 100, total: 1, total_pages: 1 });
  assert.ok(queries[0].some(c => c[0] === 'eq' && c[1] === 'verification_status' && c[2] === 'pending'));
  assert.ok(queries[0].some(c => c[0] === 'select' && /proposed_by, created_at/.test(c[1])));
  assert.deepEqual(queries[1].find(c => c[0] === 'in'), ['in', 'id', [USER]]);
});

test('pending proposals still load if proposer names cannot be read', async t => {
  const { request } = await setup(t, [
    { data: [{ id: SPECIES, scientific_name: 'Nepenthes example', proposed_by: USER }], error: null, count: 1 },
    { data: null, error: { message: 'permission denied' } },
  ], 'officer');
  const response = await request('/species/proposals/pending');
  assert.equal(response.status, 200);
  assert.equal(response.body.data[0].proposer_name, null);
});

test('only officers can list pending proposals', async t => {
  for (const role of ['botanist', 'researcher', 'visitor']) {
    const { request, queries } = await setup(t, [], role);
    assert.equal((await request('/species/proposals/pending')).status, 403, role);
    assert.equal(queries.length, 0);
  }
});

test('pending proposal list failures stay generic', async t => {
  const { request } = await setup(t, [{ data: null, error: { message: 'SECRET_DATABASE_DETAILS' } }], 'officer');
  const response = await request('/species/proposals/pending');
  assert.equal(response.status, 500);
  assert.equal(response.body.message, 'Could not load species proposals');
});
