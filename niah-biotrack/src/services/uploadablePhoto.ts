import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';

import { needsJpegConversion } from '../utils/photoFormat';

// A saved photo in a format the backend accepts (JPEG, PNG, WebP). HEIC and other
// formats (e.g. an iPhone library photo) are converted to a JPEG copy in the cache;
// the saved original on the phone is not changed. Same conversion as identifyPlant.ts.
export async function uploadablePhotoFile(file: File): Promise<File> {
  if (!needsJpegConversion(file.uri)) {
    return file;
  }
  try {
    const rendered = await ImageManipulator.ImageManipulator
      .manipulate(file.uri, { maxWidth: 2048, maxHeight: 2048 })
      .renderAsync();
    const result = await rendered.saveAsync({
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.8,
    });
    const converted = new File(result.uri);
    if (!converted.exists) {
      throw new Error('The converted photo was not saved.');
    }
    return converted;
  } catch (error) {
    console.warn('Photo conversion to JPEG failed:', error);
    throw new Error(
      'A photo could not be converted to JPEG for upload. Remove it on the plant page and add it again.'
    );
  }
}
