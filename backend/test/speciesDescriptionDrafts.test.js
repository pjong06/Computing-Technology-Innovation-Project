'use strict';

// Draft species text: scripts/species-descriptions/fill.mjs fills only EMPTY description,
// habitat, common name and family fields of approved species, marks them as drafts
// (species.description_is_draft), and the officer's editor shows "Draft description: please
// review" with "Mark as reviewed".
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { createKnowledgeRouter } = require('../src/routes/knowledge');
const { requireRole } = require('../src/middleware/auth');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/\r\n/g, '\n');
const load = (file) => import(pathToFileURL(path.join(repoRoot, file)).href);
const SPECIES_ID = '33333333-3333-4333-8333-333333333333';

// ---- planning: only empty fields ----

test('only EMPTY fields get a draft; existing text is never replaced', async () => {
  const { planFills } = await load('scripts/species-descriptions/lib.mjs');
  const drafts = {
    'Begonia niahensis': { family: 'Begoniaceae', common_name: null, habitat: null, description: 'A begonia.' },
    Ficus: { family: 'Moraceae', common_name: 'Figs', habitat: 'Forest.', description: 'Identified to genus level; figs.' },
  };
  const species = [
    // Description and family empty; habitat and common name already written.
    { id: 'a', scientific_name: 'Begonia niahensis', description: null, habitat: 'On limestone at Niah', common_name: 'Niah begonia', taxonomy: null },
    // Everything filled in already: nothing to do.
    { id: 'b', scientific_name: 'Ficus', description: 'Officer text', habitat: 'Officer habitat', common_name: 'Fig', taxonomy: { family: 'Moraceae' } },
    // Spaces only count as empty; the family row exists but has no family.
    { id: 'c', scientific_name: 'ficus', description: '   ', habitat: '', common_name: null, taxonomy: { family: null, genus: 'Ficus' } },
    // A name with no draft at all.
    { id: 'd', scientific_name: 'Unknownia', description: null, habitat: 'x', common_name: 'y', taxonomy: { family: 'Zaceae' } },
  ];
  const { fills, gaps } = planFills(species, drafts);
  const key = (row) => `${row.species_id}:${row.field}`;
  assert.deepEqual(fills.map(key).sort(), ['a:description', 'a:family', 'c:common_name', 'c:description', 'c:family', 'c:habitat']);
  assert.equal(fills.find((row) => key(row) === 'c:description').old_value, '   ');
  assert.equal(fills.find((row) => key(row) === 'c:common_name').new_value, 'Figs');
  // Nothing already written appears in the fills.
  for (const row of fills) assert.ok(!['On limestone at Niah', 'Niah begonia', 'Officer text', 'Officer habitat', 'Fig'].includes(row.old_value));
  // No confident draft, or no draft at all: listed, left empty.
  assert.deepEqual(gaps.map(key).sort(), ['d:description']);
  assert.match(gaps[0].action, /left empty: no draft for this name/);
  const noConfident = planFills([{ id: 'e', scientific_name: 'Begonia niahensis', description: 'x', habitat: null, common_name: null, taxonomy: { family: 'Begoniaceae' } }], drafts);
  assert.deepEqual(noConfident.fills, []);
  assert.deepEqual(noConfident.gaps.map((row) => row.field).sort(), ['common_name', 'habitat']);
  assert.ok(noConfident.gaps.every((row) => /no confident draft/.test(row.action) && row.new_value === ''));
});

test('family: a new classification keeps the current ranks and takes the genus from the name', async () => {
  const { genusOf, targetTaxonomy } = await load('scripts/species-descriptions/lib.mjs');
  assert.equal(genusOf('Begonia niahensis'), 'Begonia');
  assert.equal(genusOf('Ficus'), 'Ficus');
  for (const name of ['Araceae', 'Monstereae', 'Aeridinae', 'Calamoideae', 'Plantae', 'Magnoliopsida', '']) {
    assert.equal(genusOf(name), null, name);
  }
  assert.deepEqual(targetTaxonomy(null, 'Begoniaceae', 'Begonia kachak'),
    { kingdom: 'Plantae', division: null, class_name: null, order_name: null, family: 'Begoniaceae', genus: 'Begonia' });
  assert.deepEqual(targetTaxonomy({ kingdom: 'Plantae', division: 'Tracheophyta', class_name: 'Magnoliopsida', order_name: null, family: null, genus: 'Ficus' }, 'Moraceae', 'Ficus laevis'),
    { kingdom: 'Plantae', division: 'Tracheophyta', class_name: 'Magnoliopsida', order_name: null, family: 'Moraceae', genus: 'Ficus' });
});

// ---- the drafts ----

// A small committed sample of names (one of each kind of record). Tests never depend on
// git-ignored files such as scripts/species-photos/*.csv, which CI doesn't have.
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'species-description-names.json'), 'utf8'));

