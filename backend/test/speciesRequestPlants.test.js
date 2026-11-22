'use strict';

// Plants waiting for a species request (supabase/migrations/20261122160000_plant_species_request.sql):
//   - adding the species links every waiting plant to it (species_id), so its field records
//     can be approved; not adding it leaves the plants waiting;
//   - Review > Species requests shows "N plants waiting";
//   - Review > Field records says "Waiting for species request: <name>" and Approve is held
//     ("Add the species first");
//   - the app links its plant to its request through POST /api/plants/:id/species-request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const OFFICER = '11111111-1111-4111-8111-111111111111';
const BOTANIST = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const PLANT = '44444444-4444-4444-8444-444444444444';
const OBS = '55555555-5555-4555-8555-555555555555';
const REQUEST_CLIENT = '66666666-6666-4666-8666-666666666666';

let signedIn = { userId: OFFICER, role: 'officer', db: null };
mockAuth(() => signedIn);
const { createKnowledgeRouter } = require('../src/routes/knowledge');
const { requireRole } = require('../src/middleware/auth');
const reviewsRouter = require('../src/routes/officerReviews');
const plantsRouter = require('../src/routes/plants');

// A fake Supabase that answers per table and operation and records every call.
//   answers[table] = { select, update, maybeSingle } (each { data, error }), or a function.
function fakeDb(answers = {}, rpcAnswer = { data: null, error: null }) {
  const calls = [];
  const db = {
    calls,
    rpcCalls: [],
    async rpc(name, params) {
      db.rpcCalls.push([name, params]);
      return typeof rpcAnswer === 'function' ? rpcAnswer(name, params) : rpcAnswer;
    },
    from(table) {
      const query = { table, op: 'select', filters: [] };
      calls.push(query);
      const answer = (kind) => {
        const forTable = answers[table] || {};
        const value = forTable[kind] ?? forTable[query.op] ?? { data: [], error: null };
        return typeof value === 'function' ? value(query) : value;
      };
      const chain = {};
      for (const name of ['select', 'eq', 'in', 'is', 'order', 'range', 'limit', 'not']) {
        chain[name] = (...args) => {
          if (name === 'select' && query.op === 'select') query.columns = args[0];
          if (name !== 'select') query.filters.push([name, ...args]);
          return chain;
        };
      }
      chain.update = (values) => { query.op = 'update'; query.values = values; return chain; };
      chain.maybeSingle = async () => answer('maybeSingle');
      chain.single = async () => answer('maybeSingle');
      chain.then = (resolve, reject) => Promise.resolve(answer(query.op)).then(resolve, reject);
      return chain;
    },
  };
  return db;
}

async function knowledgeCall(db, method, urlPath, body) {
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge', createKnowledgeRouter({
    supabase: db,
    requireAuth(req, _res, next) {
      req.user = { id: OFFICER };
      req.profile = { role: 'officer' };
      req.supabase = db;
      next();
    },
    requireRole,
  }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/knowledge${urlPath}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const plantUpdates = (db) => db.calls.filter((call) => call.table === 'plants' && call.op === 'update');

test('adding the species links every plant waiting for the request', async () => {
  const db = fakeDb({
    species: { maybeSingle: { data: { id: REQUEST, scientific_name: 'Begonia niahensis', verification_status: 'approved' }, error: null } },
    plants: { update: { data: [{ id: PLANT }, { id: 'other-plant' }], error: null } },
  });
  const result = await knowledgeCall(db, 'PATCH', `/species/proposals/${REQUEST}/review`, { decision: 'approved' });
  assert.equal(result.status, 200);
  assert.equal(result.body.linked_plants, 2);
  const [update] = plantUpdates(db);
  assert.deepEqual(update.values, { species_id: REQUEST });
  assert.deepEqual(update.filters, [['eq', 'species_request_id', REQUEST], ['is', 'species_id', null]]);
});

test('not adding the species leaves the waiting plants as they are', async () => {
  const db = fakeDb({
    species: { maybeSingle: { data: { id: REQUEST, verification_status: 'rejected' }, error: null } },
  });
  const result = await knowledgeCall(db, 'PATCH', `/species/proposals/${REQUEST}/review`, { decision: 'rejected', comment: 'Already in the catalogue.' });
  assert.equal(result.status, 200);
  assert.equal(plantUpdates(db).length, 0);
  assert.equal(result.body.linked_plants, undefined);
});

test('before the migration (no species_request_id column) adding a species still works', async () => {
  const db = fakeDb({
    species: { maybeSingle: { data: { id: REQUEST, verification_status: 'approved' }, error: null } },
    plants: { update: { data: null, error: { code: '42703', message: 'column plants.species_request_id does not exist' } } },
  });
  const result = await knowledgeCall(db, 'PATCH', `/species/proposals/${REQUEST}/review`, { decision: 'approved' });
  assert.equal(result.status, 200);
  assert.equal(result.body.linked_plants, undefined);
});

