// TC-APP-24 Edit and resend: a registration the officer sent back ("Needs changes") can be
// edited and sent again by its owner; one waiting for review or approved can't.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canEditRegistration, withRegistration } from './submissionState.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

const created = '2026-11-20T08:00:00.000Z';
const registration = (reviewStatus) => ({ id: 'o-reg', observedAt: created, reviewStatus });
const later = (reviewStatus) => ({ id: 'o-later', observedAt: '2026-11-25T08:00:00.000Z', reviewStatus });
const plant = (reviewStatus, observations, extra = {}) => ({ reviewStatus, createdAtIso: created, observations, ...extra });

test('sent back: the plant stays "pending" on the server while its registration is rejected', () => {
  // The bug: this was refused as "only local draft can be edited".
  assert.equal(canEditRegistration(plant('pending', [registration('rejected')])), true);
  // With later observations on the phone too (newest first).
  assert.equal(canEditRegistration(plant('pending', [later('approved'), registration('rejected')])), true);
  // The plant itself sent back.
  assert.equal(canEditRegistration(plant('rejected', [registration('rejected')])), true);
  // A draft, as before.
  assert.equal(canEditRegistration(plant('draft', [registration('draft')])), true);
  assert.equal(canEditRegistration(plant('draft', [])), true);
});

test('waiting for review or approved: still locked', () => {
  assert.equal(canEditRegistration(plant('pending', [registration('pending')])), false);
  assert.equal(canEditRegistration(plant('pending', [registration('approved')])), false);
  assert.equal(canEditRegistration(plant('approved', [registration('approved')])), false);
  assert.equal(canEditRegistration(plant('approved', [registration('rejected')])), false);
  assert.equal(canEditRegistration(plant('archived', [registration('rejected')])), false);
  // Resent already (waiting again), even if the phone still has the plant as rejected.
  assert.equal(canEditRegistration(plant('rejected', [registration('pending')])), false);
  // Someone else's plant.
  assert.equal(canEditRegistration(plant('pending', [registration('rejected')], { otherBotanist: true })), false);
});

test('the edit replaces the registration record, not the newest observation', () => {
  const record = plant('pending', [later('approved'), registration('rejected')]);
  const edited = { id: 'o-reg', observedAt: created, reviewStatus: 'draft', notes: 'fixed' };
  assert.deepEqual(withRegistration(record, edited).map((visit) => [visit.id, visit.reviewStatus]), [
    ['o-later', 'approved'],
    ['o-reg', 'draft'],
  ]);
});

test('the store and the screen use the same rule; the message is plain', () => {
  const store = read('../store/useRecordStore.ts');
  const update = store.slice(store.indexOf('        updateRecord:'), store.indexOf('        cacheServerRecord:'));
  assert.match(update, /if \(!canEditRegistration\(current\)\) \{\s*return null;\s*\}/);
  assert.doesNotMatch(update, /ReviewStatus\.DRAFT &&\s*current\.reviewStatus !==\s*ReviewStatus\.REJECTED/);

  const screen = read('../../app/new-record.tsx');
  assert.match(screen, /const previousInitialVisit = existingRecord \? firstVisitOf\(existingRecord\) \?\? undefined : undefined;/);
  assert.match(screen, /\? withRegistration\(existingRecord, initialVisit\)/);
  assert.match(screen, /canEditRegistration\(existingRecord\)\s*\? await updateRecord\(existingRecord\.id, recordData\)/);
  assert.doesNotMatch(screen, /Only local drafts can be edited/);
  // The form starts from the registration record's own values.
  assert.match(screen, /useState<LifeStage>\(firstRecordOfPlant\?\.stage \?\? 'Mature'\)/);
});
