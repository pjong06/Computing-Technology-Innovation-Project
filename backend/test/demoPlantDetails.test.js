'use strict';

// Demo plant details (scripts/demo-plant-details): EMPTY fields only, plausible values per
// growth form, every generated value flagged, and a removal that takes out exactly those.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const load = (file) => import(pathToFileURL(path.join(repoRoot, file)).href);
const NOW = Date.parse('2026-11-21T08:00:00Z');

const plant = (id, extra = {}) => ({
  id, qr_code_value: `NIAH-PLT-${id.padStart(5, '0').slice(-5)}`, registered_by: 'u1',
  registered_at: '2026-09-01T00:00:00Z', species_id: 's-tree',
  location_description: null, morphology: null, description: null, ...extra,
});
const SPECIES = new Map([
  ['s-tree', { scientific_name: 'Shorea', family: 'Dipterocarpaceae' }],
  ['s-herb', { scientific_name: 'Begonia niahensis', family: 'Begoniaceae' }],
  ['s-fern', { scientific_name: 'Asplenium nidus', family: 'Aspleniaceae' }],
  ['s-orchid', { scientific_name: 'Dendrobium crumenatum', family: 'Orchidaceae' }],
  ['s-climber', { scientific_name: 'Rhaphidophora korthalsii', family: 'Araceae' }],
  ['s-palm', { scientific_name: 'Caryota no', family: 'Arecaceae' }],
  ['s-moss', { scientific_name: 'Leucobryum javense', family: 'Leucobryaceae' }],
]);

test('fill: only EMPTY fields; anything a botanist entered is kept', async () => {
  const { planFill } = await load('scripts/demo-plant-details/lib.mjs');
  const plants = [
    plant('1', { location_description: 'By the big rock', morphology: '  ', description: '' }),
    plant('2', { morphology: 'Botanist text', description: 'Botanist note' }),
  ];
  const observations = new Map([
    ['1', [{ height_cm: 1500, diameter_cm: null, health_status: null, life_stage: 'mature', observed_at: '2026-11-10T00:00:00Z' }]],
    ['2', [{ height_cm: 900, diameter_cm: 30, health_status: 'healthy', life_stage: 'mature', observed_at: '2026-11-10T00:00:00Z' }]],
  ]);
  const [one, two] = planFill(plants, observations, SPECIES, { now: NOW });
  // Plant 1: empty / blank text filled; the location note is kept.
  assert.deepEqual(Object.keys(one.plantValues).sort(), ['description', 'morphology']);
  // Only the observation fields that none of its observations has.
  assert.deepEqual(Object.keys(one.observation).filter((k) => ['height_cm', 'diameter_cm', 'health_status', 'life_stage'].includes(k)).sort(),
    ['diameter_cm', 'health_status']);
  // A recorded "mature" tree gets a mature tree's diameter, not a sapling's.
  assert.ok(one.observation.diameter_cm >= 12, `diameter ${one.observation.diameter_cm}`);
  // Plant 2: only its empty location note; everything else was recorded, so no demo observation.
  assert.deepEqual(Object.keys(two.plantValues), ['location_description']);
  assert.equal(two.observation, null);
});

