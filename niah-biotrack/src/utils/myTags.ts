// myTags.ts - the botanist's own QR tags ("My QR tags"): which are unused or used, how they
// were reserved (one batch per request), and whether a scanned tag may be attached.
// Plain TypeScript with no imports, so Node can test it (myTags.test.mjs).

// A reservation as GET /api/tag-reservations returns it (the botanist's own only).
export interface ServerTagReservation {
  qr_code_value: string;
  request_id: string;
  reserved_at: string;
  bound_plant_id: string | null;
  bound_at: string | null;
}

export interface MyTag {
  tag: string;
  requestId: string;
  reservedAt: string;
  boundPlantId: string | null; // the plant (server id) it is attached to, or null when unused
  boundAt: string | null;
}

// "Get new tags": how many, typed or with − / + (1–100, 10 to start). The server reserves at
// most 100 in one request.
export const DEFAULT_TAG_COUNT = 10;
export const MIN_NEW_TAGS = 1;
export const MAX_NEW_TAGS = 100;

/** The typed number of tags, or why it can't be used. */
export function parseTagCount(text: string): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = String(text ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: `Enter a whole number from ${MIN_NEW_TAGS} to ${MAX_NEW_TAGS}.` };
  const value = Number(trimmed);
  if (value < MIN_NEW_TAGS || value > MAX_NEW_TAGS) {
    return { ok: false, message: `Choose ${MIN_NEW_TAGS} to ${MAX_NEW_TAGS} tags at a time.` };
  }
  return { ok: true, value };
}

/** − / +: one less or one more, kept within 1–100 (an unreadable value starts from 10). */
export function stepTagCount(text: string, delta: number): string {
  const parsed = parseTagCount(text);
  const current = parsed.ok ? parsed.value : DEFAULT_TAG_COUNT;
  return String(Math.min(MAX_NEW_TAGS, Math.max(MIN_NEW_TAGS, current + delta)));
}

const PHYSICAL_TAG = /^NIAH-PLT-\d{5}$/;

// A real, printed tag (not the "plant:<id>" placeholder a plant gets until one is attached).
export function isPhysicalTag(tag: string | null | undefined): tag is string {
  return typeof tag === 'string' && PHYSICAL_TAG.test(tag);
}

export function fromServer(rows: ServerTagReservation[]): MyTag[] {
  return rows
    .filter((row) => row && isPhysicalTag(row.qr_code_value))
    .map((row) => ({
      tag: row.qr_code_value,
      requestId: row.request_id,
      reservedAt: row.reserved_at,
      boundPlantId: row.bound_plant_id ?? null,
      boundAt: row.bound_at ?? null,
    }));
}

// One batch: the tags reserved in one request (the server's request_id), newest batch first,
// tags in order. Its "Print" prints exactly those tags.
export interface TagBatch {
  requestId: string;
  reservedAt: string;
  tags: MyTag[];
  unused: number;
}

