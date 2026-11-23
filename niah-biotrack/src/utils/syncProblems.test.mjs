// Tests for the problems part of src/utils/syncDetails.ts: sync failures outside the outbox (photos, submits),
// permanent-failure detection, Retry visibility, and the wiring that makes Sync details and
// the sync counts agree. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  finalProblemText,
  plantPhotoCode,
  recordSyncProblems,
  recordsWithGonePlant,
  retryableRecord,
  submitCodeOf,
} from './syncDetails.ts';
import { plantStatusLine } from './plantStatusLine.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

// An approved new plant whose photo was never uploaded: the server refuses photos on a
// plant that is no longer pending (photos_locked).
const approvedWithLockedPhoto = {
  id: 'p1', tagCode: 'NIAH-PLT-00011', scientificName: 'Nepenthes ampullaria', syncStatus: 'Upload failed',
  photoEntries: [{ id: 'ph1', uri: 'file:///a.jpg', syncStatus: 'Upload failed', lastError: "Photos can't be added after submission", lastCode: 'photos_locked' }],
  observations: [{ id: 'o1', submittedForReview: true }],
};

// Observations of NIAH-PLT-00014: the plant was soft-deleted on the server, so submit is refused.
const deletedPlant = {
  id: 'p14', tagCode: 'NIAH-PLT-00014', scientificName: 'Licuala orbicularis', syncStatus: 'Upload failed',
  observations: [
    { id: 'o14a', submissionRequested: true, submittedForReview: false, submitError: 'This plant was removed on the server.', submitCode: 'plant_deleted' },
    { id: 'o14b', submissionRequested: true, submittedForReview: false, submitError: 'This plant was removed on the server.', submitCode: 'plant_deleted' },
  ],
};

