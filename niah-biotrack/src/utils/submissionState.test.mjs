// Tests for src/utils/submissionState.ts. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isVisitSubmitted,
  isRecordSubmitted,
  reviewOutcome,
  recordSubmitProblem,
  applyServerReview,
  oversizedPhotoMessage,
} from './submissionState.ts';

test('a visit uploaded but still draft on the server is not submitted', () => {
  assert.equal(isVisitSubmitted({ serverId: 's1', submissionRequested: true }), false);
  assert.equal(isVisitSubmitted({ serverId: 's1', reviewStatus: 'draft', submittedForReview: true }), false);
  assert.equal(isVisitSubmitted({ serverId: 's1', submittedForReview: true }), true);
  assert.equal(isVisitSubmitted({ serverId: 's1', reviewStatus: 'pending' }), true);
  assert.equal(isVisitSubmitted({ serverId: 's1', reviewStatus: 'rejected' }), true);
});

test('badge: "Not submitted yet" until really submitted; the officer decision wins', () => {
  assert.equal(reviewOutcome(undefined, false), 'not_submitted');
  assert.equal(reviewOutcome('draft', false), 'not_submitted');
  assert.equal(reviewOutcome('pending', false), 'not_submitted'); // local intent only
  assert.equal(reviewOutcome('pending', true), 'pending');
  assert.equal(reviewOutcome(undefined, true), 'pending');
  assert.equal(reviewOutcome('approved', false), 'approved');
  assert.equal(reviewOutcome('archived', true), 'approved');
  assert.equal(reviewOutcome('rejected', true), 'rejected');
});

test('a record is submitted only when it was submitted and every uploaded visit is', () => {
  const sent = { serverId: 'a', submittedForReview: true };
  const draft = { serverId: 'b', reviewStatus: 'draft' };
  const notUploaded = { submissionRequested: true };
  assert.equal(isRecordSubmitted({ reviewStatus: 'pending', observations: [sent, notUploaded] }), true);
  assert.equal(isRecordSubmitted({ reviewStatus: 'pending', observations: [sent, draft] }), false);
  assert.equal(isRecordSubmitted({ reviewStatus: 'draft', observations: [sent] }), false);
});

test('server says draft: a visit meant for review is queued to submit again', () => {
  const thoughtSent = { serverId: 's', submittedForReview: true, reviewStatus: 'pending' };
  const next = applyServerReview(thoughtSent, 'draft', null);
  assert.equal(next.reviewStatus, 'draft');
  assert.equal(next.submittedForReview, false);
  assert.equal(next.submissionRequested, true);
  assert.equal(isVisitSubmitted(next), false);
});

test('server says draft: a visit never meant for review stays a draft and is not queued', () => {
  const visit = { serverId: 's' };
  const next = applyServerReview(visit, 'draft', null);
  assert.equal(next.reviewStatus, 'draft');
  assert.equal(next.submissionRequested, false);
  assert.strictEqual(applyServerReview(next, 'draft', null), next, 'no change the second time');
});

test('server says pending or approved: confirmed, and an old submit error is cleared', () => {
  const visit = { serverId: 's', submissionRequested: true, submitError: 'Photo too big' };
  const pending = applyServerReview(visit, 'pending', null);
  assert.equal(pending.reviewStatus, 'pending');
  assert.equal(pending.submittedForReview, true);
  assert.equal(pending.submitError, null);
  assert.equal(applyServerReview(pending, 'approved', null).reviewStatus, 'approved');
});

test('server says rejected: comment kept, and it must be submitted again', () => {
  const next = applyServerReview({ serverId: 's', submittedForReview: true }, 'rejected', 'Photo is blurry');
  assert.equal(next.reviewStatus, 'rejected');
  assert.equal(next.reviewComment, 'Photo is blurry');
  assert.equal(next.submittedForReview, false);
  // A fixed visit waiting to upload keeps its state until the next sync.
  const fixed = { serverId: 's', reviewStatus: 'rejected', submittedForReview: false, submissionRequested: true };
  assert.strictEqual(applyServerReview(fixed, 'rejected', 'Photo is blurry'), fixed);
});

test('unknown server values change nothing', () => {
  const visit = { serverId: 's', submittedForReview: true };
  assert.strictEqual(applyServerReview(visit, 'something-new', null), visit);
});

test('the first submit problem of a record is shown', () => {
  assert.equal(recordSubmitProblem({ observations: [{ serverId: 'a', submittedForReview: true }] }), null);
  assert.equal(
    recordSubmitProblem({ observations: [{ serverId: 'a', submitError: 'Only draft or rejected observations can be submitted' }] }),
    'Only draft or rejected observations can be submitted'
  );
  // A problem left on a visit that has since been submitted is not shown.
  assert.equal(recordSubmitProblem({ observations: [{ serverId: 'a', reviewStatus: 'pending', submitError: 'old' }] }), null);
});

test('oversized photo message is plain and says what to do', () => {
  assert.equal(
    oversizedPhotoMessage(1),
    'A photo is over 5 MB, so this visit was not sent for review. Remove it on the plant page, then sync again.'
  );
  assert.match(oversizedPhotoMessage(3), /^3 photos are over 5 MB/);
});
