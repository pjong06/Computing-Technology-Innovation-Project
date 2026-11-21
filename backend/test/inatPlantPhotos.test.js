'use strict';

// Imported iNaturalist plants get their own sighting photo
// (scripts/inat-plant-photos/attach-photos.mjs). Checks the matching and licence rules,
// the migration, and that no page or app screen shows a photo credit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const loadLib = () => import(pathToFileURL(path.join(repoRoot, 'scripts/inat-plant-photos/lib.mjs')).href);

let db;
mockAuth(() => ({ userId: 'user-1', role: 'officer', db }));
const plantRouter = require('../src/routes/plants');

// ---- matching ----

const sighting = (id, name, lat, lon, extra = {}) => ({
  id, url: `https://www.inaturalist.org/observations/${id}`, imageUrl: '', scientificName: name,
  latitude: lat, longitude: lon, privateLatitude: null, privateLongitude: null, ...extra,
});
const plant = (id, extra = {}) => ({ id, tag: `NIAH-PLT-0000${id}`, scientificName: '', sourceUrl: '', latitude: null, longitude: null, ...extra });

test('observation ids come from a URL or a bare id, nothing else', async () => {
  const { observationIdFrom } = await loadLib();
  assert.equal(observationIdFrom('https://www.inaturalist.org/observations/9919151'), '9919151');
  assert.equal(observationIdFrom('inaturalist.org/observations/42?tab=ids'), '42');
  assert.equal(observationIdFrom(' 21101792 '), '21101792');
  for (const value of ['', null, 'https://example.org/observations/1', 'https://www.inaturalist.org/photos/5', 'abc']) {
    assert.equal(observationIdFrom(value), null, String(value));
  }
});

test('source_url wins; otherwise same species (any case) within 2 m', async () => {
  const { matchPlants } = await loadLib();
  const sightings = [
    sighting('100', 'Nepenthes ampullaria', 3.8, 113.7),
    sighting('200', 'Begonia niahensis', 3.81, 113.71),
  ];
  const plants = [
    plant('1', { sourceUrl: 'https://www.inaturalist.org/observations/100', scientificName: 'Something else' }),
    plant('2', { scientificName: 'BEGONIA  NIAHENSIS', latitude: 3.81 + 0.00001, longitude: 113.71 }), // ~1.1 m
    plant('3', { scientificName: 'Begonia niahensis', latitude: 3.81 + 0.0001, longitude: 113.71 }), // ~11 m
    plant('4', { sourceUrl: '999' }),
  ];
  const [one, two, three, four] = matchPlants(plants, sightings);
  assert.equal(one.sighting.id, '100');
  assert.equal(one.method, 'source_url');
  assert.equal(two.sighting.id, '200');
  assert.equal(two.method, 'species + location');
  assert.equal(three.sighting, null);
  assert.match(three.reason, /already matched|within 2 m/);
  assert.equal(four.sighting.id, '999');
  assert.equal(four.method, 'source_url (not in CSV)');
});

test('a different species at the same spot, a tie, or a sighting already used is not matched', async () => {
  const { matchPlants } = await loadLib();
  const sightings = [
    sighting('1', 'Ficus a', 3.8, 113.7),
    sighting('2', 'Ficus b', 3.8, 113.7),
    sighting('3', 'Ficus b', 3.8, 113.7),
    sighting('4', 'Ficus c', 3.9, 113.9),
  ];
  const results = matchPlants([
    plant('1', { scientificName: 'Ficus z', latitude: 3.8, longitude: 113.7 }),
    plant('2', { scientificName: 'Ficus b', latitude: 3.8, longitude: 113.7 }),
    plant('3', { sourceUrl: '4' }),
    plant('4', { scientificName: 'Ficus c', latitude: 3.9, longitude: 113.9 }),
    plant('5', { scientificName: 'Ficus a' }),
  ], sightings);
  assert.equal(results[0].sighting, null);
  assert.match(results[1].reason, /^ambiguous: 2 sightings/);
  assert.equal(results[2].sighting.id, '4');
  assert.match(results[3].reason, /sighting 4 is already matched to plant NIAH-PLT-00003/);
  assert.match(results[4].reason, /no coordinates/);
});

