// Tests for tag scanning with an up-to-date tag list, and for a tag the server refuses later.
//   - the saved tag list is refreshed from the server whenever online (opening the scanner,
//     every sync), so a tag deleted or used elsewhere is no longer accepted from an old list;
//   - a refused tag (tag_not_yours / tag_already_set / tag_in_use) is shown on the plant, with
//     "Attach a different tag", and the rest of the plant keeps uploading without it.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOT_YOURS_MESSAGE, USED_MESSAGE, refreshTagList, tagOwnershipProblem } from './myTags.ts';
import {
  ATTACH_DIFFERENT_TAG,
  TAG_CANT_BE_USED_TEXT,
  WAITING_TEXT,
  alreadySetText,
  needsServerTag,
  plantStatusLine,
  tagNotice,
  tagRefusalProblem,
  withoutRefusedTag,
} from './plantStatusLine.ts';
import { retryableRecord } from './syncDetails.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

const tag = (code, boundPlantId = null) => ({ tag: code, requestId: 'r1', reservedAt: '2026-11-20T00:00:00Z', boundPlantId, boundAt: null });

// ---- refresh ----

test('online, the saved list is replaced by the server\'s: a deleted or used tag is no longer accepted', async () => {
  // The phone's old list still has NIAH-PLT-00001 unused and NIAH-PLT-00002.
  let saved = [tag('NIAH-PLT-00001'), tag('NIAH-PLT-00002')];
  assert.equal(tagOwnershipProblem('NIAH-PLT-00001', saved), null);
  assert.equal(tagOwnershipProblem('NIAH-PLT-00002', saved), null);

  // On the server, 00001 was used on another plant and 00002 was deleted.
  const server = [tag('NIAH-PLT-00001', 'P-elsewhere')];
  let calls = 0;
  const result = await refreshTagList({
    isOffline: async () => false,
    fetchTags: async () => { calls += 1; saved = server; return server; },
  });
  assert.equal(result, 'refreshed');
  assert.equal(calls, 1);
  assert.equal(tagOwnershipProblem('NIAH-PLT-00001', saved), USED_MESSAGE);
  assert.equal(tagOwnershipProblem('NIAH-PLT-00002', saved), NOT_YOURS_MESSAGE);
});

test('offline or unreachable, the saved list stays as it is and nothing throws', async () => {
  let fetched = false;
  assert.equal(await refreshTagList({ isOffline: async () => true, fetchTags: async () => { fetched = true; return []; } }), 'offline');
  assert.equal(fetched, false);
  assert.equal(await refreshTagList({ isOffline: async () => false, fetchTags: async () => { throw new Error('network'); } }), 'failed');
  assert.equal(await refreshTagList({ isOffline: async () => { throw new Error('netinfo'); }, fetchTags: async () => [] }), 'failed');
});

test('the list is refreshed on opening the scanner and on every sync', () => {
  const service = read('../services/myTags.ts');
  assert.match(service, /export function refreshMyTags\(\)[\s\S]*?refreshTagList\(\{ isOffline: isSyncOffline, fetchTags: fetchMyTags \}\)/);
  // Attach tag (also reached from Register plant): when the screen with the scanner opens.
  const attach = read('../../app/attach-tag.tsx');
  assert.match(attach, /useEffect\(\(\) => \{\s*void refreshMyTags\(\);\s*\}, \[\]\);/);
  // Every sync (Sync now, automatic retries): the outbox push, once online.
  const engine = read('../services/syncEngine.ts');
  const push = engine.slice(engine.indexOf('async function runPush'), engine.indexOf('let processed = 0;'));
  assert.ok(push.indexOf('isSyncOffline()') < push.indexOf('void refreshMyTags();'));
  assert.match(push, /void refreshMyTags\(\);/);
});

// ---- refused later ----

