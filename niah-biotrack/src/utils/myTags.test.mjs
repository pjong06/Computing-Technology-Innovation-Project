// Tests for src/utils/myTags.ts and the "My QR tags" workflow. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NEW_TAG_COUNTS,
  NOT_YOURS_MESSAGE,
  USED_MESSAGE,
  base64FromBytes,
  fromServer,
  groupBatches,
  isPhysicalTag,
  MAX_PRINT_TAGS,
  PDF_LAYOUTS,
  tagCountsText,
  tagImagePath,
  tagOwnershipProblem,
  toggleSelected,
} from './myTags.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8');

const rows = [
  { qr_code_value: 'NIAH-PLT-00011', request_id: 'r1', reserved_at: '2026-11-20T01:00:00Z', bound_plant_id: null, bound_at: null },
  { qr_code_value: 'NIAH-PLT-00010', request_id: 'r1', reserved_at: '2026-11-20T01:00:00Z', bound_plant_id: 'P-1', bound_at: '2026-11-20T02:00:00Z' },
  { qr_code_value: 'NIAH-PLT-00030', request_id: 'r2', reserved_at: '2026-11-21T01:00:00Z', bound_plant_id: null, bound_at: null },
  { qr_code_value: 'plant:abc', request_id: 'r3', reserved_at: '2026-11-21T01:00:00Z', bound_plant_id: null, bound_at: null },
];
const mine = fromServer(rows);

test('"Get new tags" offers 10 / 20 / 50; only physical NIAH-PLT tags count', () => {
  assert.deepEqual([...NEW_TAG_COUNTS], [10, 20, 50]);
  assert.equal(mine.length, 3);
  assert.equal(isPhysicalTag('NIAH-PLT-00001'), true);
  for (const tag of ['plant:abc', 'niah-plt-00001', '', null, undefined]) assert.equal(isPhysicalTag(tag), false, String(tag));
});

test('tags are grouped by reservation, newest first, with unused counts', () => {
  const batches = groupBatches(mine);
  assert.deepEqual(batches.map((b) => [b.requestId, b.tags.map((t) => t.tag), b.unused]), [
    ['r2', ['NIAH-PLT-00030'], 1],
    ['r1', ['NIAH-PLT-00010', 'NIAH-PLT-00011'], 1],
  ]);
  assert.equal(tagCountsText(mine), '2 unused · 1 used');
});

test('only your own unused tag can be attached (or the one already on this plant)', () => {
  assert.equal(tagOwnershipProblem('NIAH-PLT-00011', mine, 'P-9'), null);
  assert.equal(tagOwnershipProblem('NIAH-PLT-00099', mine, 'P-9'), NOT_YOURS_MESSAGE);
  assert.equal(NOT_YOURS_MESSAGE, "This tag isn't one of yours. Get new tags in My QR tags.");
  assert.equal(tagOwnershipProblem('NIAH-PLT-00010', mine, 'P-9'), USED_MESSAGE);
  assert.equal(tagOwnershipProblem('NIAH-PLT-00010', mine, 'p-1'), null, 'already on this plant');
  assert.equal(tagOwnershipProblem('NIAH-PLT-00010', mine, null), USED_MESSAGE);
});

test('the PDF bytes are written as base64 correctly', () => {
  for (const text of ['', 'f', 'fo', 'foo', 'foob', '%PDF-1.7\nÿ\u0000binary']) {
    const bytes = Uint8Array.from(Buffer.from(text, 'latin1'));
    assert.equal(base64FromBytes(bytes), Buffer.from(bytes).toString('base64'), JSON.stringify(text));
  }
});

