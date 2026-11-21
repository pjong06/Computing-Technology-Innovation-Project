import test from 'node:test';
import assert from 'node:assert/strict';
import { publicPhotoUri } from './publicPhoto.ts';

test('a public photo path becomes an address on the API server', () => {
  assert.equal(publicPhotoUri('https://api.example.org', '/p/NIAH-PLT-00012/photo'),
    'https://api.example.org/p/NIAH-PLT-00012/photo');
  assert.equal(publicPhotoUri('https://api.example.org/', '/p/NIAH-PLT-00012/photo'),
    'https://api.example.org/p/NIAH-PLT-00012/photo');
});

test('anything but the visitor photo path is ignored', () => {
  for (const path of [null, undefined, '', 'https://evil.example/p/NIAH-PLT-00012/photo',
    '//evil.example/x', '/p/NIAH-PLT-00012', '/p/plant:abc/photo', 'user/plant/photo.jpg',
    '/storage/v1/object/sign/plant-media/x.jpg?token=1', '/p/NIAH-PLT-00012/photo?x=1']) {
    assert.equal(publicPhotoUri('https://api.example.org', path), null, String(path));
  }
  assert.equal(publicPhotoUri(undefined, '/p/NIAH-PLT-00012/photo'), null);
  assert.equal(publicPhotoUri('not a url', '/p/NIAH-PLT-00012/photo'), null);
});