test('Species requests: each waiting request says how many plants wait for it', async () => {
  const db = fakeDb({
    species: {
      select: (query) => query.columns?.includes('proposed_by, created_at')
        ? { data: [{ id: REQUEST, scientific_name: 'Begonia niahensis', proposed_by: BOTANIST, verification_status: 'pending' }], error: null, count: 1 }
        : { data: [], error: null },
    },
    profiles: { select: { data: [{ id: BOTANIST, full_name: 'Siti Botanist' }], error: null } },
    plants: { select: { data: [{ species_request_id: REQUEST }, { species_request_id: REQUEST }], error: null } },
  });
  const result = await knowledgeCall(db, 'GET', '/species/proposals/pending');
  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].waiting_plants, 2);
  const lookup = db.calls.find((call) => call.table === 'plants');
  assert.deepEqual(lookup.filters, [['in', 'species_request_id', [REQUEST]], ['is', 'species_id', null], ['is', 'deleted_at', null]]);
});

test('Field records: a plant waiting for a species request says so, and Approve is held', async () => {
  const pendingObservation = { id: OBS, plant_id: PLANT, observer_id: BOTANIST, observed_at: '2026-11-22T01:00:00Z', review_status: 'pending', deleted_at: null };
  const plant = { id: PLANT, qr_code_value: 'NIAH-PLT-00031', location_description: 'Zone B', species_id: null, plant_status: 'pending', species_request_id: REQUEST };
  const db = fakeDb({
    observations: { select: { data: [pendingObservation], error: null }, maybeSingle: { data: pendingObservation, error: null } },
    plants: { select: { data: [plant], error: null }, maybeSingle: { data: plant, error: null } },
    species: { select: { data: [{ id: REQUEST, scientific_name: 'Begonia niahensis' }], error: null }, maybeSingle: { data: { id: REQUEST, scientific_name: 'Begonia niahensis' }, error: null } },
  });
  signedIn = { userId: OFFICER, role: 'officer', db };
  const list = await callRoute('/api/officer/reviews', reviewsRouter, { path: '/pending' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data[0].plant.species_request, { id: REQUEST, scientific_name: 'Begonia niahensis' });

  const decision = await callRoute('/api/officer/reviews', reviewsRouter, { method: 'POST', path: `/${OBS}/decision`, body: { decision: 'approved' } });
  assert.equal(decision.status, 409);
  assert.deepEqual(decision.body, {
    message: 'Waiting for species request: Begonia niahensis. Add the species first.',
    code: 'species_request_waiting',
    species_request_id: REQUEST,
  });
});

test('the app links its plant to its species request; a request not uploaded yet is retried later', async () => {
  let db = fakeDb({}, { data: REQUEST, error: null });
  signedIn = { userId: BOTANIST, role: 'botanist', db };
  const linked = await callRoute('/api/plants', plantsRouter, { method: 'POST', path: `/${PLANT}/species-request`, body: { request_client_id: REQUEST_CLIENT } });
  assert.equal(linked.status, 200);
  assert.deepEqual(db.rpcCalls, [['link_plant_species_request', { p_plant_id: PLANT, p_request_client_id: REQUEST_CLIENT }]]);

  db = fakeDb({}, { data: null, error: { code: 'P0002', message: 'Species request not found' } });
  signedIn = { userId: BOTANIST, role: 'botanist', db };
  const later = await callRoute('/api/plants', plantsRouter, { method: 'POST', path: `/${PLANT}/species-request`, body: { request_client_id: REQUEST_CLIENT } });
  assert.equal(later.status, 409);
  assert.equal(later.body.code, 'species_request_not_uploaded');

  db = fakeDb();
  signedIn = { userId: BOTANIST, role: 'botanist', db };
  const bad = await callRoute('/api/plants', plantsRouter, { method: 'POST', path: `/${PLANT}/species-request`, body: { request_client_id: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal(db.rpcCalls.length, 0);
});

test('migration: the link column and a narrow link function; RLS untouched', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261122160000_plant_species_request.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS species_request_id uuid REFERENCES public\.species\(id\) ON DELETE SET NULL/);
  assert.match(sql, /plant\.registered_by IS DISTINCT FROM auth\.uid\(\) OR plant\.deleted_at IS NOT NULL/);
  assert.match(sql, /AND proposed_by = auth\.uid\(\);/);
  assert.match(sql, /RAISE EXCEPTION 'Species request not found' USING ERRCODE = 'P0002';/);
  assert.match(sql, /species_id = CASE WHEN request\.verification_status = 'approved' THEN request\.id ELSE species_id END/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.link_plant_species_request\(uuid, uuid\) TO authenticated;/);
  assert.doesNotMatch(sql, /CREATE POLICY|DROP POLICY|ALTER POLICY|DISABLE ROW LEVEL SECURITY/);
});

test('web: Field records shows the wait with a link and holds Approve; requests show "N plants waiting"', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8').replace(/\r\n/g, '\n');
  const queue = read('frontend/js/queue.js');
  assert.match(queue, /waiting\.append\('Waiting for species request: '\);/);
  assert.match(queue, /link\.href = 'proposals\.html\?request=' \+ encodeURIComponent\(waitingFor\.id\);/);
  assert.match(queue, /approveButton\.disabled = busy \|\| Boolean\(waitingFor\);/);
  assert.match(queue, /hint\.textContent = 'Add the species first';/);
  const proposals = read('frontend/js/proposals.js');
  assert.match(proposals, /new URLSearchParams\(location\.search\)\.get\('request'\)/);
  assert.match(proposals, /waiting \+ \(waiting === 1 \? ' plant waiting' : ' plants waiting'\)/);
  // Text wraps instead of overflowing.
  assert.match(read('frontend/css/style.css'), /\.review-waiting \{[^}]*overflow-wrap: anywhere;/);
});