test('the message on the plant, with "Attach a different tag"', () => {
  assert.deepEqual(tagNotice('not_yours'), {
    text: "This tag can't be used: it isn't one of your reserved tags. Attach a different tag.",
    action: 'Attach a different tag',
  });
  assert.deepEqual(tagNotice('in_use'), {
    text: "This tag can't be used: it is already attached to another plant. Attach a different tag.",
    action: ATTACH_DIFFERENT_TAG,
  });
  assert.equal(tagNotice('locked'), null);
  assert.equal(tagNotice(null), null);
  assert.equal(tagRefusalProblem('tag_not_yours'), 'not_yours');
  assert.equal(tagRefusalProblem('tag_already_set'), 'already_set');
  assert.equal(tagRefusalProblem('tag_in_use'), 'in_use');
  assert.equal(tagRefusalProblem('plant_locked'), null);
  assert.equal(tagRefusalProblem('server_unavailable'), null);
});

test('tag_already_set: the server\'s tag, and no "Attach a different tag" (another tag can\'t help)', () => {
  // Once the plant is refreshed from the server, its tag on the phone is the server's.
  assert.deepEqual(tagNotice('already_set', 'NIAH-PLT-00042'), {
    text: 'This plant already has a tag on the server (NIAH-PLT-00042).',
    action: null,
  });
  // Before the refresh (offline): no tag to name yet.
  assert.deepEqual(tagNotice('already_set', null), { text: 'This plant already has a tag on the server.', action: null });
  assert.equal(alreadySetText('plant:abc'), 'This plant already has a tag on the server.');
  // Refreshed only when the phone doesn't know the server's tag yet, and the plant is on the server.
  assert.equal(needsServerTag({ tagProblem: 'already_set', tagCode: null, serverId: 'P-1' }), true);
  assert.equal(needsServerTag({ tagProblem: 'already_set', tagCode: 'plant:abc', serverId: 'P-1' }), true);
  assert.equal(needsServerTag({ tagProblem: 'already_set', tagCode: 'NIAH-PLT-00042', serverId: 'P-1' }), false);
  assert.equal(needsServerTag({ tagProblem: 'already_set', tagCode: null, serverId: null }), false);
  assert.equal(needsServerTag({ tagProblem: 'not_yours', tagCode: null, serverId: 'P-1' }), false);
  // No "Upload failed" line as well.
  assert.deepEqual(plantStatusLine({ syncStatus: 'Upload failed', reviewStatus: 'pending', syncError: 'tag_already_set', tagProblem: 'already_set' }),
    { kind: 'waiting', text: WAITING_TEXT });
});

