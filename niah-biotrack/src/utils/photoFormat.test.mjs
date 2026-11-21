// Tests for src/utils/photoFormat.ts. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { photoExtension, needsJpegConversion } from './photoFormat.ts';

test('iPhone HEIC photos (and other formats the backend refuses) are converted before upload', () => {
  for (const uri of [
    'file:///var/mobile/Containers/Data/Application/X/Documents/record-photos/1795400000000-ab12cd34.heic',
    'file:///photos/IMG_0042.HEIC',
    'file:///photos/a.heif',
    'file:///photos/a.tiff',
    'file:///photos/a.avif',
    'file:///photos/a.bmp',
    'file:///photos/a.gif',
    'file:///photos/no-extension',
  ]) {
    assert.equal(needsJpegConversion(uri), true, uri);
  }
});

test('JPEG, PNG and WebP photos are uploaded as they are', () => {
  for (const uri of [
    'file:///photos/1795400000000-ab12cd34.jpg',
    'file:///photos/IMG_0001.JPG',
    'file:///photos/a.jpeg',
    'file:///photos/a.png',
    'file:///photos/a.webp',
    'file:///photos/a.jpg?cache=1',
  ]) {
    assert.equal(needsJpegConversion(uri), false, uri);
  }
});

test('photo extensions are read from the file name only', () => {
  assert.equal(photoExtension('file:///a.b/c/photo.HEIC'), '.heic');
  assert.equal(photoExtension('file:///folder.jpg/photo'), '');
  assert.equal(photoExtension('file:///photos/.hidden'), '');
  assert.equal(photoExtension(''), '');
});

test('the backend allowlist is the one the phone converts for', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const storage = fs.readFileSync(path.join(here, '../../../backend/src/services/storageService.js'), 'utf8');
  const allowed = storage.slice(storage.indexOf('const allowedTypes'), storage.indexOf('];', storage.indexOf('const allowedTypes')));
  assert.deepEqual(allowed.match(/image\/[a-z]+/g), ['image/jpeg', 'image/png', 'image/webp']);
});

test('library photos are requested as JPEG on iOS, and both photo uploads convert first', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const picker = fs.readFileSync(path.join(here, 'imagePicker.ts'), 'utf8');
  assert.match(picker, /preferredAssetRepresentationMode: ImagePicker\.UIImagePickerPreferredAssetRepresentationMode\.Compatible/);
  const store = fs.readFileSync(path.join(here, '../store/useRecordStore.ts'), 'utf8');
  assert.match(store, /const uploadFile =\s*await uploadablePhotoFile\(\s*read\.file\s*\);/);
  assert.match(store, /\/photo`,\s*\{\s*client_photo_id:\s*meta\.id,\s*\},\s*uploadFile/);
  const plantPhotos = fs.readFileSync(path.join(here, '../services/plantPhotoSync.ts'), 'utf8');
  assert.match(plantPhotos, /const uploadFile = await uploadablePhotoFile\(file\);/);
  assert.match(plantPhotos, /'photo',\s*uploadFile,/);
});

test('the app never gives up on a refused photo while its visit is still a draft', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const store = fs.readFileSync(path.join(here, '../store/useRecordStore.ts'), 'utf8');
  // Photos marked locked are skipped only when the visit is waiting for review or approved.
  assert.match(store, /meta\.problem ===\s*'locked' &&\s*isPhotoLockFinal\(\s*currentObservation\.reviewStatus\s*\)/);
  // Only the server's "photos_locked" answer marks a photo locked; "photo_refused" (the
  // visit is still a draft) is not saved as a problem, so the photo is tried again.
  assert.match(store, /error\.code ===\s*'photos_locked'/);
  assert.doesNotMatch(store, /photo_refused/);
});
