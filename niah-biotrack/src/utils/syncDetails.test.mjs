// Tests for src/utils/syncDetails.ts (Profile > Sync details) and its wiring.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  answerCode,
  attemptsText,
  describeOutboxRow,
  explainAnswer,
  itemTitle,
  outboxItemKind,
} from './syncDetails.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

test('what each waiting item is: plant, observation, tag, species request', () => {
  assert.equal(outboxItemKind('plant', { qr_code_value: 'NIAH-PLT-00001' }), 'tag');
  assert.equal(outboxItemKind('plant', { qr_code_value: 'NIAH-PLT-00001', species_id: 'x' }), 'plant');
  assert.equal(outboxItemKind('observation', {}), 'observation');
  assert.equal(outboxItemKind('proposal', {}), 'species_request');
});

test('the last answer as a code: stored code first, then read from older messages, then the status', () => {
  assert.equal(answerCode('tag_already_set', 'This plant already has a physical tag', 'conflict'), 'tag_already_set');
  assert.equal(answerCode(null, 'plant_locked', 'conflict'), 'plant_locked');
  assert.equal(answerCode(null, 'Plant changed on the server', 'conflict'), 'version_conflict');
  assert.equal(answerCode(null, 'The phone could not reach the server', 'retry'), 'network');
  assert.equal(answerCode(null, null, 'pending'), 'waiting');
  assert.equal(answerCode(null, null, 'retry'), 'server_unavailable');
  assert.equal(answerCode(null, 'Something odd', 'failed'), 'refused');
});

test('plain explanations, and which answers can never upload', () => {
  for (const code of ['plant_locked', 'tag_not_yours', 'tag_already_set', 'tag_in_use', 'photo_refused', 'version_conflict']) {
    assert.equal(explainAnswer(code).final, true, code);
    assert.ok(explainAnswer(code).explanation.length > 20, code);
  }
  for (const code of ['network', 'server_unavailable', 'waiting', 'no_result', 'http_503']) {
    assert.equal(explainAnswer(code).final, false, code);
  }
  assert.match(explainAnswer('http_413').explanation, /error 413/);
  assert.match(explainAnswer('something_new').explanation, /refused/);
  assert.equal(attemptsText(0), 'Not tried yet');
  assert.equal(attemptsText(1), '1 attempt');
  assert.equal(attemptsText(3), '3 attempts');
  assert.equal(itemTitle('NIAH-PLT-00042', 'Nepenthes ampullaria'), 'NIAH-PLT-00042 · Nepenthes ampullaria');
  assert.equal(itemTitle('plant:abc', 'Nepenthes ampullaria'), 'Nepenthes ampullaria');
  assert.equal(itemTitle(null, ''), 'Unnamed record');
});

test('an outbox row as the screen shows it', () => {
  const refusedTag = describeOutboxRow({
    operationId: 'op1', entityType: 'plant', status: 'conflict', attempts: 2,
    lastError: 'tag_not_yours', lastCode: 'tag_not_yours',
    payload: { qr_code_value: 'NIAH-PLT-00042' },
    snapshot: { tagCode: 'NIAH-PLT-00042', scientificName: 'Nepenthes ampullaria' },
  });
  assert.deepEqual(
    { kind: refusedTag.kind, title: refusedTag.title, code: refusedTag.code, final: refusedTag.final, attempts: refusedTag.attempts },
    { kind: 'tag', title: 'NIAH-PLT-00042 · Nepenthes ampullaria', code: 'tag_not_yours', final: true, attempts: 2 }
  );
  // An observation is named after its plant.
  const observation = describeOutboxRow(
    { operationId: 'op2', entityType: 'observation', status: 'retry', attempts: 1, lastError: 'Network', lastCode: 'network', payload: {}, snapshot: {} },
    { tagCode: 'NIAH-PLT-00007', scientificName: 'Begonia niahensis' }
  );
  assert.equal(observation.title, 'NIAH-PLT-00007 · Begonia niahensis');
  assert.equal(observation.final, false);
  // Not sent yet: never offered for removal, whatever was stored before.
  const waiting = describeOutboxRow({ operationId: 'op3', entityType: 'proposal', status: 'pending', attempts: 0, lastError: null, lastCode: null, payload: {}, snapshot: { scientificName: 'Licuala dubia' } });
  assert.deepEqual([waiting.kind, waiting.title, waiting.code, waiting.final], ['species_request', 'Licuala dubia', 'waiting', false]);
});

test('wiring: codes stored, Sync details reachable from Profile and the failure messages', () => {
  const database = read('../services/offlineDatabase.ts');
  assert.match(database, /const DATABASE_VERSION = 4;/);
  assert.match(database, /ALTER TABLE sync_outbox ADD COLUMN last_code TEXT;/);
  assert.match(database, /export async function getWaitingOutboxRows\(/);
  assert.match(database, /export async function retryOutboxOperation\(/);
  assert.match(database, /export async function removeOutboxOperation\(/);
  assert.match(read('../services/syncEngine.ts'), /code: status === 0 \? 'network' : `http_\$\{status\}`,/);
  const screen = read('../../app/sync-details.tsx');
  assert.match(screen, /Alert\.alert\('Remove from phone\?'/);
  assert.match(screen, /\{row\.final \? \(/);
  assert.match(read('../../app/_layout.tsx'), /<Stack\.Screen name="sync-details" \/>/);
  const profile = read('../../app/(tabs)/profile.tsx');
  assert.match(profile, /router\.push\('\/sync-details' as never\)/);
  assert.match(profile, /\{ text: 'Details', onPress: \(\) => router\.push\('\/sync-details' as never\) \}/);
  assert.match(read('../../app/(tabs)/home.tsx'), /Tap for details/);
});