test('tag_already_set: every sync refreshes the plant from the server and takes its tag', () => {
  const engine = read('../services/syncEngine.ts');
  const refresh = engine.slice(engine.indexOf('export async function refreshPlantsWithServerTag'), engine.indexOf('async function runPush'));
  assert.match(refresh, /for \(const plant of await getPlantsNeedingServerTag\(\)\)/);
  assert.match(refresh, /apiFetch<[^>]*>\(\s*`\/api\/plants\/\$\{encodeURIComponent\(plant\.serverId\)\}`/);
  assert.match(refresh, /if \(!\/\^NIAH-PLT-\\d\{5\}\$\/\.test\(tag\)\) continue;/);
  assert.match(refresh, /await adoptServerPlantTag\(plant\.clientRecordId, tag, response\.row_version \?\? null\);/);
  const push = engine.slice(engine.indexOf('async function runPush'));
  assert.ok(push.indexOf('await refreshPlantsWithServerTag();') > push.indexOf('while (true)'));

  const database = read('../services/offlineDatabase.ts');
  const adopt = database.slice(database.indexOf('export async function adoptServerPlantTag'), database.indexOf('export async function getUploadedPlantsQueuedAsCreate'));
  // The refused tag change is settled, and the plant keeps the server's tag and says why.
  assert.match(adopt, /SET status = 'complete'[\s\S]*?status = 'conflict' AND last_error = 'tag_already_set'/);
  assert.match(adopt, /tagCode: serverTag, tagProblem: 'already_set'/);
  assert.match(database, /if \(needsServerTag\(plant\)\) plants\.push/);
});

test('the rest of the plant is sent again without the refused tag', () => {
  const plant = { species_id: 'S-1', qr_code_value: 'NIAH-PLT-00042', latitude: 3.8, longitude: 113.7, location_description: 'Zone B' };
  // A new plant: sent without the tag (the server gives it a placeholder), so its
  // observations and photos can upload.
  assert.deepEqual(withoutRefusedTag('create', plant),
    { species_id: 'S-1', qr_code_value: null, latitude: 3.8, longitude: 113.7, location_description: 'Zone B' });
  // An edit with other changes: those changes, without the tag.
  assert.deepEqual(withoutRefusedTag('update', { qr_code_value: 'NIAH-PLT-00042', location_description: 'Moved' }),
    { location_description: 'Moved' });
  // Only the tag: nothing else to send; it stays refused (Sync details can remove it).
  assert.equal(withoutRefusedTag('update', { qr_code_value: 'NIAH-PLT-00042' }), null);
  assert.equal(withoutRefusedTag('create', null), null);
});

test('only the tag refused: the plant shows the tag notice, not "Upload failed" as well', () => {
  const refused = { syncStatus: 'Upload failed', reviewStatus: 'pending', syncError: 'tag_not_yours', tagProblem: 'not_yours' };
  assert.deepEqual(plantStatusLine(refused, 'This tag is not one of yours.'), { kind: 'waiting', text: WAITING_TEXT });
  // Uploaded without the tag: the notice stays until another tag is attached.
  assert.deepEqual(plantStatusLine({ syncStatus: 'Uploaded', reviewStatus: 'pending', tagProblem: 'not_yours' }),
    { kind: 'waiting', text: WAITING_TEXT });
  // Something else failed too: that still shows, with Retry.
  const alsoFailed = { syncStatus: 'Upload failed', reviewStatus: 'pending', syncError: 'The server is busy', tagProblem: 'not_yours' };
  assert.equal(plantStatusLine(alsoFailed).kind, 'failed');
  assert.equal(retryableRecord({ id: 'p1', ...alsoFailed, observations: [] }), true);
  // Only the tag: nothing to retry.
  assert.equal(retryableRecord({ id: 'p2', ...refused, observations: [] }), false);
  // A locked plant keeps its own "Upload failed" line.
  assert.equal(plantStatusLine({ syncStatus: 'Upload failed', syncError: 'plant_locked', tagProblem: 'locked' }).kind, 'failed');
});

test('the outbox keeps the plant uploading and remembers the refusal on the plant', () => {
  const database = read('../services/offlineDatabase.ts');
  const apply = database.slice(database.indexOf('export async function applySyncOperationResult'), database.indexOf('export async function removeLocalProposal'));
  assert.match(apply, /operation\.entity_type === 'plant' && result\.status === 'conflict'\s*\? tagRefusalProblem\(result\.code\)/);
  assert.match(apply, /tagCode: refusedTag && snapshot\.tagCode === refusedTag \? null : snapshot\.tagCode,\s*tagProblem,/);
  assert.match(apply, /const resend = withoutRefusedTag\(operation\.operation_type, payload\);/);
  assert.match(apply, /SET payload_json = \?,\s*status = 'pending'/);
  // The plant reads the kept refusal back.
  assert.match(read('../services/offlineRecordRepository.ts'), /: snapshot\.tagProblem \?\? null,/);
  // Attaching another tag clears it.
  assert.match(read('../store/useRecordStore.ts'), /tagCode,\s*tagProblem: null,/);
});

test('the plant screen shows the notice and its "Attach a different tag" button', () => {
  const detail = read('../../app/plant-detail.tsx');
  assert.match(detail, /const notice = tagNotice\(matched\.tagProblem, matched\.tagCode\);/);
  // The button only when there is one (not for a plant that already has a tag on the server).
  assert.match(detail, /\{notice \? \([\s\S]*?<Text style=\{styles\.tagProblemText\}>\{notice\.text\}<\/Text>[\s\S]*?\{notice\.action \? \([\s\S]*?onPress=\{openAttachTag\}[\s\S]*?\{notice\.action\}/);
  // Its QR (the server's tag) can still be shown.
  assert.match(detail, /if \(matched\.tagProblem && matched\.tagProblem !== 'already_set'\) \{/);
  assert.equal(TAG_CANT_BE_USED_TEXT.not_yours, "This tag can't be used: it isn't one of your reserved tags. Attach a different tag.");
  // The text wraps rather than overflowing.
  assert.match(detail, /tagProblemText: \{[^}]*flexShrink: 1/);
});
