// The plant detail screen's one status line, and its subtitle under the scientific name.
// Pure (no React Native), so it is tested on its own: src/utils/plantStatusLine.test.mjs.

// The same words as the store's SyncStatus / ReviewStatus values.
const UPLOADED = 'Uploaded';
const FAILED = 'Upload failed';
const LOCAL_ONLY = 'Local only';
const PENDING_REVIEW = 'pending';

export type TagProblemCode = 'in_use' | 'locked' | 'not_yours' | 'already_set';

// Why a tag was refused, as the botanist reads it (the "Upload failed: ..." reason).
export const TAG_PROBLEM_REASON: Record<TagProblemCode, string> = {
  in_use: 'this tag is already attached to another plant',
  not_yours: "this tag isn't one of your reserved tags",
  already_set: 'this plant already has a physical tag on the server',
  locked: "this plant can't be changed after submission",
};

export type PlantStatusLine =
  | { kind: 'waiting'; text: string }
  | { kind: 'not_uploaded'; text: string }
  | { kind: 'failed'; text: string; retry: true }
  | null;

export const WAITING_TEXT = 'Waiting for review';
export const NOT_UPLOADED_TEXT = "Not uploaded yet — it will send when you're online";

// "The server rejected part of this record." -> "the server rejected part of this record"
function reasonText(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, '');
  return trimmed ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : '';
}

/**
 * One message only, from the real state:
 *   - something did not upload        -> "Upload failed: <reason> · Retry"
 *   - something is still to be sent    -> "Not uploaded yet — it will send when you're online"
 *   - on the server, waiting for review -> "Waiting for review"
 *   - otherwise (draft, approved, sent back: the review chip and reason say it) -> null
 */
export function plantStatusLine(record: {
  syncStatus?: string | null;
  reviewStatus?: string | null;
  syncError?: string | null;
  tagProblem?: TagProblemCode | null;
}): PlantStatusLine {
  const sync = String(record.syncStatus ?? '');
  if (sync === FAILED) {
    const reason = record.tagProblem
      ? TAG_PROBLEM_REASON[record.tagProblem]
      : reasonText(record.syncError ?? '') || 'the server refused part of this record';
    return { kind: 'failed', text: `Upload failed: ${reason}`, retry: true };
  }
  // A draft kept on the phone only (not submitted yet) has nothing waiting to send.
  if (sync === LOCAL_ONLY) return null;
  if (sync !== UPLOADED) {
    return record.reviewStatus ? { kind: 'not_uploaded', text: NOT_UPLOADED_TEXT } : null;
  }
  return record.reviewStatus === PENDING_REVIEW ? { kind: 'waiting', text: WAITING_TEXT } : null;
}

const sameWords = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The line under the scientific name, never repeating a word:
 *   "common name · family" when all three differ; otherwise just the family (or the common
 *   name when there is no family), or nothing.
 */
export function speciesSubtitle(scientificName?: string | null, commonName?: string | null, family?: string | null): string {
  const scientific = (scientificName ?? '').trim();
  const common = (commonName ?? '').trim();
  const familyName = (family ?? '').trim();
  const commonUseful = common !== '' && !sameWords(common, scientific);
  const familyUseful = familyName !== '' && !sameWords(familyName, scientific);
  if (commonUseful && familyUseful && !sameWords(common, familyName)) return `${common} · ${familyName}`;
  if (familyUseful) return familyName;
  return commonUseful ? common : '';
}

/**
 * A queued plant update refused as "plant_locked" before tags could be attached after
 * submission: the tag-only payload to send again, or null when it wasn't a tag change.
 */
export function tagOnlyPayload(payload: unknown): { qr_code_value: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const tag = (payload as Record<string, unknown>).qr_code_value;
  return typeof tag === 'string' && /^NIAH-PLT-\d{5}$/.test(tag.trim()) ? { qr_code_value: tag.trim() } : null;
}
