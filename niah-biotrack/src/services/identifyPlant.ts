import type * as ImagePicker from 'expo-image-picker';
import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { supabase } from '../lib/supabase';

export interface SpeciesSuggestion {
  rank: number;
  scientificName: string;
  commonName: string | null;
  family: string | null;
  confidence: number;
  confidenceLevel:
    | 'High'
    | 'Moderate'
    | 'Low';
}

interface IdentificationResponse {
  success: boolean;
  message?: string;
  suggestions?: SpeciesSuggestion[];
}

// Thrown when the request never reached the backend
// (no connection, or the server address is unreachable).
export class IdentifyNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentifyNetworkError';
  }
}

const MAX_IMAGE_SIZE =
  10 * 1024 * 1024;

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

const configuredApiBaseUrl =
  process.env
    .EXPO_PUBLIC_API_BASE_URL
    ?.trim();

const API_BASE_URL =
  configuredApiBaseUrl === undefined ? undefined : trimTrailingSlashes(configuredApiBaseUrl);

function getUploadName(
  photo: ImagePicker.ImagePickerAsset
) {
  const uriPath =
    photo.uri
      .split('?')[0]
      .toLowerCase();

  const suppliedName =
    photo.fileName?.trim();

  const suppliedNameLower =
    suppliedName?.toLowerCase();

  const isPng =
    uriPath.endsWith('.png') ||
    suppliedNameLower?.endsWith(
      '.png'
    ) ||
    photo.mimeType === 'image/png';

  const isJpeg =
    uriPath.endsWith('.jpg') ||
    uriPath.endsWith('.jpeg') ||
    suppliedNameLower?.endsWith(
      '.jpg'
    ) ||
    suppliedNameLower?.endsWith(
      '.jpeg'
    ) ||
    photo.mimeType === 'image/jpeg' ||
    photo.mimeType === 'image/jpg';

  if (!isPng && !isJpeg) {
    throw new Error(
      'Choose a JPG or PNG image.'
    );
  }

  if (isPng) {
    return suppliedNameLower?.endsWith(
      '.png'
    )
      ? suppliedName!
      : 'plant.png';
  }

  return suppliedNameLower?.endsWith(
    '.jpg'
  ) ||
    suppliedNameLower?.endsWith(
      '.jpeg'
    )
    ? suppliedName!
    : 'plant.jpg';
}

export async function identifyPlant(
  photo: ImagePicker.ImagePickerAsset,
  signal?: AbortSignal
): Promise<SpeciesSuggestion[]> {
  if (!API_BASE_URL) {
    throw new Error(
      'EXPO_PUBLIC_API_BASE_URL is not configured.'
    );
  }

  const imageFile =
    new File(photo.uri);

  if (!imageFile.exists) {
    throw new Error(
      'The selected photo is no longer available.'
    );
  }

  const fileSize =
    photo.fileSize ??
    imageFile.size;

  if (
    fileSize &&
    fileSize > MAX_IMAGE_SIZE
  ) {
    throw new Error(
      'Choose a photo smaller than 10 MB.'
    );
  }

  const uploadName =
    getUploadName(photo);

  const formData =
    new FormData();

  formData.append(
    'image',
    imageFile,
    uploadName
  );

  let response;

  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new Error('Please sign in before identifying a plant.');
  }

  try {
    response = await fetch(
      `${API_BASE_URL}/api/identify`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: formData,
        signal,
      }
    );
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    const detail =
      error instanceof Error
        ? error.message
        : 'Unknown network error';

    throw new IdentifyNetworkError(
      `Photo upload failed: ${detail}`
    );
  }

  let result: IdentificationResponse;

  try {
    result =
      (await response.json()) as IdentificationResponse;
  } catch {
    throw new Error(
      `Backend returned an invalid response (${response.status}).`
    );
  }

  if (
    !response.ok ||
    !result.success
  ) {
    throw new Error(
      result.message ||
        `Species identification failed (${response.status}).`
    );
  }

  return Array.isArray(
    result.suggestions
  )
    ? result.suggestions
    : [];
}
