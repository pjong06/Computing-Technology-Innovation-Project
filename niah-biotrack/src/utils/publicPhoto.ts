// publicPhoto.ts - the address of a plant's public photo for visitor screens.
// The backend sends only a path on itself ("/p/NIAH-PLT-00012/photo"); anything else (a
// full URL, another host, a storage path) is ignored, so a response can never point the
// app somewhere else. Plain TypeScript with no imports (tested by publicPhoto.test.mjs).

const PUBLIC_PHOTO_PATH = /^\/p\/NIAH-PLT-\d{5}\/photo$/;

export function publicPhotoUri(
  baseUrl: string | null | undefined,
  path: string | null | undefined
): string | null {
  if (!baseUrl || typeof path !== 'string' || !PUBLIC_PHOTO_PATH.test(path)) return null;
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+(\/[^\s]*)?$/i.test(base)) return null;
  return `${base}${path}`;
}
