// photoFormat.ts - which saved photos the backend accepts as they are.
// Plain TypeScript with no imports, so Node can test it (src/utils/photoFormat.test.mjs).
//
// The backend takes only JPEG, PNG and WebP (backend/src/services/storageService.js).
// An iPhone photo picked from the library can be saved as .heic (expo-image-picker keeps
// the original format), which the server refuses with "Only JPEG, PNG and WebP images
// are allowed". Such photos are converted to JPEG on the phone just before upload.

const UPLOADABLE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// The file extension of a photo path or URI, lower case ('' when there is none).
export function photoExtension(uri: string): string {
  const path = String(uri ?? '').split(/[?#]/)[0];
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

// True when the photo must be converted to JPEG before the backend accepts it
// (HEIC, HEIF, TIFF, AVIF, BMP, GIF, or no known extension).
export function needsJpegConversion(uri: string): boolean {
  return !UPLOADABLE_EXTENSIONS.includes(photoExtension(uri));
}