test('fill: every generated record is flagged, approved (never in the Review queue) and dated before today', async () => {
  const { planFill, reportRows } = await load('scripts/demo-plant-details/lib.mjs');
  const latestVisit = '2026-11-15T09:00:00Z';
  const [plan] = planFill([plant('3')], new Map([['3', [{ observed_at: latestVisit }]]]), SPECIES, { now: NOW });
  assert.equal(plan.observation.is_demo, true);
  assert.equal(plan.observation.review_status, 'approved');
  assert.equal(plan.observation.plant_id, '3');
  assert.equal(plan.observation.observer_id, 'u1');
  const at = Date.parse(plan.observation.observed_at);
  assert.ok(at > Date.parse(latestVisit), 'after the newest real observation');
  assert.ok(at < Date.parse('2026-11-21T00:00:00Z'), 'before today');
  // Same plant, same values (so the report matches what --apply writes).
  assert.deepEqual(planFill([plant('3')], new Map(), SPECIES, { now: NOW })[0].plantValues, plan.plantValues);
  // A plant with no botanist: observation fields are listed, not created, unless --observer.
  const orphan = planFill([plant('4', { registered_by: null })], new Map(), SPECIES, { now: NOW })[0];
  assert.equal(orphan.observation, null);
  assert.ok(reportRows([orphan], 'x').some((row) => /skipped: plant has no botanist/.test(row.action)));
  const withObserver = planFill([plant('4', { registered_by: null })], new Map(), SPECIES, { now: NOW, observerId: 'officer-1' })[0];
  assert.equal(withObserver.observation.observer_id, 'officer-1');

  // The flags: plants.demo_values records the generated plant values; the observation is_demo.
  const fill = read('scripts/demo-plant-details/fill.mjs');
  assert.match(fill, /demo_values: \{ \.\.\.\(current\?\.demo_values \?\? \{\}\), \.\.\.plan\.plantValues \}/);
  assert.match(fill, /const stillEmpty = fields\.map\(\(field\) => `\$\{field\}=is\.null`\)\.join\('&'\);/);
  // The Review queue lists only field records waiting for review, so approved demo records never appear.
  assert.match(read('backend/src/routes/officerReviews.js'), /\.eq\("review_status", "pending"\)/);
});

test('fill: plausible values for each growth form; no credit or source text', async () => {
  const { planFill, growthForm, GROWTH_FORMS } = await load('scripts/demo-plant-details/lib.mjs');
  const forms = { 's-tree': 'tree', 's-herb': 'herb', 's-fern': 'fern', 's-orchid': 'epiphyte', 's-climber': 'climber', 's-palm': 'palm', 's-moss': 'moss' };
  for (const [speciesId, form] of Object.entries(forms)) {
    const species = SPECIES.get(speciesId);
    assert.equal(growthForm(species.scientific_name, species.family), form, species.scientific_name);
    const plans = planFill(Array.from({ length: 150 }, (_, i) => plant(`${speciesId}-${i}`, { species_id: speciesId })), new Map(), SPECIES, { now: NOW });
    const { height, diameter } = GROWTH_FORMS[form];
    const health = { healthy: 0, other: 0 };
    const stages = {};
    for (const { observation, plantValues } of plans) {
      const metres = observation.height_cm / 100;
      assert.ok(metres <= height[1] + 1e-9 && metres >= 0.01, `${form} height ${metres} m`);
      const young = ['seedling', 'sapling'].includes(observation.life_stage);
      if (!young) assert.ok(metres >= height[0] - 1e-9, `${form} mature height ${metres} m`);
      if (diameter) {
        assert.ok(observation.diameter_cm > 0 && observation.diameter_cm <= diameter[1] + 1e-9, `${form} diameter ${observation.diameter_cm}`);
        if (!young) assert.ok(observation.diameter_cm >= diameter[0] - 0.05, `${form} mature diameter ${observation.diameter_cm}`);
      } else {
        assert.equal(observation.diameter_cm, undefined, 'mosses get no diameter');
      }
      health[observation.health_status === 'healthy' ? 'healthy' : 'other'] += 1;
      stages[observation.life_stage] = (stages[observation.life_stage] ?? 0) + 1;
      assert.ok(['healthy', 'stressed', 'damaged'].includes(observation.health_status));
      assert.ok(['seedling', 'sapling', 'mature', 'flowering', 'fruiting'].includes(observation.life_stage));
      if (form === 'fern' || form === 'moss') assert.ok(!['flowering', 'fruiting'].includes(observation.life_stage), 'no flowers on ferns or mosses');
      for (const text of [...Object.values(plantValues), observation.notes]) {
        assert.equal(typeof text, 'string');
        assert.doesNotMatch(text, /photo by|photo:|source:|via |https?:|inaturalist|demo|\(c\)|©/i, text);
      }
      assert.match(plantValues.location_description, /, Zone [A-F]$/);
    }
    // Mostly healthy and mostly mature, with some variety.
    assert.ok(health.healthy / plans.length > 0.65 && health.other > 0, `${form} health mix ${JSON.stringify(health)}`);
    assert.ok(stages.mature / plans.length > 0.5 && Object.keys(stages).length > 1, `${form} stages ${JSON.stringify(stages)}`);
  }
  // Trees are taller and thicker than herbs, ferns, epiphytes and climbers.
  assert.ok(GROWTH_FORMS.tree.height[0] > GROWTH_FORMS.herb.height[1]);
  assert.ok(GROWTH_FORMS.tree.diameter[0] > GROWTH_FORMS.climber.diameter[1]);
});

