// Tests for src/utils/tagCode.ts. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTagCode } from './tagCode.ts';

test('tag codes are cleaned up and checked', () => {
  assert.equal(parseTagCode('NIAH-PLT-00001'), 'NIAH-PLT-00001');
  assert.equal(parseTagCode(' niah-plt-00001 '), 'NIAH-PLT-00001');
  assert.equal(parseTagCode('https://x.com/p/NIAH-PLT-00001'), 'NIAH-PLT-00001');
  assert.equal(parseTagCode('NIAH-PLT-0001'), null);
  assert.equal(parseTagCode('NIAH-PLT-000012'), null);
  assert.equal(parseTagCode('plant:3f6c1a2e-0000-4000-8000-000000000000'), null);
  assert.equal(parseTagCode(''), null);
});

test('tags typed in any case, without dashes or with other separators are recognised', () => {
  for (const typed of ['niahplt00015', 'NIAHPLT00015', 'niah plt 00015', 'Niah_Plt-00015', ' niah-plt-00015 ', 'https://x.com/p/niahplt00015']) {
    assert.equal(parseTagCode(typed), 'NIAH-PLT-00015', typed);
  }
  for (const typed of ['niahplt0015', 'niahplt000150', 'NIAH-PLT-1A345', 'PLT-00015']) {
    assert.equal(parseTagCode(typed), null, typed);
  }
});

test('no leftover TODO notes in the tag parser', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.doesNotMatch(fs.readFileSync(path.join(here, 'tagCode.ts'), 'utf8'), /TODO/);
});