test('drafts: the sample names (species, genus, family, tribe, broad group) all have a draft of the right kind', async () => {
  const { DRAFTS } = await load('scripts/species-descriptions/drafts.mjs');
  const { findDraft } = await load('scripts/species-descriptions/lib.mjs');
  for (const kind of ['species', 'genus', 'family', 'below_family', 'broad']) {
    assert.ok(FIXTURE[kind].length > 0, kind);
    for (const name of FIXTURE[kind]) assert.ok(findDraft(DRAFTS, name), `${kind}: no draft for ${name}`);
  }
  for (const name of FIXTURE.genus) assert.match(DRAFTS[name].description, /^Identified to genus level; /, name);
  for (const name of FIXTURE.family) assert.match(DRAFTS[name].description, /^Identified to family level; /, name);
  for (const name of FIXTURE.broad) assert.match(DRAFTS[name].description, /^Identified only to a broad group/, name);
  // Names are matched ignoring case and extra spaces, as they may be typed in the database.
  assert.equal(findDraft(DRAFTS, '  begonia   NIAHENSIS '), DRAFTS['Begonia niahensis']);
  assert.equal(findDraft(DRAFTS, 'Not a plant'), null);
});

// The full species list is a local, git-ignored file: checked only where it exists.
const SPECIES_LIST = path.join(repoRoot, 'scripts', 'species-photos', 'species-photo-list.csv');
test('drafts: every name in the local species list has one (optional file)', {
  skip: fs.existsSync(SPECIES_LIST) ? false : 'scripts/species-photos/species-photo-list.csv is not present (git-ignored)',
}, async () => {
  const { DRAFTS } = await load('scripts/species-descriptions/drafts.mjs');
  const names = fs.readFileSync(SPECIES_LIST, 'utf8').replace(/\r\n/g, '\n').trim().split('\n').slice(1).map((line) => line.split(',')[1]);
  assert.ok(names.length > 0);
  for (const name of new Set(names)) assert.ok(DRAFTS[name], `no draft entry for ${name}`);
});

test('drafts: conservative text, no numbers; genus and family records say so', async () => {
  const { DRAFTS } = await load('scripts/species-descriptions/drafts.mjs');
  const { genusOf } = await load('scripts/species-descriptions/lib.mjs');

  for (const [name, draft] of Object.entries(DRAFTS)) {
    assert.deepEqual(Object.keys(draft).sort(), ['common_name', 'description', 'family', 'habitat'], name);
    assert.equal(typeof draft.description, 'string', name);
    for (const field of ['description', 'habitat', 'common_name']) {
      if (draft[field] === null) continue;
      assert.doesNotMatch(draft[field], /\d/, `${name} ${field}: no numbers`);
      assert.doesNotMatch(draft[field], /\b(height|diameter|health|life stage)\b/i, `${name} ${field}: no plant-level data`);
    }
    const sentences = draft.description.split(/(?<=\.)\s+/).length;
    assert.ok(sentences >= 1 && sentences <= 3, `${name}: ${sentences} sentences`);
    if (draft.habitat !== null) assert.ok(!draft.habitat.includes('\n') && draft.habitat.length <= 120, `${name}: one-line habitat`);
    if (draft.family !== null) assert.match(draft.family, /^[A-Z][a-z]+aceae$/, `${name}: family`);

    const words = name.split(' ');
    if (words.length === 1 && /aceae$/.test(name)) assert.match(draft.description, /^Identified to family level; /, name);
    else if (words.length === 1 && genusOf(name)) assert.match(draft.description, /^Identified to genus level; /, name);
    if (['Plantae', 'Tracheophyta', 'Angiospermae', 'Magnoliopsida', 'Bryophyta', 'Marchantiophyta', 'Polypodiopsida', 'Polypodiineae'].includes(name)) {
      assert.equal(draft.family, null, name);
      assert.equal(draft.habitat, null, name);
      assert.match(draft.description, /^Identified only to a broad group/, name);
    }
  }
});

// ---- the script ----

