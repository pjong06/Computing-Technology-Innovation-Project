import test from 'node:test';
import assert from 'node:assert/strict';
import { plantPhotoCaption } from './plantPhotoCaption.ts';

test('the caption names the plant tag, never an internal id', () => {
  assert.equal(plantPhotoCaption('NIAH-PLT-00012'), 'From plant NIAH-PLT-00012');
  assert.equal(plantPhotoCaption('  NIAH-PLT-00001 '), 'From plant NIAH-PLT-00001');
  for (const tag of [null, undefined, '', '  ', 'plant:2c1f0f3e-0000-4000-8000-000000000000']) {
    assert.equal(plantPhotoCaption(tag), 'From a plant without a tag', String(tag));
  }
});
