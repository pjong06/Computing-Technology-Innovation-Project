// Tests for src/utils/plantDetails.ts ("This plant": phone values and server details) and
// its wiring. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detailsFromServer, navigableCoordinates, pickPlantDetails } from './plantDetails.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

const SERVER_RAW = {
  latitude: 3.8147, longitude: 113.7793, gps_accuracy_m: 4.5,
  location_note: 'Limestone slope, Zone B', morphology: 'Fleshy herb.', notes: 'Healthy clump.',
  latest_observation: { observed_at: '2026-11-10T00:00:00Z', height_m: 0.85, diameter_cm: 12.25, health_status: 'stressed', life_stage: 'mature' },
};

test('server details are read into the app\'s units', () => {
  assert.deepEqual(detailsFromServer(SERVER_RAW), {
    latitude: 3.8147, longitude: 113.7793, gpsAccuracyM: 4.5,
    locationNote: 'Limestone slope, Zone B', morphology: 'Fleshy herb.', notes: 'Healthy clump.',
    observedAt: '2026-11-10T00:00:00Z', heightCm: 85, diameterCm: 12.25, health: 'stressed', stage: 'mature',
  });
  assert.equal(detailsFromServer(null), null);
  // Half a coordinate pair is no location.
  assert.equal(detailsFromServer({ latitude: 3.8, longitude: null, gps_accuracy_m: 5 }).gpsAccuracyM, null);
});

test('someone else\'s plant: the server\'s values first, the phone\'s where the server has none', () => {
  const server = detailsFromServer(SERVER_RAW);
  const shown = pickPlantDetails(false, { locationNote: 'Location not here', heightCm: 40, health: null, stage: 'seedling' }, server);
  assert.equal(shown.locationNote, 'Limestone slope, Zone B');
  assert.equal(shown.heightCm, 85);
  assert.equal(shown.health, 'stressed');
  assert.equal(shown.latitude, 3.8147);
  // Empty on the server: the phone's value.
  const partial = pickPlantDetails(false, { morphology: 'Seen by me', heightCm: 40 }, { ...server, morphology: null, heightCm: null });
  assert.equal(partial.morphology, 'Seen by me');
  assert.equal(partial.heightCm, 40);
});

test('own plant: the phone\'s values first, falling back to the server when they are empty', () => {
  const server = detailsFromServer(SERVER_RAW);
  const shown = pickPlantDetails(true, { locationNote: 'By the big rock', heightCm: 120, health: '', diameterCm: null, latitude: 3.1, longitude: 113.1, gpsAccuracyM: 8 }, server);
  assert.equal(shown.locationNote, 'By the big rock');
  assert.equal(shown.heightCm, 120);
  // Empty on the phone (e.g. measured in a later approved observation, also one made by a script).
  assert.equal(shown.health, 'stressed');
  assert.equal(shown.diameterCm, 12.25);
  // Coordinates stay a pair from one source.
  assert.deepEqual([shown.latitude, shown.longitude, shown.gpsAccuracyM], [3.1, 113.1, 8]);
  const noPhoneLocation = pickPlantDetails(true, {}, server);
  assert.deepEqual([noPhoneLocation.latitude, noPhoneLocation.longitude, noPhoneLocation.gpsAccuracyM], [3.8147, 113.7793, 4.5]);
  // Nothing anywhere: all empty.
  assert.equal(pickPlantDetails(true, {}, null).heightCm, null);
});

test('navigate to plant: an approved plant with coordinates from the phone or the server', () => {
  assert.deepEqual(navigableCoordinates({ latitude: 3.1, longitude: 113.1 }), { latitude: 3.1, longitude: 113.1 });
  assert.deepEqual(navigableCoordinates({ serverDetails: detailsFromServer(SERVER_RAW) }), { latitude: 3.8147, longitude: 113.7793 });
  assert.equal(navigableCoordinates({ serverDetails: detailsFromServer({ location_note: 'x' }) }), null);
  assert.equal(navigableCoordinates({}), null);
});

test('wiring: tag lookup keeps the details; plant detail, the Plants list and navigation use them', () => {
  const lookup = read('../services/tagLookup.ts');
  assert.match(lookup, /const serverDetails = detailsFromServer\(data\.details\);/);
  assert.match(read('../services/approvedPlants.ts'), /details: detailsFromServer\(row\.details\),/);
  const detail = read('../../app/plant-detail.tsx');
  assert.match(detail, /const shown = pickPlantDetails\(\s*!matched\.otherBotanist,/);
  for (const label of ['Location note', 'Coordinates', 'Height (m)', 'Diameter (cm)', 'Health', 'Life stage']) {
    assert.ok(detail.includes(`label="${label}"`), label);
  }
  assert.match(read('../../app/navigate-plant.tsx'), /navigableCoordinates\(plant\)/);
  assert.match(read('../../app/(tabs)/records.tsx'), /plant\.details\?\.locationNote/);
});
