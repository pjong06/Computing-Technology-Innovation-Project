'use strict';

// Review > Species requests: the "Before you decide" checks on each waiting request
// (services/speciesRequestChecks.js), returned by GET /api/knowledge/species/proposals/pending.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
const { requestChecks, loadCatalogueNames, nameLooksRight, suggestedName, localNameProblem } =
  require('../src/services/speciesRequestChecks');
const { createKnowledgeRouter } = require('../src/routes/knowledge');
const { requireRole } = require('../src/middleware/auth');

const REQUEST = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BOTANIST = '33333333-3333-4333-8333-333333333333';

const goodRequest = {
  id: REQUEST,
  scientific_name: 'Begonia niahensis',
  common_name: 'Niah begonia',
  local_name: 'Daun asam',
  proposed_family: 'Begoniaceae',
  description: 'Small herb with red-veined leaves, growing on limestone rock faces near the cave mouth.',
  habitat: 'Limestone cliffs by the Great Cave path',
};
const keys = checks => checks.map(check => check.key);

test('a complete, correctly written new species has nothing to check', () => {
  assert.deepEqual(requestChecks(goodRequest, [{ id: OTHER, scientific_name: 'Nepenthes ampullaria', verification_status: 'approved' }]), []);
});

test('already in the catalogue or already requested: exact and case-insensitive matches', () => {
  const exact = requestChecks(goodRequest, [{ id: OTHER, scientific_name: 'Begonia niahensis', verification_status: 'approved' }]);
  assert.deepEqual(keys(exact), ['duplicate']);
  assert.equal(exact[0].message, 'Already in the catalogue as Begonia niahensis.');

  const otherCase = requestChecks(goodRequest, [{ id: OTHER, scientific_name: 'BEGONIA  Niahensis', verification_status: 'archived' }]);
  assert.match(otherCase[0].message, /^Already in the catalogue as BEGONIA {2}Niahensis \(the same name with different capitals or spacing\)\.$/);

  const requested = requestChecks(goodRequest, [{ id: OTHER, scientific_name: 'begonia niahensis', verification_status: 'pending' }]);
  assert.match(requested[0].message, /^Already requested: begonia niahensis is waiting for review/);

  // The request itself is not a duplicate of itself.
  assert.deepEqual(requestChecks(goodRequest, [{ id: REQUEST, scientific_name: 'Begonia niahensis', verification_status: 'pending' }]), []);
  // When the catalogue can't be read, the check says so instead of passing.
  assert.match(requestChecks(goodRequest, null)[0].message, /could not be checked/);
});

test('scientific name format: Genus capitalised, species part lower case, with a Fix name', () => {
  assert.equal(nameLooksRight('Nepenthes ampullaria'), true);
  assert.equal(nameLooksRight('Nepenthes ampullaria var. longicaudata'), true);
  assert.equal(nameLooksRight('Licuala orbicularis-major'), true);
  for (const wrong of ['nepenthes ampullaria', 'Nepenthes Ampullaria', 'NEPENTHES AMPULLARIA', 'Nepenthes  ampullaria', ' Nepenthes ampullaria', 'Nepenthes']) {
    assert.equal(nameLooksRight(wrong), false, wrong);
  }
  assert.equal(suggestedName('nepenthes AMPULLARIA'), 'Nepenthes ampullaria');
  assert.equal(suggestedName('Nepenthes   ampullaria'), 'Nepenthes ampullaria');
  assert.equal(suggestedName('Nepenthes'), null, 'a genus alone cannot be fixed');
  assert.equal(suggestedName('Nepenth3s ampullaria'), null, 'only capitals and spaces are fixed');

  const [check] = requestChecks({ ...goodRequest, scientific_name: 'begonia Niahensis' }, []);
  assert.equal(check.key, 'name_format');
  assert.deepEqual(check.fix, { field: 'scientific_name', value: 'Begonia niahensis', label: 'Fix name' });
  const [noFix] = requestChecks({ ...goodRequest, scientific_name: 'Begonia' }, []);
  assert.equal(noFix.key, 'name_format');
  assert.equal(noFix.fix, undefined);
});

