'use strict';

// "Edit and resend" for a botanist's species request that was not added:
// PATCH /api/knowledge/species/proposals/:id/resubmit -> resubmit_species_proposal().
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { createKnowledgeRouter } = require('../src/routes/knowledge');
const { requireRole } = require('../src/middleware/auth');

const USER = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const repoRoot = path.join(__dirname, '..', '..');

async function setup(t, { role = 'botanist', rpcResult = { data: null, error: null } } = {}) {
  const calls = [];
  const database = {
    from(table) { calls.push(['from', table]); throw new Error('no table writes expected'); },
    async rpc(name, args) { calls.push(['rpc', name, args]); return rpcResult; },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge', createKnowledgeRouter({
    supabase: database,
    requireAuth(req, res, next) {
      req.user = { id: USER };
      req.profile = { role };
      req.supabase = database;
      next();
    },
    requireRole,
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const send = async (id, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/knowledge/species/proposals/${id}/resubmit`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { calls, send };
}

const savedRow = {
  id: REQUEST, client_record_id: '33333333-3333-4333-8333-333333333333', scientific_name: 'Nepenthes example',
  common_name: 'Pitcher', local_name: null, proposed_family: 'Nepenthaceae', description: 'Red pitchers',
  habitat: null, verification_status: 'pending', review_comment: null,
  // Other species columns the function returns are not sent on.
  proposed_by: USER, taxonomy_id: null, created_by: USER,
};

test('a botanist sends a request that was not added again: trimmed fields, back to waiting', async (t) => {
  const { calls, send } = await setup(t, { rpcResult: { data: [savedRow], error: null } });
  const result = await send(REQUEST, {
    scientific_name: '  Nepenthes example ', common_name: ' Pitcher ', family: 'Nepenthaceae',
    description: 'Red pitchers', verification_status: 'approved', review_comment: 'ignored',
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(calls, [['rpc', 'resubmit_species_proposal', {
    p_id: REQUEST, p_scientific_name: 'Nepenthes example', p_common_name: 'Pitcher', p_local_name: null,
    p_family: 'Nepenthaceae', p_description: 'Red pitchers', p_habitat: null,
  }]]);
  assert.equal(result.body.data.verification_status, 'pending');
  assert.equal(result.body.data.review_comment, null);
  // Only the request fields go back to the phone.
  assert.equal(result.body.data.proposed_by, undefined);
  assert.equal(result.body.data.taxonomy_id, undefined);
});

test('only botanists; bad ids and empty names are refused before the database', async (t) => {
  const officer = await setup(t, { role: 'officer' });
  assert.equal((await officer.send(REQUEST, { scientific_name: 'X' })).status, 403);
  assert.deepEqual(officer.calls, []);
  const botanist = await setup(t);
  assert.equal((await botanist.send('not-a-uuid', { scientific_name: 'X' })).status, 400);
  assert.equal((await botanist.send(REQUEST, { scientific_name: '   ' })).status, 400);
  assert.equal((await botanist.send(REQUEST, { scientific_name: 'X', habitat: 5 })).status, 400);
  assert.deepEqual(botanist.calls, []);
});

test('someone else\'s request, or one that is not "not added", is refused plainly', async (t) => {
  for (const code of ['P0002', '42501']) {
    const { send } = await setup(t, { rpcResult: { data: null, error: { code, message: 'PRIVATE DETAIL' } } });
    const result = await send(REQUEST, { scientific_name: 'Nepenthes example' });
    assert.equal(result.status, 409, code);
    assert.equal(result.body.message, 'Only your own species request that was not added can be sent again.');
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE/);
  }
  const duplicate = await setup(t, { rpcResult: { data: null, error: { code: '23505', message: 'dup' } } });
  assert.equal((await duplicate.send(REQUEST, { scientific_name: 'Nepenthes rafflesiana' })).status, 409);
  // Before the migration is applied.
  const missing = await setup(t, { rpcResult: { data: null, error: { code: 'PGRST202', message: 'no function' } } });
  const result = await missing.send(REQUEST, { scientific_name: 'Nepenthes example' });
  assert.equal(result.status, 503);
  assert.match(result.body.message, /isn't available yet/);
});

test('the migration: a narrow definer function, own "not added" request only; RLS unchanged', () => {
  const sql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20261121160000_resubmit_species_proposal.sql'), 'utf8');
  const statements = sql.replace(/--.*$/gm, '');
  assert.match(statements, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(statements, /\(SELECT public\.current_app_role\(\)\) IS DISTINCT FROM 'botanist'/);
  assert.match(statements, /AND s\.proposed_by = \(SELECT auth\.uid\(\)\)\s+AND s\.verification_status = 'rejected'/);
  assert.match(statements, /verification_status = 'pending',\s+review_comment = NULL/);
  assert.match(statements, /ERRCODE = 'P0002'/);
  assert.doesNotMatch(statements, /taxonomy_id|created_by|POLICY|DISABLE ROW LEVEL SECURITY|anon\s*;/i);
  assert.match(statements, /GRANT EXECUTE ON FUNCTION public\.resubmit_species_proposal\([^)]*\)\s+TO authenticated;/);
});

test('wording: app "Request a new species" / species requests; web tab "Species requests"', () => {
  const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const home = read('niah-biotrack/app/(tabs)/home.tsx');
  assert.match(home, />Request a new species</);
  assert.match(home, /accessibilityLabel="Request a new species"/);
  assert.doesNotMatch(home, />Propose species<|'proposal' : 'proposals'/);
  const screen = read('niah-biotrack/app/propose-species.tsx');
  assert.match(screen, /'Edit species request' : 'Request a new species'/);
  assert.doesNotMatch(screen, /Submit proposal|Propose new species|propose anyway|Species proposed/);
  assert.match(read('frontend/js/shared.js'), /label: 'Species requests', countId: 'species-proposals-count'/);
  assert.match(read('frontend/proposals.html'), /<title>Species requests - Niah Biotrack<\/title>/);
  // Visible text only (styles, class names, ids and file names are code).
  const page = read('frontend/proposals.html')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/class="[^"]*"|id="[^"]*"|href="[^"]*"|src="[^"]*"|for="[^"]*"|aria-[a-z]+="[^"]*"/g, '');
  assert.doesNotMatch(page, /[Pp]ropos/);
});