test('script: dry run by default, key from the environment only, conditional writes, no plant data', async () => {
  const script = await load('scripts/species-descriptions/fill.mjs');
  assert.equal(script.parseArguments([]).apply, false);
  assert.equal(script.parseArguments(['--apply']).apply, true);
  assert.throws(() => script.parseArguments(['--force']), /Unknown option/);
  // Writes only while the field still has the old value from the report.
  assert.equal(script.unchanged('description', null), 'description=is.null');
  assert.equal(script.unchanged('habitat', ''), 'habitat=eq.');
  assert.equal(script.unchanged('description', '  '), 'description=eq.%20%20');

  const source = read('scripts/species-descriptions/fill.mjs');
  const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  assert.match(code, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(code, /dotenv|\.env['"]|readFileSync/);
  assert.match(code, /verification_status: 'eq\.approved'/);
  // Every write is a PATCH of one species, conditional, and marks it as a draft.
  const patches = [...code.matchAll(/rest\(\s*`([^`]+)`,\s*\{ method: 'PATCH', body: \{([^}]*)\}/g)];
  assert.equal(patches.length, 2);
  for (const [, url, body] of patches) {
    assert.match(url, /^species\?id=eq\.\$\{row\.id\}&\$\{unchanged\(/);
    assert.match(body, /description_is_draft: true/);
  }
  // Taxonomy rows are only read or added, never changed; plants are never touched.
  assert.doesNotMatch(code, /rest\(`taxonomy[^`]*`,\s*\{ method: '(PATCH|DELETE)'/);
  assert.doesNotMatch(code, /plants|height|diameter|health_status|life_stage/);
  assert.match(code, /if \(options\.apply\) \{\s*await applyFills\(species, fills\);/);
  assert.match(code, /'will fill \(dry run\)'/);
  // The report has the columns asked for.
  const { REPORT_COLUMNS } = await load('scripts/species-descriptions/lib.mjs');
  assert.deepEqual(REPORT_COLUMNS.slice(0, 4), ['species', 'field', 'old_value', 'new_value']);
});

test('migration: description_is_draft (default false) and narrow grants for the script; no RLS change', () => {
  const sql = read('supabase/migrations/20261121180000_species_description_draft.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS description_is_draft boolean NOT NULL DEFAULT false;/);
  assert.match(sql, /GRANT UPDATE \(description, habitat, common_name, taxonomy_id, description_is_draft\)\s+ON TABLE public\.species TO service_role;/);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE public\.taxonomy TO service_role;/);
  assert.doesNotMatch(sql, /POLICY|ROW LEVEL SECURITY|TO (anon|authenticated|public)\b|GRANT (ALL|DELETE)/i);
});

// ---- officer editor ----

async function startKnowledge(t, { role = 'officer', row = { id: SPECIES_ID, description_is_draft: true }, error = null } = {}) {
  const calls = [];
  const database = {
    from(table) {
      const query = {};
      for (const method of ['select', 'eq']) query[method] = (...args) => { calls.push([table, method, ...args]); return query; };
      query.update = (values) => { calls.push([table, 'update', values]); return query; };
      query.maybeSingle = async () => ({ data: error ? null : row, error });
      return query;
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge', createKnowledgeRouter({
    supabase: database,
    requireAuth(req, _res, next) {
      req.user = { id: 'u1' };
      req.profile = { role };
      req.supabase = database;
      next();
    },
    requireRole,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}/api/knowledge/species/`;
  return { calls, get: (p) => fetch(url + p), post: (p) => fetch(url + p, { method: 'POST' }) };
}

test('draft status and "Mark as reviewed": officers only; marking sets only description_is_draft to false', async (t) => {
  const s = await startKnowledge(t);
  const status = await s.get(`${SPECIES_ID}/draft-status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { data: { description_is_draft: true } });

  const marked = await s.post(`${SPECIES_ID}/mark-reviewed`);
  assert.equal(marked.status, 200);
  assert.deepEqual(s.calls.find((c) => c[1] === 'update'), ['species', 'update', { description_is_draft: false }]);
  assert.ok(s.calls.some((c) => c[1] === 'eq' && c[2] === 'id' && c[3] === SPECIES_ID));

  assert.equal((await s.get('not-a-uuid/draft-status')).status, 400);
  for (const role of ['botanist', 'researcher']) {
    const other = await startKnowledge(t, { role });
    assert.equal((await other.get(`${SPECIES_ID}/draft-status`)).status, 403, role);
    assert.equal((await other.post(`${SPECIES_ID}/mark-reviewed`)).status, 403, role);
    assert.equal(other.calls.length, 0);
  }
});

test('before the migration every species counts as reviewed, and marking says to apply it', async (t) => {
  const s = await startKnowledge(t, { error: { code: '42703', message: 'column species.description_is_draft does not exist' } });
  assert.deepEqual(await (await s.get(`${SPECIES_ID}/draft-status`)).json(), { data: { description_is_draft: false } });
  const marked = await s.post(`${SPECIES_ID}/mark-reviewed`);
  assert.equal(marked.status, 400);
  assert.match((await marked.json()).message, /migration/);
});

test('species editor: "Draft description: please review" with "Mark as reviewed", for officers only; other pages unchanged', () => {
  const html = read('frontend/editor.html');
  assert.match(html, /<div class="draft-note" id="draft-note" role="status" hidden>\s*<span>Draft description: please review<\/span>\s*<button class="btn ghost small" id="mark-reviewed-button" type="button" onclick="markReviewed\(\)\.catch\(showUnexpectedError\)">Mark as reviewed<\/button>/);
  const js = read('frontend/js/editor.js');
  assert.match(js, /if \(isBotanistUser \|\| !editingId\) return;/);
  assert.match(js, /api\('\/knowledge\/species\/' \+ editingId \+ '\/draft-status'\)/);
  assert.match(js, /api\('\/knowledge\/species\/' \+ editingId \+ '\/mark-reviewed', \{ method: 'POST' \}\)/);
  for (const id of ['draft-note', 'mark-reviewed-button']) assert.match(html, new RegExp(`id="${id}"`));
  // Visitors and the app show the description normally: no draft wording anywhere else.
  for (const file of ['backend/src/routes/publicPlants.js', 'niah-biotrack/app/plant-info.tsx', 'niah-biotrack/app/species-reference/[id].tsx', 'frontend/js/species.js']) {
    assert.doesNotMatch(read(file), /description_is_draft|Draft description/, file);
  }
});
