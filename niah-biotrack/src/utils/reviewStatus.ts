import { ReviewStatus } from '../store/useRecordStore';
import {
  isVisitSubmitted,
  newPlantReview,
  reviewOutcome,
  waitingVisitsText,
  type DatedVisit,
  type ReviewOutcome,
  type VisitSubmissionFields,
} from './submissionState';
import { rowStatus, type NeedsActionReason, type RecordStatusGroup } from './recordsList';
import { officerReasonText } from './rowActions';

// Label and colours for each review status, shared by every screen.
export const REVIEW_BADGE: Record<ReviewStatus, { label: string; bg: string; text: string }> = {
  [ReviewStatus.DRAFT]: { label: 'Not submitted yet', bg: '#EEF1EF', text: '#4A5A50' },
  [ReviewStatus.PENDING]: { label: 'Waiting for review', bg: '#E3ECF8', text: '#1F4E8C' },
  [ReviewStatus.APPROVED]: { label: 'Approved', bg: '#E4F2E7', text: '#215A36' },
  [ReviewStatus.REJECTED]: { label: 'Needs changes', bg: '#FDE2E2', text: '#9B1C1C' },
};

// Uploaded, but not (yet) sent for review on the server.
export const NOT_SUBMITTED_BADGE = { label: 'Not submitted yet', bg: '#FDF4D8', text: '#8C5E03' };

// The badge for something that has reached the server: the officer's decision.
// Used by Records ("Waiting for review") and Home's recent records ("Uploaded · Waiting for
// review"), so both screens always agree. Archived plants count as approved.
// `submitted` is false when the server still has it as a draft (see submissionState.ts):
// then it shows "Not submitted yet", never "Pending".
export function reviewOutcomeBadge(
  reviewStatus: string | null | undefined,
  pendingLabel: string,
  submitted = true
): { label: string; bg: string; text: string } {
  return outcomeBadge(reviewOutcome(reviewStatus, submitted), pendingLabel);
}

// The badge for each outcome. pendingLabel is the screen's word for "waiting for review".
function outcomeBadge(outcome: ReviewOutcome, pendingLabel: string): { label: string; bg: string; text: string } {
  switch (outcome) {
    case 'rejected':
      return REVIEW_BADGE[ReviewStatus.REJECTED];
    case 'approved':
      return REVIEW_BADGE[ReviewStatus.APPROVED];
    case 'not_submitted':
      return NOT_SUBMITTED_BADGE;
    default:
      return { ...REVIEW_BADGE[ReviewStatus.PENDING], label: pendingLabel };
  }
}

// The badge for an uploaded plant registered on this phone: the status of its first visit
// (registering a plant and its first visit are one submission), plus a small note when the
// plant is approved but revisits are waiting ("1 observation waiting for review").
// Used by Records and Home, so they always agree.
export function plantReviewBadge<T extends DatedVisit>(
  record: { createdAtIso?: string; reviewStatus?: string | null; observations: T[] },
  pendingLabel: string
): { badge: { label: string; bg: string; text: string }; waitingNote: string | null; firstVisit: T | null } {
  const { firstVisit, outcome, waitingRevisits } = newPlantReview(record);
  return {
    badge: outcomeBadge(outcome, pendingLabel),
    waitingNote: waitingRevisits > 0 ? waitingVisitsText(waitingRevisits) : null,
    firstVisit,
  };
}

// Upload-side statuses for the Records list, in the same palette.
export const UPLOAD_FAILED_BADGE = { label: 'Upload failed', bg: '#FDE2E2', text: '#9B1C1C' };
export const NEEDS_SPECIES_BADGE = { label: 'Needs species', bg: '#FDF4D8', text: '#8C5E03' };
export const NOT_UPLOADED_BADGE = { label: 'Not uploaded', bg: '#EEF1EF', text: '#4A5A50' };

// The one badge a Records row shows: an upload problem or "Not uploaded" first, otherwise
// the officer's decision (reviewBadge, from reviewOutcomeBadge / plantReviewBadge).
export function recordRowBadge(
  status: { group: string; action: string | null },
  reviewBadge: { label: string; bg: string; text: string }
): { label: string; bg: string; text: string } {
  if (status.action === 'upload_failed') return UPLOAD_FAILED_BADGE;
  if (status.action === 'needs_species') return NEEDS_SPECIES_BADGE;
  if (status.group === 'not_uploaded') return NOT_UPLOADED_BADGE;
  return reviewBadge;
}

// The line under a row or visit: the officer's reason first, then why it is stuck.
export function statusReason(
  action: NeedsActionReason | null,
  officerReason: string | null | undefined,
  submitError: string | null | undefined,
  syncError: string | null | undefined
): string | null {
  // "Officer's reason: …", or "Sent back by the officer (no reason given)".
  if (action === 'needs_changes') return officerReasonText(officerReason);
  if (action === 'upload_failed') return `Upload failed: ${syncError?.trim() || 'Tap Sync now to try again.'}`;
  if (action === 'not_submitted' && submitError) return `Not sent for review: ${submitError}`;
  if (action === 'needs_species') return 'Choose the species to finish this record.';
  return null;
}

// One visit's status, badge and reason: used by the Plants tab (to pick each plant's most
// urgent status) and by Plant detail (on each visit in the history), so both agree.
export function visitStatus(
  visit: VisitSubmissionFields & { syncStatus: string },
  syncError?: string | null
): {
  group: RecordStatusGroup;
  action: NeedsActionReason | null;
  badge: { label: string; bg: string; text: string };
  reason: string | null;
} {
  const submitted = isVisitSubmitted(visit);
  const status = rowStatus({ syncStatus: visit.syncStatus, outcome: reviewOutcome(visit.reviewStatus, submitted) });
  return {
    ...status,
    badge: recordRowBadge(status, reviewOutcomeBadge(visit.reviewStatus, 'Waiting for review', submitted)),
    reason: statusReason(status.action, visit.reviewComment, submitted ? null : visit.submitError, syncError),
  };
}
