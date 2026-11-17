import { ReviewStatus } from '../store/useRecordStore';
import { reviewOutcome } from './submissionState';

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
  switch (reviewOutcome(reviewStatus, submitted)) {
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