test('private coordinates count too', async () => {
  const { matchPlants } = await loadLib();
  const [result] = matchPlants(
    [plant('1', { scientificName: 'Ficus a', latitude: 3.8, longitude: 113.7 })],
    [sighting('7', 'Ficus a', 3.9, 113.9, { privateLatitude: 3.8, privateLongitude: 113.7 })]
  );
  assert.equal(result.sighting.id, '7');
});

// ---- the photo and its licence ----

test('the CSV photo is used when it is on the observation, otherwise the first by position', async () => {
  const { choosePhoto } = await loadLib();
  const observation = {
    observation_photos: [
      { position: 1, photo: { id: 22, license_code: 'cc-by' } },
      { position: 0, photo: { id: 11, license_code: 'cc0' } },
    ],
  };
  assert.equal(choosePhoto(observation, 'https://static.inaturalist.org/photos/22/medium.jpg').photo.id, 22);
  assert.equal(choosePhoto(observation, 'https://static.inaturalist.org/photos/99/medium.jpg').photo.id, 11);
  assert.equal(choosePhoto({ photos: [{ id: 5 }] }, '').photo.id, 5);
  assert.match(choosePhoto(null, '').reason, /not found/);
  assert.match(choosePhoto({ photos: [] }, '').reason, /no photos/);
  assert.match(choosePhoto({ photos: [{ id: 5, hidden: true }] }, '').reason, /hidden or flagged/);
  assert.match(choosePhoto({ photos: [{ id: 5, flags: [{ resolved: false }] }] }, '').reason, /hidden or flagged/);
});

test("only the photo's own CC0, CC BY, CC BY-SA or CC BY-NC licence is allowed", async () => {
  const { licenceAllowed, photoLicence, ALLOWED_LICENCES } = await loadLib();
  assert.deepEqual([...ALLOWED_LICENCES].sort(), ['cc-by', 'cc-by-nc', 'cc-by-sa', 'cc0']);
  for (const code of ['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc']) assert.equal(licenceAllowed(code), true, code);
  for (const code of ['', 'cc-by-nd', 'cc-by-nc-sa', 'cc-by-nc-nd', 'all-rights-reserved']) {
    assert.equal(licenceAllowed(code), false, code);
  }
  assert.equal(photoLicence({ license_code: 'CC-BY-NC' }), 'cc-by-nc');
  assert.equal(photoLicence({ license_code: null }), '');
  // The script reads the licence from the photo, never from the CSV or the observation.
  const script = read('scripts/inat-plant-photos/attach-photos.mjs');
  assert.match(script, /row\.licence = photoLicence\(chosen\.photo\);/);
  assert.doesNotMatch(script, /row\.license\b|observation\.license_code/);
});