test('My QR tags screen: botanists only, existing endpoints, offline message, retry with the same request', () => {
  const service = read('../services/myTags.ts');
  assert.match(service, /apiFetch<[\s\S]*?>\(\s*`\/api\/tag-reservations\?page=\$\{page\}&page_size=100`/);
  assert.match(service, /apiDownload\('\/api\/tag-reservations\/reserve-and-print', \{ count, request_id: requestId, layout \}\)/);
  assert.match(service, /const OFFLINE_MESSAGE = 'You are offline\. Getting tags needs the internet\.';/);
  assert.match(service, /if \(await isSyncOffline\(\)\) return \{ ok: false, reason: OFFLINE_MESSAGE, requestId \};/);
  assert.match(service, /Share\.share\(\{ url: file\.uri/);
  assert.match(service, /Directory\.pickDirectoryAsync\(\)/);
  const screen = read('../../app/my-tags.tsx');
  assert.match(screen, /if \(role !== 'botanist'\)/);
  assert.match(screen, /Try again \(same \{retry\.count\} tags\)/);
  assert.match(screen, /getTags\(batch\.tags\.length, batch\.requestId\)/);
  for (const needed of ['Get new tags', 'Unused', 'Used', 'Share PDF', 'Print again']) assert.ok(screen.includes(needed), needed);
  const profile = read('../../app/(tabs)/profile.tsx');
  assert.match(profile, /\{role === 'botanist' && \([\s\S]*?router\.push\('\/my-tags' as never\)[\s\S]*?My QR tags/);
  assert.match(read('../../app/_layout.tsx'), /<Stack\.Screen name="my-tags" \/>/);
});

test('Scan tag accepts only your own tags; "No physical tag yet" stays; no tag number is used up by opening the screen', () => {
  const attach = read('../../app/attach-tag.tsx');
  assert.match(attach, /const notMine = await myTagProblem\(clean, record\.serverId\);\s*if \(notMine\) \{\s*return notMine;/);
  assert.doesNotMatch(attach, /void generateServerTag\(\)/);
  assert.match(attach, /'Generate new tag'/);
  const confirm = read('../../app/save-confirm.tsx');
  assert.match(confirm, />Scan tag</);
  assert.match(confirm, /No physical tag yet \(attach it later\)/);
  assert.match(confirm, /!isPhysicalTag\(matched\.tagCode\)/);
});

test('plant detail: own plants with a placeholder show Attach tag; Show QR only for a real tag', () => {
  const detail = read('../../app/plant-detail.tsx');
  assert.match(detail, /\{isPhysicalTag\(matched\.tagCode\) \? \(\s*<TouchableOpacity style=\{styles\.actionBtn\} onPress=\{\(\) => void openQr\(\)\}>/);
  assert.match(detail, /\) : matched\.otherBotanist \? null : \(/);
  assert.match(detail, /🏷️ Attach tag/);
  assert.match(detail, /value=\{isPhysicalTag\(matched\.tagCode\) \? matched\.tagCode : 'No tag attached'\}/);
});

test('PDF layouts: "Sheet of labels" (the default) or "One label per page"', () => {
  assert.deepEqual(PDF_LAYOUTS.map((option) => option.value), ['sheet', 'single']);
  assert.deepEqual(PDF_LAYOUTS.map((option) => option.label), ['Sheet of labels', 'One label per page']);
  const service = read('../services/myTags.ts');
  assert.match(service, /layout: PdfLayout = 'sheet'/);
  assert.match(service, /apiDownload\('\/api\/tag-reservations\/print', \{ tags, layout \}\)/);
});

test('tag image: an unused tag through its reservation, a used one through its plant', () => {
  assert.equal(tagImagePath({ tag: 'NIAH-PLT-00031', boundPlantId: null }), '/api/tag-reservations/NIAH-PLT-00031/image');
  assert.equal(
    tagImagePath({ tag: 'NIAH-PLT-00032', boundPlantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    '/api/plants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/qr/image'
  );
});

test('choosing tags to print adds and removes them; at most 100', () => {
  let chosen = [];
  chosen = toggleSelected(chosen, 'NIAH-PLT-00031');
  chosen = toggleSelected(chosen, 'NIAH-PLT-00033');
  assert.deepEqual(chosen, ['NIAH-PLT-00031', 'NIAH-PLT-00033']);
  assert.deepEqual(toggleSelected(chosen, 'NIAH-PLT-00031'), ['NIAH-PLT-00033']);
  assert.equal(MAX_PRINT_TAGS, 100);
});

test('My QR tags and plant detail: Save image, Share, layout choice and Print selected', () => {
  const screen = read('../../app/my-tags.tsx');
  for (const needed of ['Save image', 'Share', 'PDF layout', 'Select', 'Print selected']) assert.ok(screen.includes(needed), needed);
  assert.match(screen, /downloadTagImage\(tag\.tag, tagImagePath\(tag\)\)/);
  assert.match(screen, /reserveTagsPdf\(howMany, requestId, layout\)/);
  assert.match(screen, /printTagsPdf\(selected, layout\)/);
  const detail = read('../../app/plant-detail.tsx');
  assert.match(detail, /downloadTagImage\(qr\.qrValue, `\/api\/plants\/\$\{encodeURIComponent\(matched\.serverId\)\}\/qr\/image`\)/);
  assert.ok(detail.includes('>Save image<') && detail.includes('>Share<'));
  // No new packages: saving uses the folder picker / share sheet already used for the PDF.
  const service = read('../services/myTags.ts');
  assert.match(service, /folder\.createFile\(file\.name, mimeType\)/);
  const pkg = JSON.parse(read('../../package.json'));
  assert.equal(pkg.dependencies['expo-sharing'], undefined);
  assert.equal(pkg.dependencies['expo-media-library'], undefined);
});
