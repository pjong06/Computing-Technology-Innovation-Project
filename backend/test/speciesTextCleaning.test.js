'use strict';

// Species text without leftover photo credits, sources or links: stored data
// (scripts/clean-species-text/clean.mjs) and every place it is shown (knowledge API, public
// QR API, visitor page).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { cleanSpeciesText, cleanSpeciesFields, SPECIES_TEXT_FIELDS } = require('../src/utils/speciesDescription');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('credit and source fragments are removed; spacing and full stops tidied', () => {
  const cases = [
    ['Identified to family level only. (photo by Niah National Park).', 'Identified to family level only.'],
    ['A climbing fern. Photo: J. Tan, CC BY via iNaturalist', 'A climbing fern.'],
    ['Leaves glossy, photo by A. Rahman.', 'Leaves glossy.'],
    ['See the leaves.  Source: https://example.org/x', 'See the leaves.'],
    ['A fern (Source: SFC, 2019) with long fronds.', 'A fern with long fronds.'],
    ['Tall tree with buttresses..  Bark grey.', 'Tall tree with buttresses. Bark grey.'],
    ['Leaves broad ( photographer: X ) and thick.', 'Leaves broad and thick.'],
    ['Common on limestone. Credit: Sarawak Forestry', 'Common on limestone.'],
    ['Habitat lowland forest , near rivers .', 'Habitat lowland forest, near rivers.'],
    ['Description here.\n\n\nPhoto: someone\nSecond paragraph https://x.y/z here.', 'Description here.\n\nSecond paragraph here.'],
    ['(c) 2020 Someone', ''],
    ['Growing on rock.\nSource: iNaturalist observation https://www.inaturalist.org/observations/1', 'Growing on rock.'],
  ];
  for (const [before, after] of cases) assert.equal(cleanSpeciesText(before), after, before);
});

test('normal text is left exactly as it is', () => {
  for (const text of [
    'Spreads via seeds and runners.',
    'Seeds dispersed by birds; source of food for hornbills.',
    'Photographs of the bark are useful. Flowers white (petals 5).',
    'Grows in shade (often on limestone).',
    'Identified to genus level; plants in this genus are climbers.',
    'Leaves 10–20 cm long, in two rows.\nFlowers yellow.',
    'A small tree of the Malvaceae family.',
    '',
  ]) {
    assert.equal(cleanSpeciesText(text), text, text);
  }
  for (const value of [null, undefined, 42]) assert.equal(cleanSpeciesText(value), value);
});

test('every shown species text field is cleaned in responses', () => {
  assert.deepEqual(SPECIES_TEXT_FIELDS, ['description', 'habitat', 'distribution_notes', 'morphology', 'cultural_significance']);
  const cleaned = cleanSpeciesFields({
    id: 'x', scientific_name: 'Begonia (photo by X)', description: 'A herb. (photo by X).',
    habitat: 'Limestone. Source: SFC', distribution_notes: 'Niah https://a.b', morphology: 'Fleshy.', cultural_significance: null,
  });
  assert.equal(cleaned.scientific_name, 'Begonia (photo by X)', 'names are not touched');
  assert.equal(cleaned.description, 'A herb.');
  assert.equal(cleaned.habitat, 'Limestone.');
  assert.equal(cleaned.distribution_notes, 'Niah');
  assert.equal(cleaned.cultural_significance, null);
  // The knowledge API (app + web), public QR API and visitor page all use it.
  assert.match(read('backend/src/routes/knowledge.js'), /const prepared = cleanSpeciesFields\(species\);/);
  assert.match(read('backend/src/middleware/publicQrProtection.js'), /SPECIES_TEXT_FIELDS\.includes\(key\)\s*\? cleanSpeciesText\(row\[key\] \?\? null\)/);
  assert.match(read('backend/src/routes/publicPlants.js'), /SPECIES_TEXT_FIELDS\.includes\(key\) \? cleanSpeciesText\(row\[key\]\) : row\[key\]/);
});

test('public QR data shows cleaned text', () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
  const { publicQrData } = require('../src/middleware/publicQrProtection');
  const data = publicQrData({ description: 'A palm. (photo by Niah National Park).', habitat: 'Swamps. Photo: X', conservation_status: 'EN' });
  assert.equal(data.description, 'A palm.');
  assert.equal(data.habitat, 'Swamps.');
});

test('clean script: dry run by default, key from the environment only, only changed fields, conditional writes', async () => {
  const script = await import(pathToFileURL(path.join(repoRoot, 'scripts/clean-species-text/clean.mjs')).href);
  assert.equal(script.parseArguments([]).apply, false);
  assert.equal(script.parseArguments(['--apply']).apply, true);
  assert.throws(() => script.parseArguments(['--yes']), /Unknown option/);
  assert.deepEqual(script.CLEAN_FIELDS, ['description', 'habitat', 'distribution_notes']);
  const rows = script.planCleaning([
    { id: 's1', scientific_name: 'Areca catechu', description: 'A palm. (photo by X).', habitat: 'Villages.', distribution_notes: null },
    { id: 's2', scientific_name: 'Ficus', description: 'Figs.', habitat: 'Photo: someone', distribution_notes: 'Common.' },
  ]);
  assert.deepEqual(rows.map((row) => [row.species, row.field, row.old, row.new]), [
    ['Areca catechu', 'description', 'A palm. (photo by X).', 'A palm.'],
    ['Ficus', 'habitat', 'Photo: someone', null],
  ]);
  assert.deepEqual(script.REPORT_COLUMNS.slice(0, 4), ['species', 'field', 'old', 'new']);
  assert.equal(script.unchanged('description', 'A b'), 'description=eq.A%20b');
  const source = read('scripts/clean-species-text/clean.mjs');
  const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  assert.match(code, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(code, /dotenv|\.env['"]|readFileSync/);
  assert.match(code, /if \(options\.apply\) \{/);
  assert.match(code, /`species\?id=eq\.\$\{row\.species_id\}&\$\{unchanged\(row\.field, row\.old\)\}&select=id`/);
  // The reports are git-ignored.
  assert.match(read('.gitignore'), /scripts\/clean-species-text\/\*\.csv/);
  const grant = read('supabase/migrations/20261121190000_service_role_clean_species_text.sql');
  assert.match(grant, /GRANT UPDATE \(description, habitat, distribution_notes\) ON TABLE public\.species TO service_role;/);
  assert.doesNotMatch(grant, /POLICY|TO (anon|authenticated|public)\b/i);
});
