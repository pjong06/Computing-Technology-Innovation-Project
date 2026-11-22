// The actions a row offers when it needs the botanist (Recent activity, the Plants list and
// plant detail Observations), so all three offer the same ones:
//   - "Not submitted yet" (on the server as a draft): Send for review, Edit; when its plant
//     (or the observation) no longer exists on the server: Remove from phone instead;
//   - "Needs changes" (sent back): Edit and resend;
//   - "Upload failed": Retry when trying again can help, Remove from phone when it never can
//     (the same rules as Sync details: src/utils/syncDetails.ts).
// Pure (no React Native): tested by src/utils/rowActions.test.mjs.

export type RowActionKind = 'send_for_review' | 'edit' | 'edit_resend' | 'retry' | 'remove';

export const ROW_ACTION_LABELS: Record<RowActionKind, string> = {
  send_for_review: 'Send for review',
  edit: 'Edit',
  edit_resend: 'Edit and resend',
  retry: 'Retry',
  remove: 'Remove from phone',
};

export function rowActions(input: {
  // The row's status action: 'not_submitted' | 'needs_changes' | 'upload_failed' | ...
  action: string | null | undefined;
  // For "Upload failed": at least one of its problems can change by trying again.
  retryable: boolean;
  // Its plant or observation no longer exists on the server (never uploads).
  gone: boolean;
}): RowActionKind[] {
  switch (input.action) {
    case 'not_submitted':
      return input.gone ? ['remove'] : ['send_for_review', 'edit'];
    case 'needs_changes':
      return ['edit_resend'];
    case 'upload_failed':
      return input.retryable && !input.gone ? ['retry'] : ['remove'];
    default:
      return [];
  }
}

export const NO_REASON_TEXT = 'Sent back by the officer (no reason given)';

/** "Officer's reason: …", or "Sent back by the officer (no reason given)". */
export function officerReasonText(reason: string | null | undefined): string {
  const text = (reason ?? '').trim();
  return text ? `Officer's reason: ${text}` : NO_REASON_TEXT;
}

// Server answers meaning the plant or the observation no longer exists there.
const GONE_CODES = new Set(['plant_deleted', 'observation_deleted']);

/** Whether a refused submit (or photo) says the plant or observation is gone. */
export function isGoneCode(code: string | null | undefined): boolean {
  return GONE_CODES.has(String(code ?? ''));
}