test('removal: exactly the generated values and demo observations, nothing else', async () => {
  const { planRemoval } = await load('scripts/demo-plant-details/lib.mjs');
  const { removalRows, parseArguments } = await load('scripts/demo-plant-details/remove.mjs');
  const plan = planRemoval(
    [
      { id: 'p1', morphology: 'Generated', description: 'Changed later by a botanist', location_description: 'Botanist place',
        demo_values: { morphology: 'Generated', description: 'Generated note' } },
      { id: 'p2', morphology: 'Real', demo_values: null },
    ],
    [{ id: 'o1', is_demo: true }, { id: 'o2', is_demo: false }, { id: 'o3' }]
  );
  assert.deepEqual(plan.observationIds, ['o1']);
  assert.equal(plan.plantResets.length, 1);
  assert.deepEqual(plan.plantResets[0].reset, { morphology: null });
  assert.deepEqual(Object.keys(plan.plantResets[0].kept), ['description']);
  const rows = removalRows(plan, 'will remove (dry run)');
  assert.ok(rows.some((row) => row.kind === 'demo observation' && row.id === 'o1'));
  assert.ok(rows.some((row) => row.field === 'description' && /kept: changed/.test(row.action)));
  assert.ok(!rows.some((row) => row.id === 'p2' || row.id === 'o2' || row.field === 'location_description'));
  assert.equal(parseArguments([]).apply, false);

  const remove = read('scripts/demo-plant-details/remove.mjs');
  // Deletes only demo observations, and only resets a field still holding the generated value.
  assert.match(remove, /`observations\?id=eq\.\$\{id\}&is_demo=is\.true`, \{ method: 'DELETE'/);
  assert.match(remove, /`plants\?id=eq\.\$\{plant\.id\}&\$\{field\}=eq\.\$\{encodeURIComponent\(plant\.demo_values\[field\]\)\}`/);
  assert.doesNotMatch(remove, /rest\(`plants[^`]*`, \{ method: 'DELETE'/);
});

test('scripts and migration: dry run by default, key from the environment only, git-ignored reports, hidden flags', async () => {
  const { parseArguments } = await load('scripts/demo-plant-details/fill.mjs');
  assert.equal(parseArguments([]).apply, false);
  assert.throws(() => parseArguments(['--observer', 'nope']), /UUID/);
  for (const file of ['fill.mjs', 'remove.mjs', 'supabase.mjs']) {
    const code = read(`scripts/demo-plant-details/${file}`).split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
    assert.doesNotMatch(code, /dotenv|\.env['"]|readFileSync/, file);
  }
  assert.match(read('scripts/demo-plant-details/supabase.mjs'), /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(read('.gitignore'), /scripts\/demo-plant-details\/\*\.csv/);
  const sql = read('supabase/migrations/20261121200000_demo_plant_details.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS demo_values jsonb;/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;/);
  assert.doesNotMatch(sql, /POLICY|ROW LEVEL SECURITY|TO (anon|authenticated|public)\b/i);
  // The flags are never sent to the screens.
  for (const file of ['backend/src/routes/plants.js', 'backend/src/routes/officerPlants.js', 'backend/src/routes/officerReviews.js',
    'frontend/js/plant.js', 'niah-biotrack/app/plant-detail.tsx']) {
    assert.doesNotMatch(read(file), /demo_values|is_demo|isDemo/, file);
  }
});
