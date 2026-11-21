// Tests for src/utils/serverDeletes.ts: a plant deleted on the server leaves the phone.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeletedChange, serverDeletedPlants } from './serverDeletes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

const change = (entityId, action, payload = {}) => ({ entity_type: 'plants', entity_id: entityId, action, record_payload: payload });
const records = [
  { id: 'local-a', serverId: 'srv-a', observations: [{ id: 'visit-1' }, { id: 'visit-2' }] },
  { id: 'local-b', serverId: 'srv-b', observations: [] },
  { id: 'local-c', serverId: null, observations: [{ id: 'visit-3' }] }, // only on this phone
];

test('a plant deleted on the server is removed, with all its observations', () => {
  const removed = serverDeletedPlants([change('srv-a', 'DELETE')], records);
  assert.deepEqual(removed.map((item) => item.record.id), ['local-a']);
  assert.deepEqual(removed[0].observationIds, ['visit-1', 'visit-2']);
  // A soft delete (deleted_at set) counts too; so does a match on the client record id.
  assert.deepEqual(serverDeletedPlants([change('srv-b', 'UPDATE', { deleted_at: '2026-11-21T10:00:00Z' })], records)
    .map((item) => item.record.id), ['local-b']);
  assert.deepEqual(serverDeletedPlants([change('srv-x', 'DELETE', { client_record_id: 'local-b' })], records)
    .map((item) => item.record.id), ['local-b']);
});

test('nothing else is removed: updates, other plants, plants only on this phone, re-created plants', () => {
  assert.deepEqual(serverDeletedPlants([change('srv-a', 'UPDATE', { plant_status: 'approved' })], records), []);
  assert.deepEqual(serverDeletedPlants([change('srv-zzz', 'DELETE')], records), []);
  // Never sent to the server: a pull can't remove it, even if a client id matches.
  assert.deepEqual(serverDeletedPlants([change('srv-q', 'DELETE', { client_record_id: 'local-c' })], records), []);
  // The last change wins.
  assert.deepEqual(serverDeletedPlants([change('srv-a', 'DELETE'), change('srv-a', 'INSERT')], records), []);
  assert.deepEqual(serverDeletedPlants([{ ...change('srv-a', 'DELETE'), entity_type: 'observations' }], records), []);
  assert.equal(isDeletedChange(change('srv-a', 'DELETE', null)), true);
});

test('sync pull: deleted plants leave the phone even with unsent or failed changes, outbox included', () => {
  const pull = read('../services/serverPull.ts');
  const removal = pull.indexOf('serverDeletedPlants(changes, [...byClientId.values()])');
  const keepLocal = pull.indexOf("if (existing && plantStatus.get(existing.id) !== 'uploaded')");
  assert.ok(removal > 0 && removal < keepLocal, 'deletions are handled before "keep local changes"');
  assert.match(pull, /await removeServerDeletedPlant\(record\.id, observationIds\);\s*byClientId\.delete\(record\.id\);/);
  assert.match(pull, /if \(isDeleted\(change\)\) continue;/);
  const db = read('../services/offlineDatabase.ts');
  const fn = db.slice(db.indexOf('export async function removeServerDeletedPlant('));
  assert.match(fn.slice(0, 1200), /DELETE FROM sync_outbox[\s\S]*DELETE FROM local_entities/);
  assert.doesNotMatch(fn.slice(0, 1200), /sync_status !== 'uploaded'/);
});
