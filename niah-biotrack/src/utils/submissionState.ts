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

export interface DatedVisit extends VisitSubmissionFields {
  observedAt?: string;
  date?: string;
}

// The visit made when the plant was registered on this phone (its "first visit"): the
// visit with the plant's creation time. null when there is none (no visits yet, or a plant
// registered elsewhere and scanned onto this phone). Only records without a creation time
// fall back to the oldest visit (new visits are added to the front of the list, so on a
// tie the last one is the oldest).
export function firstVisitOf<T extends DatedVisit>(record: {
  createdAtIso?: string;
  observations: T[];
}): T | null {
  const visits = record.observations;
  if (visits.length === 0) return null;
  if (record.createdAtIso) {
    // The registration visit has the plant's creation time. A plant cached from the server
    // (scanned; e.g. another botanist's approved plant) has its server registration time
    // and no such visit: this botanist's visits there are revisits, not a "first visit".
    return visits.find((visit) => visit.observedAt === record.createdAtIso) ?? null;
  }
  // Older records without a creation time: the oldest visit.
  const time = (visit: T) => {
    const parsed = Date.parse(visit.observedAt || visit.date || '');
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  };
  let oldest = visits[visits.length - 1];
  for (const visit of visits) {
    if (time(visit) < time(oldest)) oldest = visit;
  }
  return oldest;
}

// The review state of a newly registered plant's single list row: the status of its first
// visit (the plant and that visit are one submission). When the plant is approved and later
// visits (revisits) are waiting, also says how many, e.g. "1 observation waiting for review".
// With no visit yet (an unsubmitted draft) the plant record's own state is used.
export function newPlantReview<T extends DatedVisit>(record: {
  createdAtIso?: string;
  reviewStatus?: string | null;
  observations: T[];
}): { firstVisit: T | null; outcome: ReviewOutcome; waitingRevisits: number } {
  const firstVisit = firstVisitOf(record);
  if (firstVisit === null) {
    return {
      firstVisit,
      outcome: reviewOutcome(record.reviewStatus, isRecordSubmitted(record)),
      waitingRevisits: 0,
    };
  }
  const outcome = reviewOutcome(firstVisit.reviewStatus, isVisitSubmitted(firstVisit));
  const waitingRevisits =
    outcome === 'approved'
      ? record.observations.filter(
          (visit) =>
            visit !== firstVisit &&
            Boolean(visit.serverId) &&
            reviewOutcome(visit.reviewStatus, isVisitSubmitted(visit)) === 'pending'
        ).length
      : 0;
  return { firstVisit, outcome, waitingRevisits };
}

// "1 observation waiting for review" / "2 observations waiting for review".
export function waitingVisitsText(count: number): string {
  return `${count} observation${count === 1 ? '' : 's'} waiting for review`;
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
  return `${photos} over 5 MB, so this observation was not sent for review. Remove ${them} on the plant page, then sync again.`;
}

// A visit photo the server marked "locked" (photos_locked) stays skipped only once the
// visit is waiting for review or approved. While the visit is still a draft or was sent
// back, photos can be added, so the photo is tried again (an older app version marked any
// refusal "locked" and gave up on it for good).
export function isPhotoLockFinal(reviewStatus: string | null | undefined): boolean {
  const status = String(reviewStatus ?? '');
  return status === 'pending' || status === 'approved' || status === 'archived';
}
