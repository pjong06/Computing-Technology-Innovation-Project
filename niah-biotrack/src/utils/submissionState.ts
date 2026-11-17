// submissionState.ts - is a field visit really sent for review, and what should the
// botanist see? Plain TypeScript with no imports, so Node can test it directly
// (src/utils/submissionState.test.mjs). Review statuses are the server's words:
// 'draft' (saved, not sent for review), 'pending' (waiting for the officer),
// 'approved', 'rejected'; 'archived' plants count as approved.

export interface VisitSubmissionFields {
  serverId?: string;
  submissionRequested?: boolean;
  submittedForReview?: boolean;
  reviewStatus?: string | null;
  reviewComment?: string | null;
  // Why the server (or the phone) could not send this visit for review, in plain words.
  submitError?: string | null;
}

const SENT_FOR_REVIEW = new Set(['pending', 'approved', 'rejected', 'archived']);

// True once the server has the visit as sent for review (or reviewed). A visit that is
// uploaded but still 'draft' on the server is NOT submitted.
export function isVisitSubmitted(visit: VisitSubmissionFields): boolean {
  if (visit.reviewStatus === 'draft') return false;
  return visit.submittedForReview === true || SENT_FOR_REVIEW.has(String(visit.reviewStatus ?? ''));
}

// A plant record counts as submitted when the botanist submitted it and every visit the
// server already has is submitted too.
export function isRecordSubmitted(record: {
  reviewStatus?: string | null;
  observations: VisitSubmissionFields[];
}): boolean {
  if (String(record.reviewStatus ?? '') === 'draft') return false;
  return record.observations
    .filter((visit) => Boolean(visit.serverId))
    .every(isVisitSubmitted);
}

export type ReviewOutcome = 'not_submitted' | 'pending' | 'approved' | 'rejected';

// What to show for something that has reached the server. The officer's decision wins;
// otherwise it is "waiting for review" only when it was really submitted.
export function reviewOutcome(reviewStatus: string | null | undefined, submitted: boolean): ReviewOutcome {
  const review = String(reviewStatus ?? '');
  if (review === 'rejected') return 'rejected';
  if (review === 'approved' || review === 'archived') return 'approved';
  return submitted ? 'pending' : 'not_submitted';
}

// The first problem stopping a visit of this record from being sent for review, if any.
export function recordSubmitProblem(record: { observations: VisitSubmissionFields[] }): string | null {
  const visit = record.observations.find((item) => item.submitError && !isVisitSubmitted(item));
  return visit?.submitError ?? null;
}

// Applies the server's review status (GET /api/observations/review-status) to a visit.
// Returns the same object when nothing changes.
//   'draft':    not sent for review. A visit the botanist meant to submit is queued for
//               the submit step again on the next sync.
//   'pending' / 'approved': confirmed as submitted.
//   'rejected': needs changes; resubmitting must send it again.
export function applyServerReview<T extends VisitSubmissionFields>(
  visit: T,
  serverStatus: string,
  rejectionComment: string | null
): T {
  if (serverStatus === 'draft') {
    const shouldSubmit = Boolean(visit.submissionRequested || visit.submittedForReview);
    if (visit.reviewStatus === 'draft' && !visit.submittedForReview && Boolean(visit.submissionRequested) === shouldSubmit) {
      return visit;
    }
    return {
      ...visit,
      reviewStatus: 'draft',
      reviewComment: null,
      submittedForReview: false,
      submissionRequested: shouldSubmit,
    };
  }

  if (serverStatus !== 'pending' && serverStatus !== 'approved' && serverStatus !== 'rejected') {
    return visit; // unknown value: keep what the phone shows
  }

  // A rejected visit the botanist has fixed but not uploaded yet keeps its new state
  // until the next sync (the server still shows the old decision).
  if (serverStatus === 'rejected' && visit.reviewStatus === 'rejected' && !visit.submittedForReview) {
    return visit;
  }

  const comment = serverStatus === 'rejected' ? rejectionComment : null;
  const submittedForReview = serverStatus !== 'rejected';
  if (
    visit.reviewStatus === serverStatus &&
    (visit.reviewComment ?? null) === comment &&
    Boolean(visit.submittedForReview) === submittedForReview &&
    !visit.submitError
  ) {
    return visit;
  }
  return {
    ...visit,
    reviewStatus: serverStatus,
    reviewComment: comment,
    submittedForReview,
    submitError: null,
  };
}

// The message for a visit held back because a photo is over 5 MB.
export function oversizedPhotoMessage(count: number): string {
  const photos = count === 1 ? 'A photo is' : `${count} photos are`;
  const them = count === 1 ? 'it' : 'them';
  return `${photos} over 5 MB, so this visit was not sent for review. Remove ${them} on the plant page, then sync again.`;
}
