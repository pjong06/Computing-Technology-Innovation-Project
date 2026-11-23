'use strict';

// Species conservation status from the IUCN Red List via GBIF (scripts/species-status/).
// The pure rules: code mapping, the conflict rule, GBIF rank -> taxon_rank, match acceptance,
// the capitalisation check and the report; plus the migration and the script's safety.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const loadLib = () => import(pathToFileURL(path.join(repoRoot, 'scripts/species-status/lib.mjs')).href);

test('IUCN categories map to what we store; NE, NA or no result stay "Not assessed"', async () => {
  const { iucnToStored, storedCode, STORED_CODES } = await loadLib();
  assert.deepEqual(STORED_CODES, ['CR', 'EN', 'VU', 'NT', 'LC', 'DD']);
  // GBIF sends a code and/or a category name.
  assert.deepEqual(iucnToStored({ code: 'LC', category: 'LEAST_CONCERN' }), { iucn: 'LC', code: 'LC' });
  for (const [category, code] of [['NEAR_THREATENED', 'NT'], ['VULNERABLE', 'VU'], ['ENDANGERED', 'EN'],
    ['CRITICALLY_ENDANGERED', 'CR'], ['DATA_DEFICIENT', 'DD']]) {
    assert.deepEqual(iucnToStored({ category }), { iucn: code, code }, category);
  }
  assert.deepEqual(iucnToStored({ category: 'NOT_EVALUATED' }), { iucn: 'NE', code: null });
  assert.deepEqual(iucnToStored({ code: 'NA' }), { iucn: 'NA', code: null });
  assert.deepEqual(iucnToStored(null), { iucn: '', code: null });
  assert.deepEqual(iucnToStored({}), { iucn: '', code: null });
  // Real categories the portal can't show yet are reported, not stored.
  const extinct = iucnToStored({ category: 'EXTINCT_IN_THE_WILD' });
  assert.equal(extinct.iucn, 'EW');
  assert.equal(extinct.code, null);
  assert.match(extinct.note, /can't show yet/);

  // Our stored values: codes, older word values, empty.
  assert.equal(storedCode('lc'), 'LC');
  assert.equal(storedCode('Least Concern'), 'LC');
  assert.equal(storedCode('Critically Endangered'), 'CR');
  assert.equal(storedCode(''), null);
  assert.equal(storedCode(null), null);
  assert.equal(storedCode('NE'), null);
});

test('conflict rule: fill an empty status; never overwrite a different one unless asked', async () => {
  const { statusAction } = await loadLib();
  assert.deepEqual(statusAction(null, 'VU'), { action: 'set', apply: true });
  assert.deepEqual(statusAction('', 'VU'), { action: 'set', apply: true });
  assert.deepEqual(statusAction('VU', 'VU'), { action: 'unchanged', apply: false });
  assert.deepEqual(statusAction('Vulnerable', 'VU'), { action: 'unchanged', apply: false });
  // We have a status and IUCN differs: a conflict, kept...
  assert.deepEqual(statusAction('LC', 'EN'), { action: 'conflict', apply: false });
  // ...unless --overwrite-conflicts.
  assert.deepEqual(statusAction('LC', 'EN', { overwriteConflicts: true }), { action: 'conflict', apply: true });
  // IUCN has nothing we store: ours is never removed.
  assert.deepEqual(statusAction('LC', null), { action: 'unchanged', apply: false });
  assert.deepEqual(statusAction(null, null), { action: 'unchanged', apply: false });
});

test('GBIF rank -> taxon_rank; status only at species level or below', async () => {
  const { rankFromGbif, isSpeciesLevel } = await loadLib();
  for (const rank of ['SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM', 'species']) assert.equal(rankFromGbif(rank), 'species', rank);
  assert.equal(rankFromGbif('GENUS'), 'genus');
  assert.equal(rankFromGbif('FAMILY'), 'family');
  for (const rank of ['ORDER', 'KINGDOM', 'TRIBE', '', null]) assert.equal(rankFromGbif(rank), 'other', String(rank));
  assert.equal(isSpeciesLevel('VARIETY'), true);
  assert.equal(isSpeciesLevel('GENUS'), false);
});

test('only EXACT, or FUZZY with confidence 95 or more, is accepted', async () => {
  const { acceptMatch } = await loadLib();
  assert.equal(acceptMatch({ usageKey: 1, matchType: 'EXACT', confidence: 99 }).ok, true);
  assert.equal(acceptMatch({ usageKey: 1, matchType: 'FUZZY', confidence: 95 }).ok, true);
  assert.match(acceptMatch({ usageKey: 1, matchType: 'FUZZY', confidence: 94 }).reason, /below 95%/);
  assert.match(acceptMatch({ usageKey: 1, matchType: 'HIGHERRANK', rank: 'GENUS' }).reason, /higher rank \(GENUS\)/);
  assert.equal(acceptMatch({ matchType: 'NONE' }).ok, false);
  assert.equal(acceptMatch(null).ok, false);
});

test('names with the wrong capitals are reported', async () => {
  const { capitalisationProblem } = await loadLib();
  assert.equal(capitalisationProblem('Nepenthes ampullaria', 'Nepenthes ampullaria'), '');
  assert.equal(capitalisationProblem('Nepenthes ampullaria var. longicaudata'), '');
  assert.match(capitalisationProblem('nepenthes ampullaria'), /genus should start with a capital/);
  assert.match(capitalisationProblem('Nepenthes Ampullaria'), /species part should be lower case/);
  assert.match(capitalisationProblem('NEPENTHES ampullaria'), /genus should be lower case after its first letter/);
  assert.match(capitalisationProblem('Nepenthes ampullaria', 'Nepenthes Ampullaria'), /GBIF writes it "Nepenthes Ampullaria"/);
});

test('report rows: set, conflict, not matched, not species level; the source URL', async () => {
  const { reportRow, REPORT_COLUMNS } = await loadLib();
  const match = (rank, extra = {}) => ({ usageKey: 5288819, scientificName: 'Nepenthes ampullaria Jack', canonicalName: 'Nepenthes ampullaria', rank, matchType: 'EXACT', confidence: 98, ...extra });
  const species = { id: 's1', scientific_name: 'Nepenthes ampullaria', conservation_status: null, taxon_rank: 'species' };

  const set = reportRow(species, match('SPECIES'), { code: 'LC' });
  assert.equal(set.action, 'set');
  assert.equal(set.will_write, 'yes');
  assert.equal(set._status, 'LC');
  assert.equal(set.source_url, 'https://www.gbif.org/species/5288819');
  assert.equal(set.gbif_rank, 'SPECIES');
  assert.equal(set.rank_action, 'unchanged');

  const conflict = reportRow({ ...species, conservation_status: 'LC' }, match('SPECIES'), { code: 'EN' });
  assert.equal(conflict.action, 'conflict');
  assert.equal(conflict.will_write, 'no');
  assert.equal(conflict._status, undefined);
  assert.match(conflict.note, /--overwrite-conflicts/);
  assert.equal(reportRow({ ...species, conservation_status: 'LC' }, match('SPECIES'), { code: 'EN' }, { overwriteConflicts: true })._status, 'EN');

  const genus = reportRow({ ...species, scientific_name: 'Nepenthes' }, match('GENUS'), { code: 'LC' }, { fixRank: true });
  assert.equal(genus.action, 'not species level');
  assert.equal(genus._status, undefined);
  assert.equal(genus.gbif_taxon_rank, 'genus');
  assert.equal(genus.rank_action, 'fix');

  const fuzzy = reportRow(species, match('SPECIES', { matchType: 'FUZZY', confidence: 80 }), null);
  assert.equal(fuzzy.action, 'not matched');
  assert.match(fuzzy.note, /below 95%/);

  for (const column of ['species', 'gbif_name', 'gbif_rank', 'current_status', 'iucn_status', 'action', 'source_url']) {
    assert.ok(REPORT_COLUMNS.includes(column), column);
  }
});

test('script: dry run by default, key from the environment only, 1 request/second, cache, report git-ignored', () => {
  const script = read('scripts/species-status/check.mjs');
  assert.match(script, /apply: false,/);
  assert.match(script, /const MIN_GAP_MS = 1000;/);
  assert.match(script, /\/species\/match\?\$\{new URLSearchParams\(\{ name, kingdom: 'Plantae' \}\)\}/);
  assert.match(script, /iucnRedListCategory/);
  assert.match(script, /verification_status: 'neq\.archived'/);
  // Only the two allowed columns are ever written, and only with --apply / --fix-rank.
  assert.match(script, /if \(options\.apply && row\._status !== undefined\) changes\.conservation_status = row\._status;/);
  assert.match(script, /if \(options\.fixRank && row\.rank_action === 'fix'\) changes\.taxon_rank = row\.gbif_taxon_rank;/);
  assert.doesNotMatch(script, /readFileSync\([^)]*\.env/);
  // The key is read from the environment by the shared helper.
  assert.match(read('scripts/demo-plant-details/supabase.mjs'), /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  const ignore = read('.gitignore');
  assert.match(ignore, /^scripts\/species-status\/\*\.csv$/m);
  assert.match(ignore, /^scripts\/species-status\/\.cache\/$/m);
});

test('migration: the service role may update only conservation_status and taxon_rank', () => {
  const sql = read('supabase/migrations/20261122180000_service_role_species_status.sql');
  assert.match(sql, /GRANT UPDATE \(conservation_status, taxon_rank\) ON TABLE public\.species TO service_role;/);
  assert.doesNotMatch(sql, /GRANT (ALL|UPDATE ON)|CREATE POLICY|DROP POLICY|DISABLE ROW LEVEL SECURITY/);
});
