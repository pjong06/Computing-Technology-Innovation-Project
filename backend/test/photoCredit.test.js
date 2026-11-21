'use strict';

// The iNaturalist photo credit must read "Photo: <name>, <licence> via iNaturalist" on the
// web portal (frontend/js/shared.js) and in the app (niah-biotrack/src/utils/photoCredit.ts),
// and both must give the same text. Never the whole attribution sentence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const repoRoot = path.join(__dirname, '..', '..');

// The web version: the marked block of shared.js, run on its own with the licence labels.
function loadWebCredit() {
  const shared = fs.readFileSync(path.join(repoRoot, 'frontend/js/shared.js'), 'utf8');
  const start = shared.indexOf('// ---- photo credit');
  const end = shared.indexOf('// ---- end photo credit ----');
  assert.ok(start !== -1 && end > start, 'shared.js must keep the photo credit markers');
  const labels = /const SPECIES_PHOTO_LICENSES = \{[\s\S]*?\};/.exec(shared);
  assert.ok(labels, 'shared.js must define SPECIES_PHOTO_LICENSES');
  const context = {};
  vm.runInNewContext(`${labels[0]}\n${shared.slice(start, end)}\nthis.photoCreditText = photoCreditText;`, context);
  return context.photoCreditText;
}

// The app version: Node loads the .ts file directly (Node 22.18+, CI runs Node 24).
async function loadAppCredit() {
  const file = pathToFileURL(path.join(repoRoot, 'niah-biotrack/src/utils/photoCredit.ts')).href;
  return (await import(file)).photoCreditText;
}

const cases = [
  {
    name: 'Samuel Frankel example: the name only, not the whole attribution sentence',
    photo: {
      photographer: '',
      attribution: '(c) Samuel Frankel, some rights reserved (CC BY), uploaded by Samuel Frankel',
      licence_code: 'cc-by',
    },
    expected: 'Photo: Samuel Frankel, CC BY via iNaturalist',
  },
  {
    name: 'CC0 with a photographer',
    photo: { photographer: 'Meng-Ying Tsai', attribution: 'no rights reserved', licence_code: 'cc0' },
    expected: 'Photo: Meng-Ying Tsai, CC0 via iNaturalist',
  },
  {
    name: 'CC0 without a photographer: iNaturalist puts the name after "uploaded by"',
    photo: { photographer: null, attribution: 'no rights reserved, uploaded by Meng-Ying Tsai', licence_code: 'cc0' },
    expected: 'Photo: Meng-Ying Tsai, CC0 via iNaturalist',
  },
  {
    name: 'attribution with no "(c)" is used as the name',
    photo: { photographer: '', attribution: 'Jane Doe', licence_code: 'cc-by-sa' },
    expected: 'Photo: Jane Doe, CC BY-SA via iNaturalist',
  },
  {
    name: 'attribution with no "(c)" and no name gives "Unknown photographer"',
    photo: { photographer: '', attribution: 'no rights reserved', licence_code: 'cc0' },
    expected: 'Photo: Unknown photographer, CC0 via iNaturalist',
  },
  {
    name: 'a photographer field holding the whole sentence is cleaned too',
    photo: { photographer: '© Ong Jyh Seng, some rights reserved (CC BY-SA)', attribution: null, licence_code: 'cc-by-sa' },
    expected: 'Photo: Ong Jyh Seng, CC BY-SA via iNaturalist',
  },
  {
    name: 'missing licence',
    photo: { photographer: 'Rob Foster', attribution: null, licence_code: null },
    expected: 'Photo: Rob Foster, Unknown licence via iNaturalist',
  },
];

for (const example of cases) {
  test(`photo credit: ${example.name} (web and app agree)`, async () => {
    const web = loadWebCredit();
    const app = await loadAppCredit();
    assert.equal(web(example.photo), example.expected, 'web portal');
    assert.equal(app(example.photo), example.expected, 'mobile app');
  });
}

test('the credit text never contains the attribution sentence', async () => {
  const app = await loadAppCredit();
  const text = app(cases[0].photo);
  assert.doesNotMatch(text, /\(c\)|rights reserved|uploaded by/i);
});

// Who gets a credit: iNaturalist photos that are not CC0. SFC's own photos never.
test('web and app agree on which photos need a credit', async () => {
  const shared = fs.readFileSync(path.join(repoRoot, 'frontend/js/shared.js'), 'utf8');
  const start = shared.indexOf('// ---- photo credit');
  const end = shared.indexOf('// ---- end photo credit ----');
  const context = {};
  vm.runInNewContext(`${shared.slice(start, end)}\nthis.needsPhotoCredit = needsPhotoCredit;`, context);
  const web = context.needsPhotoCredit;
  const app = (await import(pathToFileURL(path.join(repoRoot, 'niah-biotrack/src/utils/photoCredit.ts')).href)).needsPhotoCredit;

  const expected = [
    [{ source: 'inaturalist', licence_code: 'cc-by' }, true],
    [{ source: 'inaturalist', licence_code: 'cc-by-sa' }, true],
    [{ source: 'inaturalist', licence_code: null }, true], // licence unknown: credit to be safe
    [{ source: 'inaturalist', licence_code: 'cc0' }, false],
    [{ source: 'sfc', licence_code: 'cc-by' }, false],
    [{ source: null, licence_code: null }, false],
    [null, false],
  ];
  for (const [photo, needed] of expected) {
    assert.equal(web(photo), needed, `web ${JSON.stringify(photo)}`);
    assert.equal(app(photo), needed, `app ${JSON.stringify(photo)}`);
  }
});