export function groupBatches(tags: MyTag[]): TagBatch[] {
  const byRequest = new Map<string, MyTag[]>();
  for (const tag of tags) {
    const list = byRequest.get(tag.requestId) ?? [];
    list.push(tag);
    byRequest.set(tag.requestId, list);
  }
  return [...byRequest.entries()]
    .map(([requestId, list]) => {
      const sorted = [...list].sort((a, b) => a.tag.localeCompare(b.tag));
      const reservedAt = sorted.map((tag) => tag.reservedAt).sort().reverse()[0] ?? '';
      return { requestId, reservedAt, tags: sorted, unused: sorted.filter((tag) => !tag.boundPlantId).length };
    })
    .sort((a, b) => b.reservedAt.localeCompare(a.reservedAt) || a.requestId.localeCompare(b.requestId));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A batch's heading: "Today · 10 tags", "18 Nov · 20 tags" ("18 Nov 2025" in another year). */
export function batchLabel(batch: Pick<TagBatch, 'reservedAt' | 'tags'>, now: Date = new Date()): string {
  const count = `${batch.tags.length} ${batch.tags.length === 1 ? 'tag' : 'tags'}`;
  const time = Date.parse(batch.reservedAt);
  if (Number.isNaN(time)) return count;
  const day = new Date(time);
  const sameDay = day.getFullYear() === now.getFullYear() && day.getMonth() === now.getMonth() && day.getDate() === now.getDate();
  const when = sameDay
    ? 'Today'
    : `${day.getDate()} ${MONTHS[day.getMonth()]}${day.getFullYear() === now.getFullYear() ? '' : ` ${day.getFullYear()}`}`;
  return `${when} · ${count}`;
}

/** "3 used · 7 unused" for one batch. */
export function batchCountsText(batch: Pick<TagBatch, 'tags' | 'unused'>): string {
  return `${batch.tags.length - batch.unused} used · ${batch.unused} unused`;
}

/** Which batches start open: the newest one; the others are collapsed. */
export function initiallyOpenBatches(batches: TagBatch[]): string[] {
  return batches.length > 0 ? [batches[0].requestId] : [];
}

// Printing (a batch, or the tags chosen): the layout is chosen in the "Print N tags" sheet.
export type PrintLayout = 'sheet' | 'single' | 'images';
export const PRINT_LAYOUTS: { value: PrintLayout; label: string; hint: string }[] = [
  { value: 'sheet', label: 'Sheet of labels', hint: 'Many labels on each A4 page (PDF).' },
  { value: 'single', label: 'One label per page', hint: 'One large label on each page (PDF).' },
  { value: 'images', label: 'Images', hint: 'One PNG per tag, to save or share.' },
];

/**
 * What a print sends: exactly these tags (sorted, no repeats, at most 100) in this layout.
 * A batch prints its own tags; a selection prints only the tags chosen, from any batches.
 */
export function printPlan(
  source: { kind: 'batch'; batch: Pick<TagBatch, 'tags'> } | { kind: 'selection'; selected: string[] },
  layout: PrintLayout
): { tags: string[]; layout: PrintLayout; title: string } {
  const chosen = source.kind === 'batch' ? source.batch.tags.map((tag) => tag.tag) : source.selected;
  const tags = [...new Set(chosen.filter((tag) => isPhysicalTag(tag)))].sort().slice(0, MAX_PRINT_TAGS);
  return { tags, layout, title: `Print ${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}` };
}

export const NOT_YOURS_MESSAGE ="This tag isn't one of yours. Get new tags in My QR tags.";
export const USED_MESSAGE = 'This tag is already attached to another plant. Use an unused tag from My QR tags.';

// Why this tag can't be attached to this plant, or null when it can: it must be one of the
// botanist's own reserved tags, and unused (or already on this same plant).
export function tagOwnershipProblem(
  tag: string,
  myTags: MyTag[],
  plantServerId?: string | null
): string | null {
  const mine = myTags.find((item) => item.tag === tag);
  if (!mine) return NOT_YOURS_MESSAGE;
  if (mine.boundPlantId && (!plantServerId || mine.boundPlantId.toLowerCase() !== plantServerId.toLowerCase())) {
    return USED_MESSAGE;
  }
  return null;
}

// How the PDF of labels is laid out (the `layout` the server takes).
export type PdfLayout = 'sheet' | 'single';
export const PDF_LAYOUTS: { value: PdfLayout; label: string }[] = [
  { value: 'sheet', label: 'Sheet of labels' },
  { value: 'single', label: 'One label per page' },
];

// Where one tag's PNG label comes from: a used tag through its plant (the plant's QR image),
// an unused one through the reservation. Both are the botanist's own only.
export function tagImagePath(tag: Pick<MyTag, 'tag' | 'boundPlantId'>): string {
  return tag.boundPlantId
    ? `/api/plants/${encodeURIComponent(tag.boundPlantId)}/qr/image`
    : `/api/tag-reservations/${encodeURIComponent(tag.tag)}/image`;
}

// Adds or removes one tag from the selection (for "Print selected").
export function toggleSelected(selected: string[], tag: string): string[] {
  return selected.includes(tag) ? selected.filter((item) => item !== tag) : [...selected, tag];
}

// "Print selected" sends at most 100 tags (the server's limit).
export const MAX_PRINT_TAGS = 100;

// "12 unused · 8 used"
export function tagCountsText(tags: MyTag[]): string {
  const unused = tags.filter((tag) => !tag.boundPlantId).length;
  return `${unused} unused · ${tags.length - unused} used`;
}

/**
 * Refreshes the botanist's saved tag list from the server whenever online (opening the tag
 * scanner, every sync), so a tag deleted or used elsewhere is no longer accepted from an old
 * list when scanning offline. Offline, or when the server can't be reached, the saved list
 * stays as it is. Never throws.
 */
export async function refreshTagList(deps: {
  isOffline: () => Promise<boolean>;
  fetchTags: () => Promise<MyTag[]>;
}): Promise<'refreshed' | 'offline' | 'failed'> {
  try {
    if (await deps.isOffline()) return 'offline';
    await deps.fetchTags();
    return 'refreshed';
  } catch {
    return 'failed';
  }
}

// Base64 for the downloaded PDF (written to a file with expo-file-system).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64FromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[triple & 63] : '=';
  }
  return out;
}
