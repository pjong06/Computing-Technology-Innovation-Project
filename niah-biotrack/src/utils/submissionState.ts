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

// The plant's first record (its registration): the same rule as the officer Review page,
// the plant's earliest observation (deleted ones are not on the phone). Compared by time,
// not by text, so a visit the server sent back as "...+00:00" still matches a plant
// created at "...Z". On equal times the one further down the list wins (new visits are
// added to the front, so it is the older one); visits without a time count as newest.
// null when there is none: no visits yet, someone else's plant scanned onto this phone
// (its registration was the other botanist's, so this botanist's visits are observations),
// or a plant cached from the server whose registration record isn't on this phone (its
// earliest visit here is long after the plant was registered).
export const REGISTRATION_TOLERANCE_MS = 60 * 1000;

export function firstVisitOf<T extends DatedVisit>(record: {
  createdAtIso?: string;
  otherBotanist?: boolean;
  observations: T[];
}): T | null {
  const visits = record.observations;
  if (visits.length === 0 || record.otherBotanist) return null;
  const time = (visit: T) => {
    const parsed = Date.parse(visit.observedAt || visit.date || '');
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  };
  let oldest = visits[visits.length - 1];
  for (const visit of visits) {
    if (time(visit) < time(oldest)) oldest = visit;
  }
  // The registration record is made at the plant's creation time (the server may send that
  // time in another format or rounded): an earliest visit well after it is an observation.
  const created = Date.parse(record.createdAtIso ?? '');
  if (!Number.isNaN(created) && time(oldest) - created > REGISTRATION_TOLERANCE_MS) return null;
  return oldest;
}

/**
 * Whether the botanist may edit (and send again) this plant's registration ("Edit" /
 * "Edit and resend"): their own plant that is a draft, or that the officer sent back
 * ("Needs changes": the plant, or its registration record, is 'rejected'). Never while it is
 * waiting for review or once approved, and never someone else's plant.
 */
export function canEditRegistration<T extends DatedVisit & { reviewStatus?: string | null }>(record: {
  reviewStatus?: string | null;
  createdAtIso?: string;
  otherBotanist?: boolean;
  observations: T[];
}): boolean {
  if (record.otherBotanist) return false;
  const plant = String(record.reviewStatus ?? '');
  if (plant === 'approved' || plant === 'archived') return false;
  const first = firstVisitOf(record);
  const registration = String(first?.reviewStatus ?? '');
  // Its registration is waiting for review or approved: locked, whatever the plant says.
  if (registration === 'pending' || registration === 'approved') return false;
  if (plant === 'draft' || plant === 'rejected' || plant === '') return true;
  // The plant is still 'pending' on the server while the officer sent its registration back.
  return registration === 'rejected';
}

/**
 * The plant's observations with its registration record replaced by `visit` (the same id),
 * leaving every later observation as it is. Without a registration record on the phone,
 * `visit` becomes it (added after the others: the oldest).
 */
export function withRegistration<T extends DatedVisit & { id: string }>(
  record: { createdAtIso?: string; otherBotanist?: boolean; observations: T[] },
  visit: T
): T[] {
  const first = firstVisitOf(record);
  if (!first) return [...record.observations, visit];
  return record.observations.map((item) => (item.id === first.id ? visit : item));
}

// A plant's rows in Recent activity: ONE "NEW PLANT" row for registering it (the plant
// together with its first record, which is its registration), then an "OBSERVATION" row for
// each later record. Someone else's plant has no NEW PLANT row: all of this botanist's
// records there are observations.
export function plantActivityEntries<T extends DatedVisit & { id?: string }>(record: {
  createdAtIso?: string;
  otherBotanist?: boolean;
  observations: T[];
}): { type: 'new_plant' | 'observation'; visit: T | null }[] {
  const first = firstVisitOf(record);
  const entries: { type: 'new_plant' | 'observation'; visit: T | null }[] = record.otherBotanist
    ? []
    : [{ type: 'new_plant', visit: first }];
  for (const visit of record.observations) {
    if (visit === first || !visit.id) continue;
    entries.push({ type: 'observation', visit });
  }
  return entries;
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