test('images come only from the two iNaturalist image hosts, biggest size first', async () => {
  const { imageUrlsFor } = await loadLib();
  assert.deepEqual(imageUrlsFor({ url: 'https://static.inaturalist.org/photos/1/square.jpg' }), [
    'https://static.inaturalist.org/photos/1/large.jpg',
    'https://static.inaturalist.org/photos/1/medium.jpg',
  ]);
  assert.equal(imageUrlsFor({ url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/2/medium.jpeg' }).length, 2);
  for (const url of ['http://static.inaturalist.org/photos/1/square.jpg', 'https://evil.example/photos/1/square.jpg',
    'https://static.inaturalist.org:444/photos/1/square.jpg', 'not a url']) {
    assert.deepEqual(imageUrlsFor({ url }), [], url);
  }
});

test('the stored source fields name the photo, licence and photographer', async () => {
  const { sourceFields } = await loadLib();
  assert.deepEqual(
    sourceFields({ id: 32611912, license_code: 'cc-by-nc', attribution: '(c) Ivy, some rights reserved (CC BY-NC)' },
      { user: { name: '', login: 'ivyesra' } }),
    {
      source: 'inaturalist',
      source_photo_id: 32611912,
      source_url: 'https://www.inaturalist.org/photos/32611912',
      licence_code: 'cc-by-nc',
      attribution: '(c) Ivy, some rights reserved (CC BY-NC)',
      photographer: 'ivyesra',
    }
  );
});

test('the report ends with totals per action', async () => {
  const { reportRecords, totals } = await loadLib();
  const rows = [
    { action: 'attached', reason: 'main photo' },
    { action: 'skipped', reason: 'licence cc-by-nc-nd is not allowed' },
    { action: 'skipped', reason: 'no sighting of this species within 2 m' },
  ];
  assert.equal(totals(rows).skippedLicences.length, 1);
  assert.deepEqual(reportRecords(rows).slice(3), [
    { plant_id: 'TOTAL', action: 'attached', reason: '1' },
    { plant_id: 'TOTAL', action: 'skipped', reason: '2' },
    { plant_id: 'TOTAL', action: 'plants', reason: '3' },
  ]);
});

test('the script: dry run by default, key from the environment only, 1 request a second', () => {
  const script = read('scripts/inat-plant-photos/attach-photos.mjs');
  assert.match(script, /apply: false,/);
  assert.match(script, /if \(!options\.apply\) \{\s*row\.action = 'would attach';[\s\S]*?continue;\s*\}\s*try \{\s*Object\.assign\(row, await attach\(/);
  assert.match(script, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(script, /dotenv|\.env['"]|console\.log\([^)]*serviceRoleKey/);
  assert.match(script, /const MIN_GAP_MS = 1100;/);
  assert.match(script, /await waitForInatSlot\(\);\s*let response;/);
  assert.match(script, /await waitForInatSlot\(\);\s*const response = await fetch\(url/);
  assert.match(script, /resize\(MAX_SIDE_PX, MAX_SIDE_PX, \{ fit: 'inside'/);
  assert.match(script, /const MAX_SIDE_PX = 1600;/);
  assert.match(script, /const BUCKET = 'plant-media';/);
});

// ---- the migration ----

test('the migration adds the source fields to plant_media without touching RLS', () => {
  const sql = read('supabase/migrations/20261121120000_plant_media_inaturalist_source.sql');
  for (const column of ["source text NOT NULL DEFAULT 'field'", 'source_photo_id bigint', 'source_url text',
    'licence_code text', 'attribution text', 'photographer text', 'imported_at timestamptz']) {
    assert.ok(sql.includes(`ADD COLUMN IF NOT EXISTS ${column}`), column);
  }
  assert.match(sql, /CHECK \(source IN \('field', 'inaturalist'\)\)/);
  assert.match(sql, /licence_code IN \('cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc'\)/);
  assert.match(sql, /ON public\.plant_media \(plant_id, source, source_photo_id\)/);
  assert.doesNotMatch(sql, /POLICY|DISABLE ROW LEVEL SECURITY|TO (anon|authenticated|public)\b/i);
});

// ---- no credits shown anywhere ----

test('there is no photo credits endpoint or page, and plant photos never carry a credit', async () => {
  db = { from() { throw new Error('the database must not be read'); } };
  const result = await callRoute('/api/plants', plantRouter, { path: '/photo-credits' });
  assert.notEqual(result.status, 200);
  assert.doesNotMatch(read('backend/src/routes/plants.js'), /photo-credits|licence_code|photographer/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'frontend/credits.html')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'frontend/js/credits.js')), false);
  // Officer web: plant photo rows are read without source fields.
  const officer = read('backend/src/routes/officerPlants.js');
  assert.match(officer, /const PHOTO_COLUMNS = "id, plant_id, file_path, photo_type, is_primary";/);
  const publicPhoto = /function publicPhoto\(photo, urls\) \{[\s\S]*?\n\}/.exec(officer)[0];
  assert.doesNotMatch(publicPhoto, /licence|attribution|photographer|source/);
  // Visitor page: never reads plant_media.
  assert.doesNotMatch(read('backend/src/routes/publicPlants.js'), /plant_media/);
});
