import { Directory, File, Paths } from 'expo-file-system';
import type { PlantPhoto } from '../api/species';

// The photo shown for a species: the primary photo of one of its plants, saved on the phone
// so it shows offline. Species reference photos are no longer shown or downloaded.
export interface CachedPlantPhoto {
  uri: string;
  tag: string | null;
  photoId: string;
}

const imageDirectory = new Directory(Paths.document, 'species-plant-photos');
// Where species reference photos used to be saved; removed once, they are not shown any more.
const legacyDirectory = new Directory(Paths.document, 'species-reference-images');

function ensureImageDirectory() {
  if (!imageDirectory.exists) {
    imageDirectory.create({ intermediates: true, idempotent: true });
  }
}

const safeName = (value: string) => value.replace(/[^A-Za-z0-9-]/g, '');

function imageFile(speciesId: string, photoId: string) {
  return new File(imageDirectory, `${safeName(speciesId)}-plant-${safeName(photoId)}.jpg`);
}

export function removeLegacySpeciesImages(): void {
  try {
    if (legacyDirectory.exists) legacyDirectory.delete();
  } catch {
    // Not important: the old files are just never shown.
  }
}

// Downloads the plant photo for this species (unless it is already on the phone).
export async function cachePlantPhoto(speciesId: string, photo: PlantPhoto): Promise<CachedPlantPhoto> {
  ensureImageDirectory();
  const photoId = String(photo.id);
  const destination = imageFile(speciesId, photoId);
  if (destination.exists) return { uri: destination.uri, tag: photo.tag ?? null, photoId };

  try {
    const downloaded = await File.downloadFileAsync(photo.url, destination, { idempotent: true });
    return { uri: downloaded.uri, tag: photo.tag ?? null, photoId };
  } catch (error) {
    // Android may leave a partial file after an interrupted download.
    try {
      if (destination.exists) destination.delete();
    } catch {
      // Keep the original network error.
    }
    throw error;
  }
}

// Removes a species' saved plant photo (it no longer has one, or the user can't see it).
export function removeCachedPlantPhoto(speciesId: string, photoId: string): void {
  try {
    const file = imageFile(speciesId, photoId);
    if (file.exists) file.delete();
  } catch {
    // The entry is dropped from the store anyway.
  }
}
