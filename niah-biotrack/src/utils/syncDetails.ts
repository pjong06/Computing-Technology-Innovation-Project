// Sync details (Profile > Sync details): what each item still waiting to upload is, the
// server's last answer as a short code, and a plain explanation. Pure (no React Native),
// tested by src/utils/syncDetails.test.mjs.

export type SyncItemKind = 'plant' | 'observation' | 'photo' | 'submit' | 'tag' | 'species_request';

export const KIND_LABELS: Record<SyncItemKind, string> = {
  plant: 'Plant',
  observation: 'Observation',
  photo: 'Photo',
  submit: 'Observation for review',
  tag: 'Tag',
  species_request: 'Species request',
};

// What the server (or the connection) last said, and what it means for the botanist.
// final = sending it again can never work, so "Remove from phone" is offered.
export const SYNC_ANSWERS: Record<string, { explanation: string; final: boolean }> = {
  waiting: { explanation: "Not sent yet. It will upload on the next sync.", final: false },
  network: { explanation: "The phone couldn't reach the server. It will try again when you're online.", final: false },
  server_unavailable: { explanation: 'The server was busy or down. It will try again by itself.', final: false },
  no_result: { explanation: "The server didn't answer for this item. It will try again.", final: false },
  plant_locked: {
    explanation: "This plant was already submitted, so the server won't accept changes to it (only a tag can still be attached).",
    final: true,
  },
  tag_not_yours: {
    explanation: "This tag isn't one of your reserved tags. Attach one of your own tags from My QR tags.",
    final: true,
  },
  tag_already_set: { explanation: 'This plant already has a physical tag on the server.', final: true },
  tag_in_use: { explanation: 'This tag is already attached to another plant. Attach a different tag.', final: true },
  version_conflict: {
    explanation: 'The plant was changed on the server since this phone last downloaded it. Download updates, then check it.',
    final: true,
  },
  photo_refused: { explanation: 'The photo is over 5 MB, so the server refused it. Take a smaller photo.', final: true },
  photos_locked: { explanation: "This plant was already reviewed, so this photo can't be added.", final: true },
  observation_locked: { explanation: "This observation was already reviewed, so this photo can't be added.", final: true },
  photo_missing: { explanation: 'The photo file is no longer on this phone.', final: true },
  plant_deleted: { explanation: 'This plant was removed on the server.', final: true },
  observation_deleted: { explanation: 'This observation was removed on the server.', final: true },
  submit_refused: { explanation: "The server won't send this observation for review. Contact the officer.", final: true },
  permission_denied: { explanation: "Your account isn't allowed to make this change.", final: true },
  invalid_species: { explanation: 'The chosen species is not in the approved species list.', final: true },
  not_found: { explanation: 'The server no longer has this record (it may have been deleted).', final: true },
  plant_not_found: { explanation: "The plant for this observation isn't on the server.", final: true },
  invalid_operation: { explanation: 'The server could not read this change.', final: true },
  refused: { explanation: 'The server refused this change.', final: true },
};

const TAG_REFUSALS = new Set(['plant_locked', 'tag_not_yours', 'tag_already_set', 'tag_in_use']);

/** What a queued change is: a tag-only plant update is a "Tag". */
export function outboxItemKind(entityType: string, payload: unknown): SyncItemKind {
  if (entityType === 'proposal') return 'species_request';
  if (entityType === 'observation') return 'observation';
  const keys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
  return keys.length === 1 && keys[0] === 'qr_code_value' ? 'tag' : 'plant';
}

/**
 * The server's last answer as a code: the stored code, else one read from the stored
 * message (older rows kept only the message), else the outbox status.
 */
export function answerCode(lastCode: string | null | undefined, lastError: string | null | undefined, status: string): string {
  if (lastCode) return lastCode;
  const error = String(lastError ?? '');
  if (TAG_REFUSALS.has(error)) return error;
  if (/changed (on the server|while it was being synced)/i.test(error)) return 'version_conflict';
  if (/network|internet|connection|reach the server/i.test(error)) return 'network';
  if (/not permitted/i.test(error)) return 'permission_denied';
  if (/could not be processed yet|unavailable/i.test(error)) return 'server_unavailable';
  if (status === 'pending' || status === 'processing') return 'waiting';
  if (status === 'retry') return 'server_unavailable';
  if (status === 'conflict') return 'version_conflict';
  return 'refused';
}

export function explainAnswer(code: string): { explanation: string; final: boolean } {
  if (SYNC_ANSWERS[code]) return SYNC_ANSWERS[code];
  // An HTTP status the server answered with (http_404, http_500, ...).
  const http = /^http_(\d{3})$/.exec(code);
  if (http) {
    const status = Number(http[1]);
    return status >= 500 || status === 408 || status === 429
      ? SYNC_ANSWERS.server_unavailable
      : { explanation: `The server refused the upload (error ${status}).`, final: false };
  }
  return SYNC_ANSWERS.refused;
}

