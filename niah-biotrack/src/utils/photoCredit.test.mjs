// Tests for src/utils/photoCredit.ts (the Photo credits screen and the "i" on detail photos).
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { needsPhotoCredit, photoCreditRows, photoCreditText, photoLicenceLabel } from './photoCredit.ts';

const inat = (overrides) => ({ source: 'inaturalist', licence_code: 'cc-by', photographer: 'Jane Doe', ...overrides });

test('CC0 and SFC photos never need a credit; CC BY and CC BY-SA do', () => {
  assert.equal(needsPhotoCredit(inat({ licence_code: 'cc-by' })), true);
  assert.equal(needsPhotoCredit(inat({ licence_code: 'cc-by-sa' })), true);
  assert.equal(needsPhotoCredit(inat({ licence_code: 'cc0' })), false);
  assert.equal(needsPhotoCredit({ source: 'sfc', licence_code: 'cc-by' }), false);
  assert.equal(needsPhotoCredit(null), false);
  assert.equal(photoCreditText(inat({ licence_code: 'cc-by-sa' })), 'Photo: Jane Doe, CC BY-SA via iNaturalist');
  assert.equal(photoLicenceLabel(null), 'Unknown licence');
});

test('the Photo credits screen lists every credited photo, by species then photographer', () => {
  const rows = photoCreditRows([
    {
      id: 's2',
      scientific_name: 'Nepenthes ampullaria',
      common_name: 'Flask-shaped pitcher plant',
      species_media: [
        inat({ id: 'm1', photographer: 'Zoe', licence_code: 'cc-by-sa' }),
        inat({ id: 'm2', photographer: 'Adam' }),
        inat({ id: 'm3', licence_code: 'cc0' }),          // left out
        { id: 'm4', source: 'sfc', licence_code: null },  // left out
      ],
    },
    {
      id: 's1',
      scientific_name: 'Dipterocarpus grandiflorus',
      common_name: null,
      species_media: [inat({ id: 'm5', photographer: '', attribution: '(c) Samuel Frankel, some rights reserved (CC BY)' })],
    },
    { id: 's3', scientific_name: 'No photos', species_media: [] },
  ]);
  assert.deepEqual(rows, [
    { key: 's1:m5', species: 'Dipterocarpus grandiflorus', commonName: '', photographer: 'Samuel Frankel', licence: 'CC BY' },
    { key: 's2:m2', species: 'Nepenthes ampullaria', commonName: 'Flask-shaped pitcher plant', photographer: 'Adam', licence: 'CC BY' },
    { key: 's2:m1', species: 'Nepenthes ampullaria', commonName: 'Flask-shaped pitcher plant', photographer: 'Zoe', licence: 'CC BY-SA' },
  ]);
});
