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
  ['s-liverwort', { scientific_name: 'Cyathodium', family: null }],
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

  // The flags: plants.demo_values records the generated plant values (on top of an earlier
  // run's), and the PATCH only applies while those fields are still empty.
  const { plantUpdate } = await load('scripts/demo-plant-details/lib.mjs');
  const update = plantUpdate(plan, { morphology: 'from an earlier run' });
  assert.deepEqual(update.body.demo_values, { morphology: 'from an earlier run', ...plan.plantValues, coordinates: plan.coordinates });
  for (const field of Object.keys(plan.plantValues)) assert.ok(update.filters.includes(`${field}=is.null`), field);
  assert.match(read('scripts/demo-plant-details/fill.mjs'), /const \{ filters, body \} = plantUpdate\(plan, current\?\.demo_values\);/);
  // The Review queue lists only field records waiting for review, so approved demo records never appear.
  assert.match(read('backend/src/routes/officerReviews.js'), /\.eq\("review_status", "pending"\)/);
});

test('fill: plausible values for each growth form; no credit or source text', async () => {
  const { planFill, growthForm, GROWTH_FORMS } = await load('scripts/demo-plant-details/lib.mjs');
  const forms = { 's-tree': 'tree', 's-herb': 'herb', 's-fern': 'fern', 's-orchid': 'epiphyte', 's-climber': 'climber', 's-palm': 'palm', 's-moss': 'moss', 's-liverwort': 'liverwort' };
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
      assert.ok(observation.diameter_cm > 0 && observation.diameter_cm <= diameter[1] + 1e-9, `${form} diameter ${observation.diameter_cm}`);
      if (!young) assert.ok(observation.diameter_cm >= diameter[0] - 0.05, `${form} mature diameter ${observation.diameter_cm}`);
      // Mosses and liverworts: the clump or cushion width, 2-15 cm (a young patch 2-5 cm).
      if (form === 'moss' || form === 'liverwort') {
        assert.ok(observation.diameter_cm >= 2 && observation.diameter_cm <= (young ? 5 : 15), `${form} clump width ${observation.diameter_cm}`);
      }
      health[observation.health_status === 'healthy' ? 'healthy' : 'other'] += 1;
      stages[observation.life_stage] = (stages[observation.life_stage] ?? 0) + 1;
      assert.ok(['healthy', 'stressed', 'damaged'].includes(observation.health_status));
      assert.ok(['seedling', 'sapling', 'mature', 'flowering', 'fruiting'].includes(observation.life_stage));
      if (['fern', 'moss', 'liverwort'].includes(form)) assert.ok(!['flowering', 'fruiting'].includes(observation.life_stage), 'no flowers on ferns or mosses');
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

test('mosses and liverworts: a clump width comes in ONE new demo observation a day after the earlier one; existing ones are never changed', async () => {
  const { planFill, plantUpdate, reportRows, missingAfterFill, planRemoval, followUpObservedAt } = await load('scripts/demo-plant-details/lib.mjs');
  // A moss filled by an earlier run: its demo observation has everything except the diameter.
  const earlier = { id: 'demo-1', plant_id: 'm1', observer_id: 'u-earlier', is_demo: true, review_status: 'approved',
    observed_at: '2026-11-12T10:00:00Z', height_cm: 3, diameter_cm: null, health_status: 'stressed', life_stage: 'mature' };
  const real = { id: 'real-1', plant_id: 'm1', observer_id: 'u1', is_demo: false, review_status: 'approved', observed_at: '2026-11-01T00:00:00Z',
    height_cm: null, diameter_cm: null, health_status: null, life_stage: null };
  const [plan] = planFill([plant('m1', { species_id: 's-moss', latitude: 3.81, longitude: 113.78,
    location_description: 'x', morphology: 'x', description: 'x' })], new Map([['m1', [earlier, real]]]), SPECIES, { now: NOW });
  // One new approved demo observation: the earlier one's height, health and life stage, plus the clump width.
  const { observation } = plan;
  assert.equal(observation.is_demo, true);
  assert.equal(observation.review_status, 'approved');
  assert.equal(observation.height_cm, 3);
  assert.equal(observation.health_status, 'stressed');
  assert.equal(observation.life_stage, 'mature');
  assert.ok(observation.diameter_cm >= 2 && observation.diameter_cm <= 15, `clump width ${observation.diameter_cm}`);
  assert.equal(observation.observer_id, 'u-earlier', 'recorded under the same observer as the earlier demo observation');
  // Dated one day after the earlier demo observation, so it is the newest, and before today.
  assert.equal(observation.observed_at, '2026-11-13T10:00:00.000Z');
  assert.ok(Date.parse(observation.observed_at) < Date.parse('2026-11-21T00:00:00Z'));
  // Earlier demo observation from yesterday: one day later would be today, so it lands halfway instead.
  const late = followUpObservedAt('2026-11-20T12:00:00Z', NOW);
  assert.ok(late > '2026-11-20T12:00:00Z' && late < '2026-11-21T00:00:00Z', late);
  // Nothing on the plant row; the report says which values are repeated and which are new.
  assert.equal(plantUpdate(plan, null), null);
  const rows = reportRows([plan], 'x');
  assert.equal(rows.find((row) => row.field === 'diameter_cm').where, 'demo observation');
  assert.equal(rows.find((row) => row.field === 'health_status').where, 'demo observation (repeated from the earlier demo observation)');
  assert.deepEqual(missingAfterFill(plan, [earlier, real]), []);
  // No botanist needed: the earlier demo observation's observer is used.
  const [orphanMoss] = planFill([plant('m1', { species_id: 's-moss', registered_by: null })], new Map([['m1', [earlier]]]), SPECIES, { now: NOW });
  assert.equal(orphanMoss.skippedObservation, null);
  assert.equal(orphanMoss.observation.observer_id, 'u-earlier');
  // Existing observations are never updated or deleted by fill.mjs (approved ones are officer-only).
  const fill = read('scripts/demo-plant-details/fill.mjs');
  assert.doesNotMatch(fill, /rest\(`observations\?[^`]*`, \{\s*method: '(PATCH|DELETE)'/);
  assert.match(fill, /observer_id,observed_at,review_status,is_demo,/);
  assert.doesNotMatch(read('supabase/migrations/20261121220000_demo_plant_coordinates.sql'), /ON TABLE public\.observations/);
  // Undo: remove.mjs deletes every demo observation, the earlier and the new one; the real one stays.
  assert.deepEqual(planRemoval([], [earlier, { ...observation, id: 'demo-2' }, real]).observationIds, ['demo-1', 'demo-2']);
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

const IN_PARK = ({ latitude, longitude }) => latitude >= 3.80 && latitude <= 3.83 && longitude >= 113.76 && longitude <= 113.80;

test('coordinates: only plants with NO location get a demo point; real coordinates are never moved', async () => {
  const { planFill, plantUpdate, reportRows } = await load('scripts/demo-plant-details/lib.mjs');
  const real = plant('10', { latitude: 3.817612, longitude: 113.781045, gps_accuracy_m: 4 });
  const missing = plant('11', { latitude: null, longitude: null, gps_accuracy_m: null });
  const [keep, fill] = planFill([real, missing], new Map(), SPECIES, { now: NOW });
  assert.equal(keep.coordinates, null);
  assert.ok(!reportRows([keep], 'x').some((row) => row.field === 'coordinates' || row.field === 'gps_accuracy_m'));
  assert.ok(!('location' in (plantUpdate(keep, null)?.body ?? {})), 'no location written for a plant that has one');

  assert.ok(IN_PARK(fill.coordinates), JSON.stringify(fill.coordinates));
  assert.ok(fill.coordinates.gps_accuracy_m >= 8 && fill.coordinates.gps_accuracy_m <= 15);
  // Written to plants.location (EWKT, longitude first) only while it is still empty, and flagged.
  const { filters, body } = plantUpdate(fill, null);
  assert.equal(body.location, `SRID=4326;POINT(${fill.coordinates.longitude} ${fill.coordinates.latitude})`);
  assert.equal(body.gps_accuracy_m, fill.coordinates.gps_accuracy_m);
  assert.ok(filters.includes('location=is.null') && filters.includes('gps_accuracy_m=is.null'));
  assert.deepEqual(body.demo_values.coordinates, fill.coordinates);
  assert.ok(reportRows([fill], 'x').some((row) => row.field === 'coordinates' && row.new === `${fill.coordinates.latitude}, ${fill.coordinates.longitude}`));
  // An accuracy someone already recorded is kept: only the point is written.
  const [withAccuracy] = planFill([plant('12', { gps_accuracy_m: 6 })], new Map(), SPECIES, { now: NOW });
  assert.equal(withAccuracy.coordinates.gps_accuracy_m, undefined);
  assert.ok(!('gps_accuracy_m' in plantUpdate(withAccuracy, null).body));
  // Same plant, same point (the dry run matches --apply).
  assert.deepEqual(planFill([real, missing], new Map(), SPECIES, { now: NOW })[1].coordinates, fill.coordinates);
});

test('coordinates: inside the park, in the zone the location note names, spread out', async () => {
  const { planFill, ZONE_AREAS, MIN_SPACING_M, distanceM } = await load('scripts/demo-plant-details/lib.mjs');
  const plants = Array.from({ length: 300 }, (_, i) => plant(`z-${i}`, {
    location_description: i % 3 === 0 ? 'By the big rock' : `Shaded gully below the plank walk, Zone ${'ABCDEF'[i % 6]}`,
  }));
  // A real plant in Zone A that demo points must keep clear of.
  plants.push(plant('real', { latitude: 3.825, longitude: 113.765 }));
  const plans = planFill(plants, new Map(), SPECIES, { now: NOW });
  const placed = plans.filter((plan) => plan.coordinates);
  assert.equal(placed.length, 300);
  for (const plan of placed) {
    assert.ok(IN_PARK(plan.coordinates), JSON.stringify(plan.coordinates));
    const zone = /Zone ([A-F])$/.exec(plan.plant.location_description)?.[1];
    if (zone) {
      const area = ZONE_AREAS[zone];
      const { latitude, longitude } = plan.coordinates;
      assert.ok(latitude >= area.south && latitude <= area.north && longitude >= area.west && longitude <= area.east, `Zone ${zone}`);
    }
  }
  // Zone A is the north-west part, Zone F the south-east part.
  assert.ok(ZONE_AREAS.A.north > ZONE_AREAS.F.north && ZONE_AREAS.A.west < ZONE_AREAS.F.west);
  const all = [...placed.map((plan) => plan.coordinates), { latitude: 3.825, longitude: 113.765 }];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      assert.ok(distanceM(all[i], all[j]) >= MIN_SPACING_M, `points ${i} and ${j} are ${distanceM(all[i], all[j]).toFixed(1)} m apart`);
    }
  }
  // A plant whose note is generated gets the zone of that note.
  const [generatedNote] = planFill([plant('g1')], new Map(), SPECIES, { now: NOW });
  const area = ZONE_AREAS[/Zone ([A-F])$/.exec(generatedNote.plantValues.location_description)[1]];
  assert.ok(generatedNote.coordinates.latitude >= area.south && generatedNote.coordinates.latitude <= area.north);
  assert.ok(generatedNote.coordinates.longitude >= area.west && generatedNote.coordinates.longitude <= area.east);
});

test('check: lists each detail a plant would still miss after the fill, and why', async () => {
  const { planFill, missingAfterFill, missingRows } = await load('scripts/demo-plant-details/lib.mjs');
  // Complete after the fill: generated plant fields, coordinates and an approved demo observation.
  const [complete] = planFill([plant('c1')], new Map(), SPECIES, { now: NOW });
  assert.deepEqual(missingAfterFill(complete, []), []);
  // No botanist: the observation fields are listed with the --observer hint.
  const [orphan] = planFill([plant('c2', { registered_by: null })], new Map(), SPECIES, { now: NOW });
  const orphanGaps = missingAfterFill(orphan, []);
  assert.deepEqual(orphanGaps.map((gap) => gap.field).sort(), ['diameter_cm', 'health_status', 'height_cm', 'life_stage']);
  assert.ok(orphanGaps.every((gap) => /--observer/.test(gap.reason)));
  // Recorded only on a pending observation: no demo value is added, and the check says why.
  const pending = [{ height_cm: 300, diameter_cm: 10, health_status: 'healthy', life_stage: 'mature', review_status: 'pending', observed_at: '2026-11-10T00:00:00Z' }];
  const [unapproved] = planFill([plant('c3')], new Map([['c3', pending]]), SPECIES, { now: NOW });
  assert.equal(unapproved.observation, null);
  const gaps = missingAfterFill(unapproved, pending);
  assert.equal(gaps.length, 4);
  assert.ok(gaps.every((gap) => /not approved yet/.test(gap.reason)));
  // An approved observation counts.
  const approved = pending.map((visit) => ({ ...visit, review_status: 'approved' }));
  assert.deepEqual(missingAfterFill(planFill([plant('c4')], new Map([['c4', approved]]), SPECIES, { now: NOW })[0], approved), []);
  // Mosses and liverworts get a clump width as diameter, so nothing is missing.
  for (const speciesId of ['s-moss', 's-liverwort']) {
    const [clump] = planFill([plant(`c5-${speciesId}`, { species_id: speciesId })], new Map(), SPECIES, { now: NOW });
    assert.deepEqual(missingAfterFill(clump, []), [], speciesId);
  }
  const rows = missingRows([orphan], new Map());
  assert.ok(rows.some((row) => row.action === 'still missing diameter: plant has no botanist to record the demo observation under (use --observer <profile id>)'));
  assert.match(read('scripts/demo-plant-details/fill.mjs'), /missingRows\(plans, observationsByPlant\)/);
});

test('removal: demo coordinates go back to empty; a plant moved since keeps its location', async () => {
  const { planRemoval } = await load('scripts/demo-plant-details/lib.mjs');
  const { removalRows } = await load('scripts/demo-plant-details/remove.mjs');
  const point = { latitude: 3.812345, longitude: 113.778901, gps_accuracy_m: 11 };
  const plan = planRemoval([
    { id: 'p1', latitude: 3.812345, longitude: 113.778901, gps_accuracy_m: 11, demo_values: { coordinates: point } },
    { id: 'p2', latitude: 3.815, longitude: 113.77, gps_accuracy_m: 5, demo_values: { coordinates: point } },
    { id: 'p3', latitude: 3.812345, longitude: 113.778901, gps_accuracy_m: 4, demo_values: { coordinates: point } },
    { id: 'p4', latitude: 3.82, longitude: 113.79, gps_accuracy_m: 3, demo_values: { morphology: 'Generated' }, morphology: 'Generated' },
  ], []);
  const [restored, moved, newAccuracy, untouched] = plan.plantResets;
  assert.deepEqual(restored.reset, { location: null, gps_accuracy_m: null });
  assert.deepEqual(moved.reset, {});
  assert.deepEqual(Object.keys(moved.kept), ['location']);
  assert.deepEqual(newAccuracy.reset, { location: null });
  assert.deepEqual(newAccuracy.kept, { gps_accuracy_m: 4 });
  // A plant whose coordinates were never generated keeps them.
  assert.deepEqual(untouched.reset, { morphology: null });
  const rows = removalRows(plan, 'will remove (dry run)');
  assert.ok(rows.some((row) => row.id === 'p1' && row.field === 'location' && row.value === '3.812345, 113.778901'));
  assert.ok(rows.some((row) => row.id === 'p2' && row.field === 'location' && /kept: changed/.test(row.action)));
  assert.ok(!rows.some((row) => row.id === 'p4' && row.field === 'location'));

  const remove = read('scripts/demo-plant-details/remove.mjs');
  // The point is checked again right before it is emptied; the accuracy only while it is still the generated one.
  assert.match(remove, /if \(now && samePoint\(now, generated\)\)/);
  assert.match(remove, /gps_accuracy_m=eq\.\$\{generated\.gps_accuracy_m\}/);
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
  const coordinatesSql = read('supabase/migrations/20261121220000_demo_plant_coordinates.sql');
  assert.match(coordinatesSql, /GRANT UPDATE \(location, gps_accuracy_m\)\s+ON TABLE public\.plants TO service_role;/);
  assert.doesNotMatch(coordinatesSql, /POLICY|ROW LEVEL SECURITY|TO (anon|authenticated|public)\b/i);
  // The flags are never sent to the screens.
  for (const file of ['backend/src/routes/plants.js', 'backend/src/routes/officerPlants.js', 'backend/src/routes/officerReviews.js',
    'frontend/js/plant.js', 'niah-biotrack/app/plant-detail.tsx']) {
    assert.doesNotMatch(read(file), /demo_values|is_demo|isDemo/, file);
  }
});