test('missing family or description, and a description that is too short (flag only)', () => {
  const missing = requestChecks({ ...goodRequest, proposed_family: ' ', description: null }, []);
  assert.deepEqual(keys(missing), ['missing']);
  assert.equal(missing[0].message, 'Not given: family and description.');
  assert.equal(requestChecks({ ...goodRequest, proposed_family: null }, [])[0].message, 'Not given: family.');

  const short = requestChecks({ ...goodRequest, description: 'Red flowers.' }, []);
  assert.deepEqual(keys(short), ['short_description']);
  assert.match(short[0].message, /short \(12 characters\)/);
  assert.equal(short[0].fix, undefined);
});

test('a local name that cannot be right is flagged with Clear', () => {
  for (const bad of ['n/a', 'NA', '-', '???', '12345', 'Begonia niahensis', 'tiada', 'Daun 2']) {
    assert.equal(localNameProblem(bad, 'Begonia niahensis'), true, bad);
  }
  for (const fine of ['', null, 'Daun asam', "Kelakai", 'Pokok ara']) {
    assert.equal(localNameProblem(fine, 'Begonia niahensis'), false, String(fine));
  }
  const [check] = requestChecks({ ...goodRequest, local_name: 'n/a' }, []);
  assert.equal(check.key, 'local_name');
  assert.deepEqual(check.fix, { field: 'local_name', value: null, label: 'Clear' });
});

test('the catalogue names are read in pages of 1000, only rows in the catalogue or waiting', async () => {
  const calls = [];
  const pages = [Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}` })), [{ id: 'last' }]];
  const supabase = {
    from(table) {
      const query = {};
      for (const method of ['select', 'in', 'order']) query[method] = (...args) => { calls.push([table, method, ...args]); return query; };
      query.range = (from, to) => { calls.push([table, 'range', from, to]); return Promise.resolve({ data: pages.shift(), error: null }); };
      return query;
    },
  };
  const rows = await loadCatalogueNames(supabase);
  assert.equal(rows.length, 1001);
  assert.deepEqual(calls.filter(call => call[1] === 'range').map(call => call.slice(2)), [[0, 999], [1000, 1999]]);
  assert.ok(calls.some(call => call[1] === 'in' && call[2] === 'verification_status' &&
    JSON.stringify(call[3]) === JSON.stringify(['approved', 'pending', 'archived'])));

  const failing = { from: () => ({ select() { return this; }, in() { return this; }, order() { return this; },
    range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) };
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await loadCatalogueNames(failing), null);
  } finally {
    console.error = original;
  }
});

test('GET /species/proposals/pending returns each waiting request with its checks', async t => {
  const results = [
    { data: [{ ...goodRequest, scientific_name: 'begonia niahensis', proposed_by: BOTANIST, verification_status: 'pending' }], error: null, count: 1 },
    { data: [{ id: BOTANIST, full_name: 'Siti Botanist' }], error: null },
    { data: [{ id: OTHER, scientific_name: 'Begonia niahensis', verification_status: 'approved' }], error: null },
  ];
  const queries = [];
  const database = {
    from(table) {
      const calls = [['from', table]];
      queries.push(calls);
      const query = {};
      for (const method of ['select', 'eq', 'in', 'order', 'range']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
      query.then = (resolve, reject) => Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve, reject);
      return query;
    },
  };
  const app = express();
  app.use('/api/knowledge', createKnowledgeRouter({
    supabase: database,
    requireAuth(req, res, next) {
      req.user = { id: BOTANIST };
      req.profile = { role: 'officer' };
      req.supabase = database;
      next();
    },
    requireRole,
  }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/knowledge/species/proposals/pending`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data[0].proposer_name, 'Siti Botanist');
  assert.deepEqual(keys(body.data[0].checks), ['duplicate', 'name_format']);
  assert.match(body.data[0].checks[0].message, /Already in the catalogue as Begonia niahensis \(the same name with different capitals/);
  assert.equal(queries[2][0][1], 'species', 'the catalogue is read once, after the requests');
  assert.equal(queries.length, 3);
});
