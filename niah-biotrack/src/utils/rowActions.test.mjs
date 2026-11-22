// Tests for src/utils/rowActions.ts: which actions a row that needs the botanist offers, for
// each status, and the wiring in Recent activity, the Plants list and plant detail.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_REASON_TEXT, ROW_ACTION_LABELS, isGoneCode, officerReasonText, rowActions } from './rowActions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');
const labels = (actions) => actions.map((action) => ROW_ACTION_LABELS[action]);

test('"Not submitted yet": Send for review and Edit; Remove from phone when its plant is gone', () => {
  assert.deepEqual(labels(rowActions({ action: 'not_submitted', retryable: true, gone: false })), ['Send for review', 'Edit']);
  assert.deepEqual(labels(rowActions({ action: 'not_submitted', retryable: false, gone: false })), ['Send for review', 'Edit']);
  assert.deepEqual(labels(rowActions({ action: 'not_submitted', retryable: true, gone: true })), ['Remove from phone']);
  assert.equal(isGoneCode('plant_deleted'), true);
  assert.equal(isGoneCode('observation_deleted'), true);
  assert.equal(isGoneCode('submit_refused'), false);
  assert.equal(isGoneCode(null), false);
});

test('"Needs changes": Edit and resend', () => {
  assert.deepEqual(labels(rowActions({ action: 'needs_changes', retryable: false, gone: false })), ['Edit and resend']);
});

test('"Upload failed": Retry when temporary, Remove from phone when permanent', () => {
  assert.deepEqual(labels(rowActions({ action: 'upload_failed', retryable: true, gone: false })), ['Retry']);
  assert.deepEqual(labels(rowActions({ action: 'upload_failed', retryable: false, gone: false })), ['Remove from phone']);
  assert.deepEqual(labels(rowActions({ action: 'upload_failed', retryable: true, gone: true })), ['Remove from phone']);
});

test('rows that need nothing from the botanist have no actions', () => {
  for (const action of [null, undefined, 'needs_species', 'waiting', 'approved']) {
    assert.deepEqual(rowActions({ action, retryable: true, gone: false }), [], String(action));
  }
});

test('a sent-back record without a reason says so plainly', () => {
  assert.equal(officerReasonText('Photo is blurred.'), "Officer's reason: Photo is blurred.");
  assert.equal(officerReasonText('  '), 'Sent back by the officer (no reason given)');
  assert.equal(officerReasonText(null), NO_REASON_TEXT);
  assert.match(read('reviewStatus.ts'), /if \(action === 'needs_changes'\) return officerReasonText\(officerReason\);/);
  const detail = read('../../app/plant-detail.tsx');
  assert.doesNotMatch(detail, /No reason was given/);
  assert.match(detail, /<Text style=\{styles\.commentTitle\}>\{NO_REASON_TEXT\}<\/Text>/);
});

test('wiring: the same actions in Recent activity, the Plants list and plant detail Observations', () => {
  const activity = read('../components/RecentActivity.tsx');
  assert.match(activity, /actions: rowActions\(\{ action: status\.action, retryable: plantRetryable, gone: plantGone \}\),/);
  assert.match(activity, /actions: rowActions\(\{ action: status\.action, retryable: retryableRecord\(record, visit\.id\), gone: visitGone \}\),/);
  assert.match(activity, /<RowActions\s+actions=\{item\.actions\}/);
  const list = read('../../app/(tabs)/records.tsx');
  assert.match(list, /actions: record\.otherBotanist \? \[\] : rowActions\(\{ action: pick\.action, retryable: pick\.retryable, gone: pick\.gone \}\),/);
  assert.match(list, /<RowActions\s+actions=\{item\.actions\}/);
  const detail = read('../../app/plant-detail.tsx');
  assert.match(detail, /: rowActions\(\{ action: status\.action, retryable: retryableRecord\(matched, observation\.id\), gone \}\);/);
  assert.match(detail, /isRegistration=\{observation === registrationVisit\}/);

  // The shared buttons: wrap, never overflow; Remove asks first; edits open the right form.
  const actions = read('../components/RowActions.tsx');
  assert.match(actions, /actions: \{ flexDirection: 'row', flexWrap: 'wrap'/);
  assert.match(actions, /Alert\.alert\(\s*'Remove from phone\?'/);
  assert.match(actions, /pathname: '\/new-record', params: \{ editId: recordId/);
  assert.match(actions, /pathname: '\/add-observation',\s*params: \{ plantId: recordId, editObservationId: obsId/);
  assert.match(actions, /showResult\(await requestSubmit\(recordId, obsId\), 'Sent for review'\);/);
  assert.match(actions, /await removePermanentProblems\(recordId, obsId\);/);

  // Edit and resend: the officer's reason at the top; saving sends it for review again.
  const observationForm = read('../../app/add-observation.tsx');
  assert.match(observationForm, /officerReasonText\(editing\.reviewComment\)/);
  assert.match(observationForm, /await editObservation\(plant\.id, editing\.id, \{/);
  assert.match(read('../../app/new-record.tsx'), /\{sentBack \? 'Save and resend' : 'Save and submit'\}/);
  const store = read('../store/useRecordStore.ts');
  assert.match(store, /submissionRequested: true,\s*submittedForReview: false,\s*submitError: null,\s*submitCode: null,/);
});
