// TC-APP-06 Record observation on a plant from the catalogue: linked to the plant's server
// id; only a plant that exists solely on this phone (not uploaded yet) holds it back.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkObservationPayload, observationParent, PLANT_NOT_FOUND } from './observationParent.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

const SERVER_PLANT = '33333333-3333-4333-8333-333333333333';
const OTHER_PHONE_ID = '44444444-4444-4444-8444-444444444444';

test('a plant the server returned (scanned or from the Plants list): linked by its server id', () => {
  // Registered by someone else (or on another phone): its id here is the other phone's
  // client id, which the server can't match to this botanist.
  assert.deepEqual(observationParent({ id: OTHER_PHONE_ID, serverId: SERVER_PLANT }), { plant_id: SERVER_PLANT });
  // Only on this phone, not uploaded yet: its phone id (the outbox waits for the plant).
  assert.deepEqual(observationParent({ id: OTHER_PHONE_ID, serverId: null }), { plant_client_record_id: OTHER_PHONE_ID });
  assert.deepEqual(observationParent({ id: OTHER_PHONE_ID }), { plant_client_record_id: OTHER_PHONE_ID });
});

test('a queued observation is relinked to the server id once the phone knows it', () => {
  const queued = { plant_client_record_id: OTHER_PHONE_ID, notes: 'New leaves', health_status: 'healthy' };
  assert.deepEqual(linkObservationPayload(queued, SERVER_PLANT), { notes: 'New leaves', health_status: 'healthy', plant_id: SERVER_PLANT });
  // Still not on the server: unchanged (it keeps waiting).
  assert.equal(linkObservationPayload(queued, null), null);
  assert.equal(linkObservationPayload(queued, 'plant:abc'), null);
  // Already linked: unchanged.
  assert.equal(linkObservationPayload({ plant_id: SERVER_PLANT }, SERVER_PLANT), null);
  assert.equal(linkObservationPayload(null, SERVER_PLANT), null);
});

test('the app sends observations with plant_id and relinks queued ones before every upload', () => {
  const repository = read('../services/offlineRecordRepository.ts');
  assert.match(repository, /\.\.\.observationParent\(record\),/);
  assert.doesNotMatch(repository, /: \{ plant_client_record_id: record\.id \}/);

  const database = read('../services/offlineDatabase.ts');
  const link = database.slice(database.indexOf('export async function linkQueuedObservationsToServerPlants'), database.indexOf('// ---- Sync details'));
  assert.match(link, /plant\.client_record_id = json_extract\(o\.payload_json, '\$\.plant_client_record_id'\)/);
  assert.match(link, /AND plant\.server_id IS NOT NULL/);
  // Ones refused before ("Parent plant has not been synced") are sent again.
  assert.match(link, /o\.status = 'failed' AND COALESCE\(o\.last_code, o\.last_error\) IN \('\$\{PLANT_NOT_FOUND\}', 'Parent plant has not been synced'\)/);
  assert.equal(PLANT_NOT_FOUND, 'plant_not_found');
  assert.match(link, /const relinked = linkObservationPayload\(payload, row\.plant_server_id\);/);
  // Only a plant solely on this phone holds an observation back (until it has uploaded).
  assert.match(database, /OR json_extract\(payload_json, '\$\.plant_client_record_id'\) IS NULL/);

  const engine = read('../services/syncEngine.ts');
  const push = engine.slice(engine.indexOf('async function runPush'), engine.indexOf('while (true)'));
  assert.match(push, /await linkQueuedObservationsToServerPlants\(\);/);
});
