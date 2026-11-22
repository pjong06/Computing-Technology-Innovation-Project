// Tests for src/utils/photoCompression.ts: photos are shrunk on the phone before upload.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPRESSION_STEPS,
  PREPARE_FAILED_MESSAGE,
  SERVER_LIMIT_BYTES,
  SMALL_ENOUGH_BYTES,
  STILL_TOO_LARGE_MESSAGE,
  TARGET_BYTES,
  compressToFit,
  fitWithin,
  needsCompression,
} from './photoCompression.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');
const MB = 1024 * 1024;

test('first try: longest side 2000 px at quality 0.75; then smaller and lower quality', () => {
  assert.deepEqual(COMPRESSION_STEPS[0], { maxSide: 2000, quality: 0.75 });
  for (let i = 1; i < COMPRESSION_STEPS.length; i += 1) {
    assert.ok(COMPRESSION_STEPS[i].maxSide < COMPRESSION_STEPS[i - 1].maxSide, 'smaller each time');
    assert.ok(COMPRESSION_STEPS[i].quality < COMPRESSION_STEPS[i - 1].quality, 'lower quality each time');
  }
});

test('the target is comfortably under the server limit, which matches the backend', () => {
  assert.equal(SERVER_LIMIT_BYTES, 5 * MB);
  assert.ok(TARGET_BYTES <= SERVER_LIMIT_BYTES * 0.6, 'at most 60% of the limit');
  // backend/src/services/storageService.js: multer limits.fileSize.
  const storage = fs.readFileSync(path.join(here, '../../../backend/src/services/storageService.js'), 'utf8');
  assert.match(storage, /fileSize: 5 \* 1024 \* 1024/);
});

test('resize: longest side at most maxSide, aspect kept, never enlarged', () => {
  assert.deepEqual(fitWithin(4032, 3024, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(fitWithin(3024, 4032, 2000), { width: 1500, height: 2000 });
  assert.deepEqual(fitWithin(1200, 900, 2000), { width: 1200, height: 900 });
  assert.deepEqual(fitWithin(2000, 2000, 2000), { width: 2000, height: 2000 });
});

test('which saved photos are compressed before upload', () => {
  // A HEIC (or any format the server refuses) always.
  assert.equal(needsCompression('.heic', 500_000), true);
  assert.equal(needsCompression('', 500_000), true);
  // A big JPEG (saved before compression existed): yes. A small one (compressed when saved): sent as is.
  assert.equal(needsCompression('.jpg', 6 * MB), true);
  assert.equal(needsCompression('.JPG', 2 * MB), true);
  assert.equal(needsCompression('.jpg', SMALL_ENOUGH_BYTES), false);
  assert.equal(needsCompression('.png', 300_000), false);
  // Size unknown: compress to be safe.
  assert.equal(needsCompression('.jpg', null), true);
});

test('the first step that fits is used', async () => {
  const tried = [];
  const result = await compressToFit(async (step) => {
    tried.push(step);
    return { output: `photo-${step.maxSide}.jpg`, size: 800_000 };
  });
  assert.equal(result.ok, true);
  assert.equal(result.output, 'photo-2000.jpg');
  assert.deepEqual(result.step, { maxSide: 2000, quality: 0.75 });
  assert.equal(result.attempts, 1);
  assert.equal(tried.length, 1);
});

test('still too large: compressed again smaller and at lower quality until it fits', async () => {
  const sizes = { 2000: 4.2 * MB, 1600: 3.4 * MB, 1280: 2.1 * MB, 1024: 1.2 * MB };
  const tried = [];
  const result = await compressToFit(async (step) => {
    tried.push([step.maxSide, step.quality]);
    return { output: `photo-${step.maxSide}.jpg`, size: sizes[step.maxSide] };
  });
  assert.equal(result.ok, true);
  assert.equal(result.output, 'photo-1280.jpg');
  assert.equal(result.attempts, 3);
  assert.deepEqual(tried, [[2000, 0.75], [1600, 0.6], [1280, 0.5]]);
});

test('a step that fails is skipped; only when nothing fits is the botanist told', async () => {
  // The first step crashes (e.g. out of memory), the next one works.
  let calls = 0;
  const recovered = await compressToFit(async (step) => {
    calls += 1;
    if (calls === 1) throw new Error('decode failed');
    return { output: `photo-${step.maxSide}.jpg`, size: 1 * MB };
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.output, 'photo-1600.jpg');

  // Every step made a file, all too big: "still over 5 MB after shrinking".
  const tooBig = await compressToFit(async () => ({ output: 'x.jpg', size: 6 * MB }));
  assert.deepEqual(tooBig, { ok: false, message: STILL_TOO_LARGE_MESSAGE, attempts: COMPRESSION_STEPS.length });
  assert.match(STILL_TOO_LARGE_MESSAGE, /still over 5 MB after shrinking/);

  // No step could make a file at all.
  const broken = await compressToFit(async () => { throw new Error('no decoder'); });
  assert.equal(broken.ok, false);
  assert.equal(broken.message, PREPARE_FAILED_MESSAGE);
});

test('wiring: compressed once when saved, and again at upload for older photos; originals kept', () => {
  const service = read('../services/uploadablePhoto.ts');
  // Decoded no larger than the step (aspect kept, orientation applied by the loader), saved as JPEG.
  assert.match(service, /\.manipulate\(uri, \{ maxWidth: step\.maxSide, maxHeight: step\.maxSide \}\)/);
  assert.match(service, /saveAsync\(\{ format: ImageManipulator\.SaveFormat\.JPEG, compress: step\.quality \}\)/);
  // At upload: compressed unless already small; nothing fits -> ApiError 413 (marked too large).
  assert.match(service, /if \(!needsCompression\(file\.extension, file\.size\)\) return file;/);
  assert.match(service, /throw new ApiError\(result\.message, 413, 'photo_refused'\);/);
  // When saved: the compressed copy is what is kept.
  const storage = read('photoStorage.ts');
  assert.match(storage, /const compressed = await compressPhoto\(sourceUri\);/);
  assert.match(storage, /source = compressed\.output;\s*extension = '\.jpg';/);
  // A large saved photo is no longer refused before compressing it.
  const store = read('../store/useRecordStore.ts');
  const reader = store.slice(store.indexOf('function photoFileFor('), store.indexOf('function inferPhotoProblem('));
  assert.doesNotMatch(reader, /MAX_PHOTO_BYTES/);
  // Both upload paths go through the compression.
  assert.match(store, /await uploadablePhotoFile\(\s*read\.file\s*\)/);
  assert.match(read('../services/plantPhotoSync.ts'), /const uploadFile = await uploadablePhotoFile\(file\);/);
  // No new packages.
  const pkg = JSON.parse(read('../../package.json'));
  assert.ok(pkg.dependencies['expo-image-manipulator']);
});
