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

test('no leftover TODO notes in the tag parser', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.doesNotMatch(fs.readFileSync(path.join(here, 'tagCode.ts'), 'utf8'), /TODO/);
});

test('discarding a route goes back to Home', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const linkRoute = fs.readFileSync(path.join(here, '../../app/link-route.tsx'), 'utf8');
  assert.match(linkRoute, /discardDraftRoute\(\);\s*router\.replace\('\/\(tabs\)\/home' as any\);/);
  assert.doesNotMatch(linkRoute, /router\.replace\('\/\(tabs\)' as any\)/);
});
