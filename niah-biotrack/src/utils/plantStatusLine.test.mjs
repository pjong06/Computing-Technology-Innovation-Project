// Tests for src/utils/plantStatusLine.ts and the tag-after-submission wiring.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  plantStatusLine,
  speciesSubtitle,
  tagOnlyPayload,
  NOT_UPLOADED_TEXT,
  WAITING_TEXT,
} from './plantStatusLine.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

test('status line: one message from the real state', () => {
  // On the server, waiting for review.
  assert.deepEqual(plantStatusLine({ syncStatus: 'Uploaded', reviewStatus: 'pending' }), { kind: 'waiting', text: WAITING_TEXT });
  // Something still to send (a new tag, an observation) on a submitted plant.
  assert.deepEqual(plantStatusLine({ syncStatus: 'Not uploaded', reviewStatus: 'pending' }), { kind: 'not_uploaded', text: NOT_UPLOADED_TEXT });
  assert.equal(NOT_UPLOADED_TEXT, "Not uploaded yet — it will send when you're online");
  // Refused: the reason, and Retry.
  assert.deepEqual(plantStatusLine({ syncStatus: 'Upload failed', reviewStatus: 'pending', tagProblem: 'not_yours' }),
    { kind: 'failed', text: "Upload failed: this tag isn't one of your reserved tags", retry: true });
  assert.equal(plantStatusLine({ syncStatus: 'Upload failed', reviewStatus: 'pending', syncError: 'The server rejected part of this record. ' }).text,
    'Upload failed: the server rejected part of this record');
  assert.equal(plantStatusLine({ syncStatus: 'Upload failed' }).text, 'Upload failed: the server refused part of this record');
  // Nothing to add: a phone-only draft, an approved plant, a sent-back plant (chip and reason say it).
  assert.equal(plantStatusLine({ syncStatus: 'Local only', reviewStatus: 'draft' }), null);
  assert.equal(plantStatusLine({ syncStatus: 'Uploaded', reviewStatus: 'approved' }), null);
  assert.equal(plantStatusLine({ syncStatus: 'Uploaded', reviewStatus: 'rejected' }), null);
});

test('subtitle never repeats a word', () => {
  assert.equal(speciesSubtitle('Nepenthes ampullaria', 'Flask-shaped pitcher plant', 'Nepenthaceae'), 'Flask-shaped pitcher plant · Nepenthaceae');
  // Common name the same as the family or the scientific name: just the family.
  assert.equal(speciesSubtitle('Nepenthes ampullaria', 'Nepenthaceae', 'Nepenthaceae'), 'Nepenthaceae');
  assert.equal(speciesSubtitle('Nepenthes ampullaria', 'nepenthes  ampullaria', 'Nepenthaceae'), 'Nepenthaceae');
  // Family the same as the scientific name (a family-level record): nothing repeated.
  assert.equal(speciesSubtitle('Begoniaceae', 'Begoniaceae', 'Begoniaceae'), '');
  assert.equal(speciesSubtitle('Begoniaceae', 'Begonias', 'Begoniaceae'), 'Begonias');
  // Missing parts.
  assert.equal(speciesSubtitle('Licuala orbicularis', '', 'Arecaceae'), 'Arecaceae');
  assert.equal(speciesSubtitle('Licuala orbicularis', 'Umbrella palm', null), 'Umbrella palm');
  assert.equal(speciesSubtitle('Licuala orbicularis', null, null), '');
});

test('a stuck tag is sent again as a tag-only change', () => {
  assert.deepEqual(tagOnlyPayload({ species_id: 'x', qr_code_value: ' NIAH-PLT-00042 ', location_description: 'Zone B' }),
    { qr_code_value: 'NIAH-PLT-00042' });
  assert.equal(tagOnlyPayload({ qr_code_value: 'plant:abc' }), null);
  assert.equal(tagOnlyPayload({ location_description: 'Zone B' }), null);
  assert.equal(tagOnlyPayload(null), null);
});

test('wiring: tag-only updates, the stuck-tag retry and one status line on plant detail', () => {
  const repository = read('../services/offlineRecordRepository.ts');
  assert.match(repository, /\? \{ qr_code_value: normalized\.tagCode \}\s*: plantPayload\(normalized\)/);
  const store = read('../store/useRecordStore.ts');
  assert.match(store, /tagOnly:\s*Boolean\(\s*current\.serverId &&\s*current\.rowVersion\s*\)/);
  const database = read('../services/offlineDatabase.ts');
  assert.match(database, /export async function requeueLockedTagOperations\(/);
  assert.match(database, /AND last_error = 'plant_locked'/);
  assert.match(read('../services/syncEngine.ts'), /await requeueLockedTagOperations\(\);/);
  const detail = read('../../app/plant-detail.tsx');
  assert.doesNotMatch(detail, /Submitted\. It will go to an officer/);
  assert.match(detail, /const statusLine = plantStatusLine\(matched\);/);
  assert.match(detail, /const commonLine = speciesSubtitle\(matched\.scientificName, matched\.commonName, matched\.family\);/);
});
