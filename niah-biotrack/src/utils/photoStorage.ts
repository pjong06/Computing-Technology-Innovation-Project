import { Directory, File, Paths } from 'expo-file-system';

// Picked and taken photos start in the image picker's cache, which iOS/Android may
// clear at any time. Every photo is copied here (the app's document directory,
// kept until the app is uninstalled) and records store these permanent paths.
const PHOTO_DIR_NAME = 'record-photos';
const PHOTO_DIR = new Directory(Paths.document, PHOTO_DIR_NAME);
const PHOTO_DIR_MARKER = `/${PHOTO_DIR_NAME}/`;

// iOS can move the app's container (and so the documents path) when the app or
// Expo Go is updated, which makes a stored absolute path stale. Rebuild any stored
// photo URI against the current documents folder before using it.
export function resolveStoredPhotoUri(uri: string): string {
  const index = uri.lastIndexOf(PHOTO_DIR_MARKER);
  if (index === -1) return uri; // not one of ours (e.g. an older record's cache path)
  return new File(PHOTO_DIR, uri.slice(index + PHOTO_DIR_MARKER.length)).uri;
}

function ensurePhotoDir() {
  if (!PHOTO_DIR.exists) {
    PHOTO_DIR.create({ intermediates: true, idempotent: true });
  }
}

// Copies a photo into permanent storage and returns the new file URI.
export async function savePhotoPermanently(sourceUri: string): Promise<string> {
  ensurePhotoDir();
  const source = new File(sourceUri);
  const extension = source.extension || '.jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`;
  const destination = new File(PHOTO_DIR, fileName);
  await source.copy(destination);
  return destination.uri;
}

// Deletes one stored photo. Only files inside the photo folder are touched, so an
// older record's cache path (or any other URI) is left alone.
export function deleteStoredPhoto(uri: string | null | undefined) {
  if (!uri || !uri.includes(PHOTO_DIR_MARKER)) return;
  try {
    const file = new File(resolveStoredPhotoUri(uri));
    if (file.exists) file.delete();
  } catch {
    // Already gone or not deletable: nothing else to clean up.
  }
}

// Deletes every stored record photo (used when local data is cleared on logout).
export function deleteAllStoredPhotos() {
  try {
    if (PHOTO_DIR.exists) PHOTO_DIR.delete();
  } catch {
    // Folder already removed.
  }
}
