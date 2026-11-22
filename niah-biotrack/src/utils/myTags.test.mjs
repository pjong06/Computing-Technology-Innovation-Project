// Tests for src/utils/myTags.ts and the "My QR tags" workflow. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TAG_COUNT,
  NOT_YOURS_MESSAGE,
  PRINT_LAYOUTS,
  batchCountsText,
  batchLabel,
  initiallyOpenBatches,
  parseTagCount,
  printPlan,
  stepTagCount,
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

test('"Get new tags": a number from 1 to 100 (10 to start); 0, 101 and non-numbers are refused', () => {
  assert.equal(DEFAULT_TAG_COUNT, 10);
  assert.deepEqual(parseTagCount('10'), { ok: true, value: 10 });
  assert.deepEqual(parseTagCount(' 1 '), { ok: true, value: 1 });
  assert.deepEqual(parseTagCount('100'), { ok: true, value: 100 });
  for (const bad of ['0', '101', '', 'ten', '1.5', '-3', '1e2', '12a']) {
    assert.equal(parseTagCount(bad).ok, false, bad);
  }
  assert.match(parseTagCount('101').message, /1 to 100/);
  assert.match(parseTagCount('abc').message, /whole number from 1 to 100/);
  // − / + stay within 1–100; an unreadable number starts again from 10.
  assert.equal(stepTagCount('10', 1), '11');
  assert.equal(stepTagCount('1', -1), '1');
  assert.equal(stepTagCount('100', 1), '100');
  assert.equal(stepTagCount('', 1), '11');
  const screen = read('../../app/my-tags.tsx');
  assert.match(screen, /keyboardType="number-pad"/);
  assert.match(screen, /`Get \$\{parsedCount\.value\} \$\{parsedCount\.value === 1 \? 'tag' : 'tags'\}`/);
  // No layout is chosen before getting tags.
  assert.doesNotMatch(screen, /PDF layout/);
});

