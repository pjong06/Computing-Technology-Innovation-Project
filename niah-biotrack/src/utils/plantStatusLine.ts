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

// A tag the server refused because it can't be used on this plant: shown on the plant itself,
// with "Attach a different tag". The rest of the plant keeps uploading without it.
export const ATTACH_DIFFERENT_TAG = 'Attach a different tag';
export const TAG_CANT_BE_USED_TEXT: Record<'not_yours' | 'in_use', string> = {
  not_yours: "This tag can't be used: it isn't one of your reserved tags. Attach a different tag.",
  in_use: "This tag can't be used: it is already attached to another plant. Attach a different tag.",
};

/**
 * tag_already_set: the plant already has a tag on the server, so no other tag can be
 * attached (no button). The plant is refreshed from the server, which gives the phone that
 * tag: "This plant already has a tag on the server (NIAH-PLT-00042)."
 */
export function alreadySetText(serverTag?: string | null): string {
  const tag = typeof serverTag === 'string' && /^NIAH-PLT-\d{5}$/.test(serverTag.trim()) ? serverTag.trim() : null;
  return tag
    ? `This plant already has a tag on the server (${tag}).`
    : 'This plant already has a tag on the server.';
}

/**
 * The plant's tag notice, or null when its tag wasn't refused this way. action is the
 * button ("Attach a different tag"), or null when another tag can't help (already_set).
 * tagCode: the plant's tag on the phone (the server's, once the plant is refreshed).
 */
export function tagNotice(
  tagProblem?: TagProblemCode | null,
  tagCode?: string | null
): { text: string; action: string | null } | null {
  if (tagProblem === 'not_yours' || tagProblem === 'in_use') {
    return { text: TAG_CANT_BE_USED_TEXT[tagProblem], action: ATTACH_DIFFERENT_TAG };
  }
  if (tagProblem === 'already_set') return { text: alreadySetText(tagCode), action: null };
  return null;
}

/** Whether the plant should be refreshed from the server to learn its tag. */
export function needsServerTag(plant: { tagProblem?: string | null; tagCode?: string | null; serverId?: string | null }): boolean {
  return plant.tagProblem === 'already_set' && Boolean(plant.serverId) &&
    !(typeof plant.tagCode === 'string' && /^NIAH-PLT-\d{5}$/.test(plant.tagCode));
}

// The server's codes for a tag that can't be used here, as the plant's tagProblem.
const TAG_REFUSAL_PROBLEM: Record<string, TagProblemCode> = {
  tag_not_yours: 'not_yours',
  tag_already_set: 'already_set',
  tag_in_use: 'in_use',
};

/** The plant's tagProblem for a refused tag's server code, or null for any other code. */
export function tagRefusalProblem(code?: string | null): TagProblemCode | null {
  return (code && TAG_REFUSAL_PROBLEM[code]) || null;
}

/**
 * A plant operation whose tag was refused: what to send instead so the rest of the plant
 * still uploads, or null when the tag was all it had (a tag-only change).
 *   - create: the same plant without the tag (the server gives it a placeholder until a tag
 *     is attached), so its observations and photos can upload;
 *   - update: the other changed fields, without the tag.
 */
export function withoutRefusedTag(
  operationType: string,
  payload: unknown
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const { qr_code_value: _tag, ...rest } = payload as Record<string, unknown>;
  if (operationType === 'create') return { ...rest, qr_code_value: null };
  if (operationType === 'update' && Object.keys(rest).length > 0) return rest;
  return null;
}

export type PlantStatusLine =
  | { kind: 'waiting'; text: string }
  | { kind: 'not_uploaded'; text: string }
  // retry: false when it can never upload (the text says why; Sync details can remove it).
  | { kind: 'failed'; text: string; retry: boolean }
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
export function plantStatusLine(
  record: {
    syncStatus?: string | null;
    reviewStatus?: string | null;
    syncError?: string | null;
    tagProblem?: TagProblemCode | null;
  },
  // Set when everything that failed can never upload (src/utils/syncDetails.ts): its
  // explanation, and no Retry.
  permanentReason?: string | null
): PlantStatusLine {
  let sync = String(record.syncStatus ?? '');
  // Only the tag was refused (its own notice says so, with "Attach a different tag"): the
  // plant itself is on the server, so no "Upload failed" line as well.
  const syncError = String(record.syncError ?? '');
  if (sync === FAILED && tagNotice(record.tagProblem) && (!syncError || tagRefusalProblem(syncError))) {
    sync = UPLOADED;
  }
  if (sync === FAILED && permanentReason) {
    return { kind: 'failed', text: `Upload failed: ${reasonText(permanentReason)}`, retry: false };
  }
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
 * Plant first, species second (plant detail header, Plants list, Recent activity):
 *   title   - the plant's tag (NIAH-PLT-#####), or "No tag yet";
 *   species - the scientific name (shown italic) and, after " · ", the common name only when
 *             there is one and it differs from the scientific name.
 */
export function plantHeading(tagCode?: string | null, scientificName?: string | null, commonName?: string | null): {
  title: string;
  hasTag: boolean;
  scientific: string;
  common: string | null;
} {
  const tag = (tagCode ?? '').trim();
  const hasTag = /^NIAH-PLT-\d{5}$/.test(tag);
  const scientific = (scientificName ?? '').trim();
  const common = (commonName ?? '').trim();
  return {
    title: hasTag ? tag : 'No tag yet',
    hasTag,
    scientific,
    common: common && !sameWords(common, scientific) ? common : null,
  };
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