/** "NIAH-PLT-00042 · Nepenthes ampullaria", or whichever of the two is known. */
export function itemTitle(tag: string | null | undefined, name: string | null | undefined): string {
  const realTag = typeof tag === 'string' && /^NIAH-PLT-\d{5}$/.test(tag) ? tag : '';
  return [realTag, (name ?? '').trim()].filter(Boolean).join(' · ') || 'Unnamed record';
}

export interface SyncDetailItem {
  key: string;
  kind: SyncItemKind;
  kindLabel: string;
  title: string;
  attempts: number | null; // null: not counted (photos upload with their plant)
  code: string;
  explanation: string;
  final: boolean; // can never upload: "Remove from phone" is offered
}

/**
 * One outbox row as Sync details shows it. plant: the plant it belongs to (for an
 * observation, its parent plant) when the phone has it.
 */
export function describeOutboxRow(
  row: {
    operationId: string;
    entityType: string;
    status: string;
    attempts: number;
    lastError: string | null;
    lastCode: string | null;
    payload: unknown;
    snapshot: Record<string, unknown> | null;
  },
  plant?: { tagCode?: string | null; scientificName?: string | null } | null
): SyncDetailItem {
  const kind = outboxItemKind(row.entityType, row.payload);
  const code = answerCode(row.lastCode, row.lastError, row.status);
  const answer = explainAnswer(code);
  const snapshot = row.snapshot ?? {};
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const payloadTag = row.payload && typeof row.payload === 'object' ? text((row.payload as Record<string, unknown>).qr_code_value) : null;
  const title =
    kind === 'species_request'
      ? text(snapshot.scientificName) ?? 'Unnamed species request'
      : itemTitle(
          kind === 'tag' ? payloadTag : plant?.tagCode ?? text(snapshot.tagCode),
          plant?.scientificName ?? text(snapshot.scientificName)
        );
  return {
    key: `outbox:${row.operationId}`,
    kind,
    kindLabel: KIND_LABELS[kind],
    title,
    attempts: row.attempts,
    code,
    explanation: answer.explanation,
    // Only an answer that was really received counts as final (not one still waiting).
    final: answer.final && row.status !== 'pending' && row.status !== 'processing',
  };
}

/** "1 attempt" / "3 attempts" / "Not tried yet". */
export function attemptsText(attempts: number): string {
  if (!attempts) return 'Not tried yet';
  return `${attempts} attempt${attempts === 1 ? '' : 's'}`;
}

// ---- Problems outside the outbox ----
// The parts of a plant record that can make sync fail OUTSIDE the outbox: photo uploads
// (plant photos and observation photos) and the observation "submit for review" step.
// Each problem has the server's answer as a code, a plain explanation and whether it can
// never succeed (final: no Retry, "Remove from phone" instead). Used by Sync details, the
// sync summary counts and the Retry upload buttons, so all three agree.
// Tested by src/utils/syncProblems.test.mjs.

const UPLOADED = 'Uploaded';
const FAILED = 'Upload failed';

export interface PhotoEntryLike {
  id: string;
  uri: string;
  syncStatus?: string;
  lastError?: string;
  lastCode?: string;
}

export interface PhotoMetaLike {
  uploaded?: boolean;
  problem?: 'too_large' | 'locked' | 'missing' | 'gone';
}

export interface VisitLike {
  id: string;
  date?: string;
  submissionRequested?: boolean;
  submittedForReview?: boolean;
  submitError?: string | null;
  submitCode?: string | null;
  photoUris?: string[];
  photoMeta?: Record<string, PhotoMetaLike>;
}

export interface ProblemRecordLike {
  id: string;
  tagCode?: string | null;
  scientificName?: string;
  syncStatus?: string;
  tagProblem?: string | null;
  photoEntries?: PhotoEntryLike[];
  photoUris?: string[];
  photoMeta?: Record<string, PhotoMetaLike>;
  observations: VisitLike[];
}

export interface RecordProblem {
  key: string;
  kind: 'photo' | 'submit';
  code: string;
  explanation: string;
  final: boolean;
  recordId: string;
  obsId?: string;
  uri?: string;
}

// Codes whose answer is permanent for photos and submits.
export const PLANT_GONE_CODES = new Set(['plant_deleted']);

