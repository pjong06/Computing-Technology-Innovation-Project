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

// How many tags "Get new tags" offers.
export const NEW_TAG_COUNTS = [10, 20, 50] as const;

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

// One printed batch: the tags reserved in one request, newest batch first, tags in order.
// "Print again" sends the same request and number of tags, and the server returns the same
// tags (it never reserves new ones for a request it has seen).
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

export const NOT_YOURS_MESSAGE = "This tag isn't one of yours. Get new tags in My QR tags.";
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
