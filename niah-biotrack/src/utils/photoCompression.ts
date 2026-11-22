// photoCompression.ts - how photos are shrunk on the phone before they upload (plant and
// observation photos). Plain TypeScript with no imports, so Node can test it
// (src/utils/photoCompression.test.mjs); src/services/photoCompression.ts does the resizing.
//
// The server takes photos up to 5 MB (backend/src/services/storageService.js, multer
// limits.fileSize). Phone cameras make photos of several MB, so every photo is made a JPEG
// whose longest side is at most 2000 px, at quality 0.75, with its EXIF orientation applied.
// If that is still above the target (well under the server's limit), it is tried again
// smaller and at lower quality; only when nothing fits is the botanist told.

export const SERVER_LIMIT_BYTES = 5 * 1024 * 1024;
// Comfortably under the server's limit (60%), so form overhead and rounding never matter.
export const TARGET_BYTES = 3 * 1024 * 1024;
// A JPEG/PNG/WebP already this small was compressed when it was saved: sent as it is.
export const SMALL_ENOUGH_BYTES = 1024 * 1024;

export interface CompressionStep {
  maxSide: number; // longest side in pixels
  quality: number; // JPEG quality, 0–1
}

// First try, then smaller and lower quality.
export const COMPRESSION_STEPS: CompressionStep[] = [
  { maxSide: 2000, quality: 0.75 },
  { maxSide: 1600, quality: 0.6 },
  { maxSide: 1280, quality: 0.5 },
  { maxSide: 1024, quality: 0.4 },
];

export const STILL_TOO_LARGE_MESSAGE =
  "This photo is still over 5 MB after shrinking it, so it can't be uploaded. Remove it and take a new one.";

/** The size a photo is resized to: longest side at most maxSide, aspect kept, never enlarged. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > maxSide)) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

const UPLOADABLE = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Whether a saved photo must be shrunk before upload: anything that isn't JPEG/PNG/WebP
 * (e.g. HEIC), or bigger than SMALL_ENOUGH_BYTES (older photos saved before compression).
 */
export function needsCompression(extension: string, sizeBytes: number | null | undefined): boolean {
  if (!UPLOADABLE.includes(String(extension ?? '').toLowerCase())) return true;
  return !(typeof sizeBytes === 'number' && sizeBytes > 0 && sizeBytes <= SMALL_ENOUGH_BYTES);
}

export type CompressionResult<T> =
  | { ok: true; output: T; size: number; step: CompressionStep; attempts: number }
  | { ok: false; message: string; attempts: number };

/**
 * Tries each step in turn (render = resize + save as JPEG, returning the file and its size)
 * until one fits within targetBytes. A render that throws counts as a failed step.
 */
export async function compressToFit<T>(
  render: (step: CompressionStep) => Promise<{ output: T; size: number }>,
  { targetBytes = TARGET_BYTES, steps = COMPRESSION_STEPS }: { targetBytes?: number; steps?: CompressionStep[] } = {}
): Promise<CompressionResult<T>> {
  let attempts = 0;
  let rendered = false;
  for (const step of steps) {
    attempts += 1;
    try {
      const { output, size } = await render(step);
      rendered = true;
      if (size > 0 && size <= targetBytes) return { ok: true, output, size, step, attempts };
    } catch {
      // This step could not be made; the next (smaller) one may still work.
    }
  }
  return {
    ok: false,
    // Made, but never small enough / never made at all.
    message: rendered ? STILL_TOO_LARGE_MESSAGE : PREPARE_FAILED_MESSAGE,
    attempts,
  };
}

export const PREPARE_FAILED_MESSAGE = 'A photo could not be prepared for upload. Remove it and add it again.';