/** A plant photo's last answer as a code (older entries kept only the message). */
export function plantPhotoCode(entry: PhotoEntryLike): string | null {
  if (entry.lastCode) return entry.lastCode;
  const message = String(entry.lastError ?? '').toLowerCase();
  if (!message) return null;
  if (message.includes("can't be added after submission") || message.includes('photos_locked')) return 'photos_locked';
  if (message.includes('removed on the server')) return 'plant_deleted';
  if (message.includes('5 mb') || message.includes('too large') || message.includes('413')) return 'photo_refused';
  if (message.includes('reach the server') || message.includes('connection')) return 'network';
  return 'server_unavailable';
}

function observationPhotoCode(meta: PhotoMetaLike): string | null {
  switch (meta.problem) {
    case 'too_large':
      return 'photo_refused';
    case 'locked':
      return 'observation_locked';
    case 'missing':
      return 'photo_missing';
    case 'gone':
      return 'plant_deleted';
    default:
      return null;
  }
}

/** A refused submit's code (older observations kept only the message). */
export function submitCodeOf(visit: VisitLike): string | null {
  if (visit.submitCode) return visit.submitCode;
  const message = String(visit.submitError ?? '');
  if (!message) return null;
  // Held back by an oversized photo: the photo itself is the problem (listed on its own).
  if (/over 5 MB/i.test(message)) return null;
  if (/plant was removed/i.test(message)) return 'plant_deleted';
  if (/observation was removed|observation not found/i.test(message)) return 'observation_deleted';
  return 'submit_refused';
}

/** Everything about this record that can make sync fail, apart from the outbox. */
export function recordSyncProblems(record: ProblemRecordLike): RecordProblem[] {
  const problems: RecordProblem[] = [];
  const add = (problem: Omit<RecordProblem, 'explanation' | 'final'>) => {
    const answer = explainAnswer(problem.code);
    problems.push({ ...problem, explanation: answer.explanation, final: answer.final });
  };

  // Plant photos: refused (Upload failed), or tried and still waiting after an error.
  for (const entry of record.photoEntries ?? []) {
    if (entry.syncStatus === UPLOADED) continue;
    const code = plantPhotoCode(entry);
    if (!code) continue;
    if (entry.syncStatus !== FAILED && !entry.lastError) continue;
    add({ key: `photo:${record.id}:${entry.id}`, kind: 'photo', code, recordId: record.id, uri: entry.uri });
  }
  // Older plant photos (photoMeta only, no entry).
  const entryUris = new Set((record.photoEntries ?? []).map((entry) => entry.uri));
  for (const uri of record.photoUris ?? []) {
    if (entryUris.has(uri)) continue;
    const meta = record.photoMeta?.[uri];
    const code = meta && !meta.uploaded ? observationPhotoCode(meta) : null;
    if (!code) continue;
    add({ key: `photo:${record.id}:${uri}`, kind: 'photo', code: code === 'observation_locked' ? 'photos_locked' : code, recordId: record.id, uri });
  }

  for (const visit of record.observations ?? []) {
    for (const uri of visit.photoUris ?? []) {
      const meta = visit.photoMeta?.[uri];
      const code = meta && !meta.uploaded ? observationPhotoCode(meta) : null;
      if (!code) continue;
      add({ key: `photo:${record.id}:${visit.id}:${uri}`, kind: 'photo', code, recordId: record.id, obsId: visit.id, uri });
    }
    if (visit.submissionRequested && !visit.submittedForReview) {
      const code = submitCodeOf(visit);
      if (code) add({ key: `submit:${record.id}:${visit.id}`, kind: 'submit', code, recordId: record.id, obsId: visit.id });
    }
  }
  return problems;
}

/**
 * Whether "Retry upload" is worth offering for this record (or one observation of it):
 * yes for anything not uploaded unless every known problem is permanent. A tag the server
 * refused is permanent too (Sync details explains it).
 */
export function retryableRecord(record: ProblemRecordLike, obsId?: string): boolean {
  const problems = recordSyncProblems(record).filter((problem) => obsId === undefined || problem.obsId === obsId);
  const tagRefused = obsId === undefined && Boolean(record.tagProblem);
  if (problems.length === 0 && !tagRefused) return true;
  return problems.some((problem) => !problem.final);
}

/** The first permanent problem's explanation (for "Upload failed: ..."), or null. */
export function finalProblemText(record: ProblemRecordLike): string | null {
  return recordSyncProblems(record).find((problem) => problem.final)?.explanation ?? null;
}

/** Records the server says are gone (a refused submit or photo answered "plant_deleted"). */
export function recordsWithGonePlant<T extends ProblemRecordLike>(records: T[]): T[] {
  return records.filter((record) => recordSyncProblems(record).some((problem) => PLANT_GONE_CODES.has(problem.code)));
}