test('photos and submits that make sync fail are found, with code and explanation', () => {
  const [photo] = recordSyncProblems(approvedWithLockedPhoto);
  assert.equal(photo.kind, 'photo');
  assert.equal(photo.code, 'photos_locked');
  assert.equal(photo.explanation, "This plant was already reviewed, so this photo can't be added.");
  assert.equal(photo.final, true);
  assert.equal(photo.uri, 'file:///a.jpg');

  const submits = recordSyncProblems(deletedPlant);
  assert.deepEqual(submits.map((problem) => [problem.kind, problem.code, problem.obsId, problem.final]), [
    ['submit', 'plant_deleted', 'o14a', true],
    ['submit', 'plant_deleted', 'o14b', true],
  ]);
  assert.equal(submits[0].explanation, 'This plant was removed on the server.');

  // Observation photos: locked (observation reviewed), gone, too large; uploaded ones are not problems.
  const withObservationPhotos = {
    id: 'p2', observations: [{
      id: 'o2', photoUris: ['u1', 'u2', 'u3', 'u4'],
      photoMeta: { u1: { uploaded: false, problem: 'locked' }, u2: { uploaded: false, problem: 'gone' }, u3: { uploaded: false, problem: 'too_large' }, u4: { uploaded: true } },
    }],
  };
  assert.deepEqual(recordSyncProblems(withObservationPhotos).map((problem) => problem.code), ['observation_locked', 'plant_deleted', 'photo_refused']);
  assert.match(recordSyncProblems(withObservationPhotos)[0].explanation, /observation was already reviewed, so this photo can't be added/);
});

test('temporary failures are problems too, but keep Retry', () => {
  const network = {
    id: 'p3', syncStatus: 'Not uploaded',
    photoEntries: [{ id: 'ph3', uri: 'u', syncStatus: 'Not uploaded', lastError: "Couldn't reach the server.", lastCode: 'network' }],
    observations: [],
  };
  const [problem] = recordSyncProblems(network);
  assert.equal(problem.code, 'network');
  assert.equal(problem.final, false);
  assert.equal(retryableRecord(network), true);
  // A photo not tried yet is not a problem (it uploads with its plant).
  assert.deepEqual(recordSyncProblems({ id: 'p4', photoEntries: [{ id: 'x', uri: 'u', syncStatus: 'Not uploaded' }], observations: [] }), []);
});

test('Retry upload only for temporary failures', () => {
  assert.equal(retryableRecord(approvedWithLockedPhoto), false);
  assert.equal(retryableRecord(deletedPlant), false);
  assert.equal(retryableRecord(deletedPlant, 'o14a'), false);
  // Not uploaded with nothing known against it (e.g. offline): Retry.
  assert.equal(retryableRecord({ id: 'p5', syncStatus: 'Not uploaded', observations: [] }), true);
  // A refused tag (Sync details explains it) is permanent for the plant row.
  assert.equal(retryableRecord({ id: 'p6', syncStatus: 'Upload failed', tagProblem: 'not_yours', observations: [] }), false);
  // One permanent and one temporary problem: Retry, for the temporary one.
  const mixed = {
    ...approvedWithLockedPhoto,
    photoEntries: [...approvedWithLockedPhoto.photoEntries, { id: 'ph9', uri: 'v', syncStatus: 'Not uploaded', lastError: 'busy', lastCode: 'server_unavailable' }],
  };
  assert.equal(retryableRecord(mixed), true);

  // Plant detail: the status line says why, without Retry.
  const line = plantStatusLine(approvedWithLockedPhoto, finalProblemText(approvedWithLockedPhoto));
  assert.deepEqual(line, { kind: 'failed', text: "Upload failed: this plant was already reviewed, so this photo can't be added", retry: false });
  assert.equal(plantStatusLine({ syncStatus: 'Upload failed' }).retry, true);
});

test('older records: codes read from the stored message', () => {
  assert.equal(plantPhotoCode({ id: 'a', uri: 'u', lastError: "Photos can't be added after submission" }), 'photos_locked');
  assert.equal(plantPhotoCode({ id: 'a', uri: 'u', lastError: 'The photo is over 5 MB' }), 'photo_refused');
  assert.equal(submitCodeOf({ id: 'v', submitError: "This visit can't be sent for review. Please contact the officer." }), 'submit_refused');
  // Held back by an oversized photo: the photo is the problem, not the submit.
  assert.equal(submitCodeOf({ id: 'v', submitError: 'A photo is over 5 MB, so this observation was not sent for review.' }), null);
  assert.deepEqual(recordsWithGonePlant([approvedWithLockedPhoto, deletedPlant]).map((record) => record.id), ['p14']);
});

test('wiring: one list for Sync details and the sync counts; permanent items are not retried', () => {
  const list = read('../services/syncDetailsList.ts');
  assert.match(list, /return \[\.\.\.outboxRows, \.\.\.recordProblemRows\(records\)\];/);
  assert.match(list, /export async function countSyncDetailItems\(/);
  // Profile and Home count what Sync details lists.
  assert.match(read('../../app/(tabs)/profile.tsx'), /await countSyncDetailItems\(\s*useRecordStore\.getState\(\)\.records\s*\)/);
  assert.match(read('../../app/(tabs)/home.tsx'), /const waitingItems = await countSyncDetailItems\(useRecordStore\.getState\(\)\.records\);/);
  // The screen offers Retry only for answers that can change.
  const screen = read('../../app/sync-details.tsx');
  assert.match(screen, /\{!row\.final \? \(\s*<TouchableOpacity onPress=\{\(\) => void retry\(row\)\}/);
  assert.match(screen, /await removeRefusedSubmit\(row\.target\.recordId, row\.target\.obsId, row\.code\);/);
  // Retry upload on Home and plant detail only for temporary failures.
  assert.match(read('../components/RecentActivity.tsx'), /actions: rowActions\(\{ action: status\.action, retryable: plantRetryable, gone: plantGone \}\),/);
  assert.match(read('../../app/plant-detail.tsx'), /plantStatusLine\(matched, retryableRecord\(matched\) \? null : finalProblemText\(matched\)\)/);
  // Not sent again: plant photos refused for good, submits whose plant/observation is gone.
  assert.match(read('../services/plantPhotoSync.ts'), /photo\.syncStatus === FAILED && FINAL_PHOTO_CODES\.has\(plantPhotoCode\(photo\) \?\? ''\)/);
  const store = read('../store/useRecordStore.ts');
  assert.match(store, /observation\.submitCode === 'plant_deleted' \|\|\s*observation\.submitCode === 'observation_deleted'/);
  assert.match(store, /meta\.problem === 'gone' \|\|/);
});
