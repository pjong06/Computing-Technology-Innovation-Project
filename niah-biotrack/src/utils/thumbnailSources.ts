// thumbnailSources.ts - where a plant's picture comes from, in order:
//   1. a photo on this phone,
//   2. the signed server thumbnail of the botanist's own plant (GET /api/plants),
//   3. the public copy of a public plant (/p/<tag>/photo, small for lists),
//   4. otherwise the placeholder (the caller's).
// Lists and plant detail use the same order, so a plant that shows a picture in a list
// never shows "no photo" when opened. Plain TypeScript with no imports (tested by
// thumbnailSources.test.mjs).

export type ThumbnailKind = 'local' | 'signed' | 'public';

export interface ThumbnailSource {
  kind: ThumbnailKind;
  uri: string;
  // Key of the copy kept on the phone (null for local photos, which are files already).
  cacheKey: string | null;
  // A signed link past its expiry: usable only if the image is already cached.
  expired: boolean;
}

// A signed thumbnail of an own plant, as GET /api/plants sends it.
export interface SignedThumbnail {
  url: string;
  key: string;
  expiresAt: string | null;
}

const PUBLIC_PHOTO_PATH = /^\/p\/(NIAH-PLT-\d{5})\/photo$/;
// Treat a link as expired a little early, so it doesn't run out while loading.
const EXPIRY_MARGIN_MS = 30_000;

// A file name that is safe on any phone: letters, digits and dashes only.
function safeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 120);
}

export function isExpired(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return false;
  const time = Date.parse(expiresAt);
  return Number.isNaN(time) ? false : time - EXPIRY_MARGIN_MS <= now;
}

// "YYYYMMDD" of a time: public copies are kept on the phone for the day (an officer can
// change a plant's main photo), own-plant thumbnails for as long as the photo is the same.
function day(now: number): string {
  return new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
}

export function thumbnailSources(input: {
  localUri?: string | null;
  signed?: SignedThumbnail | null;
  publicPath?: string | null;
  baseUrl?: string | null;
  size?: 'thumb' | 'full';
  now?: number;
}): ThumbnailSource[] {
  const now = input.now ?? Date.now();
  const size = input.size ?? 'thumb';
  const sources: ThumbnailSource[] = [];

  if (input.localUri) {
    sources.push({ kind: 'local', uri: input.localUri, cacheKey: null, expired: false });
  }

  const signed = input.signed;
  if (signed && /^https:\/\//i.test(signed.url) && signed.key) {
    sources.push({
      kind: 'signed',
      uri: signed.url,
      cacheKey: `own-${safeKey(signed.key)}`,
      expired: isExpired(signed.expiresAt, now),
    });
  }

  const match = typeof input.publicPath === 'string' ? PUBLIC_PHOTO_PATH.exec(input.publicPath) : null;
  const base = (input.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (match && /^https?:\/\/[^/\s]+(\/[^\s]*)?$/i.test(base)) {
    const tag = match[1];
    const full = `${base}${input.publicPath}`;
    if (size === 'full') {
      sources.push({ kind: 'public', uri: full, cacheKey: `public-${tag}-full-${day(now)}`, expired: false });
    }
    // The small copy: what the lists show (and what detail falls back to).
    sources.push({ kind: 'public', uri: `${full}?size=thumb`, cacheKey: `public-${tag}-thumb-${day(now)}`, expired: false });
  }

  return sources;
}

// What to do when a source can't be shown: a signed link that failed (or had expired, with
// nothing cached) asks the list for fresh links once; after that, or for anything else, the
// next source is tried.
export function onSourceFailed(source: ThumbnailSource, alreadyRefreshed: boolean): 'refresh' | 'next' {
  return source.kind === 'signed' && !alreadyRefreshed ? 'refresh' : 'next';
}

// The first thing PlantThumbnail does with a source:
//   show     - a phone photo, or the copy already kept on the phone (even if the link expired);
//   download - fetch it once and keep it;
//   skip     - an expired signed link with nothing kept: ask for fresh links (once), go on.
export type SourceStep =
  | { action: 'show'; uri: string }
  | { action: 'download'; uri: string; cacheKey: string }
  | { action: 'skip'; refresh: boolean };

export function firstStep(
  source: ThumbnailSource,
  cachedUri: string | null,
  alreadyRefreshed: boolean
): SourceStep {
  if (source.kind === 'local' || !source.cacheKey) return { action: 'show', uri: source.uri };
  if (cachedUri) return { action: 'show', uri: cachedUri };
  if (source.expired) return { action: 'skip', refresh: onSourceFailed(source, alreadyRefreshed) === 'refresh' };
  return { action: 'download', uri: source.uri, cacheKey: source.cacheKey };
}
