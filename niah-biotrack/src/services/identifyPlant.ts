import type * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export interface SpeciesSuggestion {
  rank: number;
  scientificName: string;
  commonName: string | null;
  confidence: number;
  confidenceLevel: 'High' | 'Moderate' | 'Low';
}

interface IdentificationResponse {
  success: boolean;
  message: string;
  suggestions?: SpeciesSuggestion[];
}

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '');

/*
 * Convert the selected image into one consistent upload format.
 *
 * This allows common Gallery / Camera formats such as:
 *
 * - JPEG / JPG
 * - PNG
 * - HEIC
 * - HEIF
 * - WebP
 *
 * to be sent to the backend as JPEG.
 *
 * The exact source formats that can be decoded still depend on
 * the device / operating system.
 */
async function prepareImageForIdentification(
  photo: ImagePicker.ImagePickerAsset,
): Promise<{
  uri: string;
  name: string;
  type: string;
}> {
  try {
    /*
     * Downsample very large phone photos while loading them.
     *
     * 2048px keeps enough visual detail for plant
     * identification while reducing upload size.
     */
    const context =
      ImageManipulator.ImageManipulator.manipulate(
        photo.uri,
        {
          maxWidth: 2048,
          maxHeight: 2048,
        },
      );

    const renderedImage = await context.renderAsync();

    /*
     * Always save the final upload as JPEG.
     *
     * This removes differences between:
     * iPhone HEIC,
     * Android WebP,
     * PNG,
     * JPEG, etc.
     */
    const result = await renderedImage.saveAsync({
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.85,
    });

    return {
      uri: result.uri,
      name: `plant-${Date.now()}.jpg`,
      type: 'image/jpeg',
    };
  } catch (error) {
    console.warn(
      'Image conversion failed:',
      error,
    );

    throw new Error(
      'This image could not be prepared for AI identification. Please choose another image.',
    );
  }
}

export async function identifyPlant(
  photo: ImagePicker.ImagePickerAsset,
  signal?: AbortSignal,
): Promise<SpeciesSuggestion[]> {
  if (!API_BASE_URL) {
    throw new Error(
      'Set EXPO_PUBLIC_API_BASE_URL to your backend address.',
    );
  }

  /*
   * Normalise the image before uploading.
   *
   * Do not reject HEIC / HEIF / WebP here.
   * They are converted to JPEG first.
   */
  const preparedPhoto =
    await prepareImageForIdentification(photo);

  const body = new FormData();

  body.append(
    'image',
    {
      uri: preparedPhoto.uri,
      name: preparedPhoto.name,
      type: preparedPhoto.type,
    } as unknown as Blob,
  );

  let response: Response;

  try {
    /*
     * Let React Native automatically create the
     * multipart/form-data boundary.
     *
     * Do not manually set Content-Type here.
     */
    response = await fetch(
      `${API_BASE_URL}/api/identify`,
      {
        method: 'POST',
        body,
        signal,
      },
    );
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    throw new Error(
      'Cannot reach the backend. Check your internet connection and backend availability.',
    );
  }

  let result: IdentificationResponse;

  try {
    result =
      (await response.json()) as IdentificationResponse;
  } catch {
    throw new Error(
      'The backend returned an invalid response.',
    );
  }

  if (!response.ok || !result.success) {
    throw new Error(
      result.message ||
        'Species identification failed. Please retry.',
    );
  }

  return Array.isArray(result.suggestions)
    ? result.suggestions
    : [];
}