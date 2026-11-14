import { Directory, File, Paths } from 'expo-file-system';
import { fetchSpeciesPhotoUrl, type SpeciesDetail } from '../api/species';
import { preferredSpeciesPhoto } from '../utils/speciesPhoto';

const imageDirectory = new Directory(Paths.document, 'species-reference-images');

function ensureImageDirectory() {
  if (!imageDirectory.exists) {
    imageDirectory.create({ intermediates: true, idempotent: true });
  }
}

function imageFile(speciesId: string, photoId: string) {
  return new File(imageDirectory, `${speciesId}-${photoId}.jpg`);
}

export function getCachedSpeciesImage(
  speciesId: string,
  photoId: string
): string | null {
  ensureImageDirectory();
  const file = imageFile(speciesId, photoId);
  return file.exists ? file.uri : null;
}

export async function cachePrimarySpeciesImage(
  detail: SpeciesDetail
): Promise<string | null> {
  const primaryPhoto = preferredSpeciesPhoto(detail.species_media);

  if (!primaryPhoto) return null;

  ensureImageDirectory();
  const destination = imageFile(detail.id, primaryPhoto.id);

  if (destination.exists) return destination.uri;

  try {
    const signedUrl = await fetchSpeciesPhotoUrl(detail.id, primaryPhoto.id);
    const downloaded = await File.downloadFileAsync(signedUrl, destination, {
      idempotent: true,
    });
    return downloaded.uri;
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
