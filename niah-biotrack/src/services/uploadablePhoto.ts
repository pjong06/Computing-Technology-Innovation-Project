import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';

import { ApiError } from '../api/client';
import {
  TARGET_BYTES,
  compressToFit,
  needsCompression,
  type CompressionResult,
  type CompressionStep,
} from '../utils/photoCompression';

// Every photo is shrunk on the phone before it uploads (src/utils/photoCompression.ts): a
// JPEG, longest side at most 2000 px, quality 0.75, EXIF orientation applied (the image
// loader of expo-image-manipulator applies it on both platforms), tried again smaller and
// at lower quality while it is above the target, well under the server's 5 MB limit.

// One step: decode no larger than the step's size (aspect kept, never enlarged), save as JPEG.
async function renderStep(uri: string, step: CompressionStep): Promise<{ output: File; size: number }> {
  const rendered = await ImageManipulator.ImageManipulator
    .manipulate(uri, { maxWidth: step.maxSide, maxHeight: step.maxSide })
    .renderAsync();
  const result = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: step.quality });
  const file = new File(result.uri);
  if (!file.exists) throw new Error('The compressed photo was not saved.');
  return { output: file, size: file.size };
}

/** A compressed JPEG copy of this photo (in the cache folder), or why it can't be made. */
export async function compressPhoto(uri: string): Promise<CompressionResult<File>> {
  const result = await compressToFit((step) => renderStep(uri, step), { targetBytes: TARGET_BYTES });
  if (!result.ok) console.warn('Photo compression failed:', result.message);
  return result;
}

// The file to upload for a saved photo: the photo as it is when it is already small (it was
// compressed when it was saved), otherwise a compressed copy in the cache. The saved photo on
// the phone is never changed, so it is kept until the upload has succeeded. When even the
// smallest step is too large, an ApiError 413 says so (the same as the server's refusal).
export async function uploadablePhotoFile(file: File): Promise<File> {
  if (!needsCompression(file.extension, file.size)) return file;
  const result = await compressPhoto(file.uri);
  if (!result.ok) throw new ApiError(result.message, 413, 'photo_refused');
  return result.output;
}