test('only physical NIAH-PLT tags count', () => {
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
  // "Get N tags" reserves (no PDF, no layout); a retry sends the same request id.
  assert.match(service, /apiFetch<\{ request_id: string; tags: string\[\] \}>\('\/api\/tag-reservations\/reserve', \{\s*method: 'POST',\s*body: \{ count, request_id: requestId \},/);
  assert.match(service, /const OFFLINE_MESSAGE = 'You are offline\. Getting tags needs the internet\.';/);
  assert.match(service, /if \(await isSyncOffline\(\)\) return \{ ok: false, reason: OFFLINE_MESSAGE, requestId \};/);
  assert.match(service, /Share\.share\(\{ url: file\.uri/);
  assert.match(service, /Directory\.pickDirectoryAsync\(\)/);
  const screen = read('../../app/my-tags.tsx');
  assert.match(screen, /if \(role !== 'botanist'\)/);
  assert.match(screen, /Try again \(same \{retry\.count\} tags\)/);
  assert.match(screen, /void getTags\(retry\.count, retry\.requestId\)/);
  for (const needed of ['Get new tags', 'Unused', 'Used', 'Share PDF', '>Print<']) assert.ok(screen.includes(needed), needed);
  // "Print again" is now "Print".
  assert.doesNotMatch(screen, /Print again/);
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
  assert.match(detail, />Attach tag</);
  // The title is the plant's tag: the real tag, or "No tag yet" (plantHeading).
  assert.match(detail, /const heading = plantHeading\(matched\.tagCode, matched\.scientificName, matched\.commonName\);/);
  assert.match(detail, /\{heading\.title\}/);
  // The "⋯" menu offers Attach/Change tag on the botanist's own plants only.
  assert.match(detail, /\{!matched\.otherBotanist \? \(\s*<TouchableOpacity\s+style=\{styles\.menuItem\}/);
  assert.match(detail, /isPhysicalTag\(matched\.tagCode\) \? 'Change tag' : 'Attach tag'/);
});

test("plant detail: Show QR, Save image and Share for other botanists' and imported plants; no tag says so", () => {
  const detail = read('../../app/plant-detail.tsx');
  // Show QR is not limited to own plants: any plant with a real tag (the server allows approved ones).
  assert.doesNotMatch(detail, /otherBotanist && isPhysicalTag|!matched\.otherBotanist && isPhysicalTag/);
  // Someone else's plant without a real tag: "No tag attached yet", never "Plant not found".
  assert.match(detail, /const NO_TAG_TEXT = 'No tag attached yet';/);
  assert.match(detail, /\) : matched\.otherBotanist \? \(\s*<View style=\{\[styles\.actionBtn, styles\.actionBtnMuted\]\}/);
  assert.match(detail, /if \(!isPhysicalTag\(matched\.tagCode\)\) \{\s*Alert\.alert\(NO_TAG_TEXT,/);
  assert.match(detail, /error\.code === 'no_tag'\s*\? NO_TAG_TEXT/);
  // Save image and Share use the same plant QR image route for every plant.
  assert.match(detail, /downloadTagImage\(qr\.qrValue, `\/api\/plants\/\$\{encodeURIComponent\(matched\.serverId\)\}\/qr\/image`\)/);
  assert.match(read('../api/plantQr.ts'), /`\/api\/plants\/\$\{encodeURIComponent\(serverId\)\}\/qr`/);
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

test('My QR tags and plant detail: print sheet with layouts, images, and plant detail Save image / Share', () => {
  const screen = read('../../app/my-tags.tsx');
  // Every print: exactly the planned tags, in the layout chosen in the sheet.
  assert.match(screen, /const plan = printPlan\(\{ kind: 'selection', selected: request\.tags \}, layout\);/);
  assert.match(screen, /await printTagsPdf\(plan\.tags, plan\.layout\);/);
  assert.match(screen, /await saveTagImages\(plan\.tags\.map/);
  assert.match(read('../services/myTags.ts'), /downloadTagImage\(tag\.tag, tagImagePath\(tag\)\)/);
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

test('batches: one per reservation, labelled by date, "N used · M unused", newest open', () => {
  const now = new Date(2026, 10, 22, 15, 0);
  const tag = (code, requestId, reservedAt, plant = null) => ({ tag: code, requestId, reservedAt, boundPlantId: plant, boundAt: null });
  const today = new Date(2026, 10, 22, 9, 0).toISOString();
  const earlier = new Date(2026, 10, 18, 9, 0).toISOString();
  const lastYear = new Date(2025, 4, 3, 9, 0).toISOString();
  const list = [
    tag('NIAH-PLT-00021', 'old', earlier, 'P-1'), tag('NIAH-PLT-00022', 'old', earlier),
    tag('NIAH-PLT-00031', 'new', today), tag('NIAH-PLT-00032', 'new', today), tag('NIAH-PLT-00033', 'new', today),
    tag('NIAH-PLT-00005', 'oldest', lastYear),
  ];
  const batches = groupBatches(list);
  assert.deepEqual(batches.map((batch) => batch.requestId), ['new', 'old', 'oldest']);
  assert.deepEqual(batches.map((batch) => batchLabel(batch, now)), ['Today · 3 tags', '18 Nov · 2 tags', '3 May 2025 · 1 tag']);
  assert.deepEqual(batches.map((batch) => batchCountsText(batch)), ['0 used · 3 unused', '1 used · 1 unused', '0 used · 1 unused']);
  assert.deepEqual(initiallyOpenBatches(batches), ['new']);
  assert.deepEqual(initiallyOpenBatches([]), []);
});

test('printing a selection prints exactly the selected tags (3 chosen -> 3), across batches', () => {
  const batch = { tags: ['NIAH-PLT-00031', 'NIAH-PLT-00032', 'NIAH-PLT-00033', 'NIAH-PLT-00034', 'NIAH-PLT-00035',
    'NIAH-PLT-00036', 'NIAH-PLT-00037', 'NIAH-PLT-00038', 'NIAH-PLT-00039', 'NIAH-PLT-00040'].map((tag) => ({ tag })) };
  // The bug: 3 chosen printed the whole batch of 10.
  const chosen = ['NIAH-PLT-00035', 'NIAH-PLT-00021', 'NIAH-PLT-00031'];
  const plan = printPlan({ kind: 'selection', selected: chosen }, 'sheet');
  assert.deepEqual(plan.tags, ['NIAH-PLT-00021', 'NIAH-PLT-00031', 'NIAH-PLT-00035']);
  assert.equal(plan.title, 'Print 3 tags');
  // A batch's own Print prints that batch only.
  assert.equal(printPlan({ kind: 'batch', batch }, 'sheet').tags.length, 10);
  // Repeats and placeholders are left out; at most 100.
  assert.deepEqual(printPlan({ kind: 'selection', selected: ['NIAH-PLT-00031', 'NIAH-PLT-00031', 'plant:x'] }, 'sheet').tags, ['NIAH-PLT-00031']);
  assert.equal(printPlan({ kind: 'selection', selected: ['NIAH-PLT-00031'] }, 'sheet').title, 'Print 1 tag');

  // The screen: the selection bar prints only the chosen tags; while tags are chosen, a
  // batch's Print is hidden so it can't be pressed by mistake.
  const screen = read('../../app/my-tags.tsx');
  assert.match(screen, /const selectionPlan = printPlan\(\{ kind: 'selection', selected \}, 'sheet'\);/);
  assert.match(screen, /openPrint\(\{ tags: selectionPlan\.tags, title: selectionPlan\.title, clearSelection: true \}\)/);
  assert.match(screen, /\{selected\.length\} selected/);
  assert.match(screen, />Clear</);
  assert.match(screen, /Print \{selectionPlan\.tags\.length\}/);
  assert.match(screen, /\{selected\.length === 0 \? \(\s*<TouchableOpacity\s+style=\{styles\.batchPrint\}/);
  assert.doesNotMatch(screen, /reserveTagsPdf|getTags\(batch\.tags\.length/);
});

test('the layout chosen in "Print N tags" is passed through: Sheet (default), One per page, Images', () => {
  assert.deepEqual(PRINT_LAYOUTS.map((option) => option.value), ['sheet', 'single', 'images']);
  assert.deepEqual(PRINT_LAYOUTS.map((option) => option.label), ['Sheet of labels', 'One label per page', 'Images']);
  for (const layout of ['sheet', 'single', 'images']) {
    assert.equal(printPlan({ kind: 'selection', selected: ['NIAH-PLT-00031'] }, layout).layout, layout);
  }
  const screen = read('../../app/my-tags.tsx');
  // Each print starts on "Sheet of labels".
  assert.match(screen, /const openPrint = \(request: PrintRequest\) => \{\s*if \(request\.tags\.length === 0\) return;\s*setLayout\('sheet'\);/);
  // The service sends that layout to the print endpoint.
  assert.match(read('../services/myTags.ts'), /apiDownload\('\/api\/tag-reservations\/print', \{ tags, layout \}\)/);
});
