import { Directory, File, Paths } from 'expo-file-system';

// Plant thumbnails downloaded once and kept on the phone (in the cache folder, which the
// phone may clear when it needs space), so scrolling back or reopening a list doesn't load
// them again. Keys come from thumbnailSources (own-<media id>, public-<tag>-<size>-<day>).
// Also kept in memory for the session, so rows don't even touch the disk twice.

const memory = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
let folder: Directory | null = null;

function thumbsFolder(): Directory {
  if (!folder) {
    folder = new Directory(Paths.cache, 'plant-thumbnails');
    try {
      if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
    } catch {
      // Created by another call in the meantime, or not available: downloads will say so.
    }
    // Once per app start: drop public copies kept from earlier days.
    pruneOldPublicThumbnails(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return folder;
}

function fileFor(key: string): File {
  return new File(thumbsFolder(), `${key}.jpg`);
}

// The phone copy for this key, or null.
export function cachedThumbnail(key: string): string | null {
  const known = memory.get(key);
  if (known) return known;
  try {
    const file = fileFor(key);
    if (file.exists && (file.size ?? 0) > 0) {
      memory.set(key, file.uri);
      return file.uri;
    }
  } catch {
    // Treat as not cached.
  }
  return null;
}

// Downloads the image once (also when several rows ask at the same time) and returns the
// phone copy. Rejects when it can't be downloaded (offline, expired link, not found).
export function downloadThumbnail(key: string, url: string): Promise<string> {
  const cached = cachedThumbnail(key);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(key);
  if (running) return running;
  const task = (async () => {
    const target = fileFor(key);
    try {
      const file = await File.downloadFileAsync(url, target, { idempotent: true });
      if (!file.exists || (file.size ?? 0) === 0) throw new Error('Empty image');
      memory.set(key, file.uri);
      return file.uri;
    } catch (error) {
      try {
        if (target.exists) target.delete();
      } catch {
        // Nothing to clean up.
      }
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

// Removes public copies kept from earlier days (their keys end in another day).
export function pruneOldPublicThumbnails(today: string): void {
  try {
    for (const item of thumbsFolder().list()) {
      if (item instanceof File && /^public-.*-\d{8}\.jpg$/.test(item.name) && !item.name.endsWith(`-${today}.jpg`)) {
        item.delete();
      }
    }
  } catch {
    // Not important: the phone clears the cache folder when it needs space.
  }
}
