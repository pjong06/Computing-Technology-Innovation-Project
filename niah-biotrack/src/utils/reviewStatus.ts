import { ReviewStatus } from '../store/useRecordStore';
import { newPlantReview, reviewOutcome, waitingVisitsText, type DatedVisit, type ReviewOutcome } from './submissionState';

// Label and colours for each review status, shared by every screen.
export const REVIEW_BADGE: Record<ReviewStatus, { label: string; bg: string; text: string }> = {
  [ReviewStatus.DRAFT]: { label: 'Draft', bg: '#EEF1EF', text: '#4A5A50' },
  [ReviewStatus.PENDING]: { label: 'Waiting for review', bg: '#E3ECF8', text: '#1F4E8C' },
  [ReviewStatus.APPROVED]: { label: 'Approved', bg: '#E4F2E7', text: '#215A36' },
  [ReviewStatus.REJECTED]: { label: 'Needs changes', bg: '#FDE2E2', text: '#9B1C1C' },
};

// Uploaded, but not (yet) sent for review on the server.
export const NOT_SUBMITTED_BADGE = { label: 'Not submitted yet', bg: '#FDF4D8', text: '#8C5E03' };

// The badge for something that has reached the server: the officer's decision.
// Used by My submissions ("Pending") and Home's recent records ("Uploaded · Waiting for
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
// plant is approved but revisits are waiting ("1 visit waiting for review").
// Used by My submissions, Home and the Species tab, so they always agree.
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
