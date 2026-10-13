import { ReviewStatus } from '../store/useRecordStore';

// Label and colours for each review status, shared by every screen.
export const REVIEW_BADGE: Record<ReviewStatus, { label: string; bg: string; text: string }> = {
  [ReviewStatus.DRAFT]: { label: 'Draft', bg: '#EEF1EF', text: '#4A5A50' },
  [ReviewStatus.PENDING]: { label: 'Waiting for review', bg: '#E3ECF8', text: '#1F4E8C' },
  [ReviewStatus.APPROVED]: { label: 'Approved', bg: '#E4F2E7', text: '#215A36' },
  [ReviewStatus.REJECTED]: { label: 'Needs changes', bg: '#FDE2E2', text: '#9B1C1C' },
};