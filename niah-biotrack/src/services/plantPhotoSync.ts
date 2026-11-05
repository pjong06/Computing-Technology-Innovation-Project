import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import { ApiError, BASE_URL } from '../api/client';
import { supabase } from '../lib/supabase';
import type {
  PlantPhotoEntry,
  PlantRecord,
} from '../store/useRecordStore';
import { resolveStoredPhotoUri } from '../utils/photoStorage';

const UPLOADED = 'Uploaded' as PlantPhotoEntry['syncStatus'];
const NOT_UPLOADED = 'Not uploaded' as PlantPhotoEntry['syncStatus'];
const FAILED = 'Upload failed' as PlantPhotoEntry['syncStatus'];

const PHOTO_TIMEOUT_MS = 30_000;

interface PlantPhotoResponse {
  message?: string;
  media?: {
    id: string;
    client_record_id?: string;
  };
}

function uploadName(uri: string): string {
  const clean = uri.split('?')[0].toLowerCase();

  if (clean.endsWith('.png')) {
    return 'plant.png';
  }

  if (clean.endsWith('.webp')) {
    return 'plant.webp';
  }

  return 'plant.jpg';
}

async function uploadPlantPhoto(
  plantServerId: string,
  photo: PlantPhotoEntry
): Promise<string> {
  if (!BASE_URL) {
    throw new ApiError(
      'EXPO_PUBLIC_API_BASE_URL is not set',
      0
    );
  }

  const resolvedUri = resolveStoredPhotoUri(photo.uri);
  const file = new File(resolvedUri);

  if (!file.exists) {
    throw new ApiError(
      'A saved plant photo is no longer available on this phone.',
      400
    );
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new ApiError('You are not signed in', 401);
  }

  const formData = new FormData();

  formData.append(
    'photo',
    file,
    uploadName(resolvedUri)
  );

  formData.append(
    'photo_type',
    photo.photoType
  );

  // Stable phone-generated UUID.
  // The backend uses this to make retries idempotent.
  formData.append(
    'client_record_id',
    photo.id
  );

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    PHOTO_TIMEOUT_MS
  );

  let response: Response;

  try {
    try {
      response = await fetch(
        `${BASE_URL}/api/plants/${encodeURIComponent(
          plantServerId
        )}/photo`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
          signal: controller.signal,
        }
      );
    } catch {
      throw new ApiError(
        `Could not reach the server at ${BASE_URL}`,
        0
      );
    }

    const text = await response.text();

    let body: PlantPhotoResponse = {};

    try {
      body = text
        ? (JSON.parse(text) as PlantPhotoResponse)
        : {};
    } catch {
      body = {};
    }

    if (!response.ok) {
      throw new ApiError(
        body.message ??
          `Plant photo upload failed (${response.status})`,
        response.status
      );
    }

    if (!body.media?.id) {
      throw new ApiError(
        'The server did not return the uploaded photo.',
        response.status
      );
    }

    return body.media.id;
  } finally {
    clearTimeout(timer);
  }
}

export async function syncPlantPhotos(
  record: PlantRecord
): Promise<{
  record: PlantRecord;
  error?: string;
}> {
  const photos = record.photoEntries ?? [];

  if (photos.length === 0) {
    return { record };
  }

  if (!record.serverId) {
    return {
      record,
      error:
        'Plant metadata must be uploaded before its photos can be synchronized.',
    };
  }

  const nextPhotos = [...photos];

  let firstError: string | undefined;

  for (let index = 0; index < nextPhotos.length; index += 1) {
    const photo = nextPhotos[index];

    if (photo.syncStatus === UPLOADED) {
      continue;
    }

    try {
      const serverId = await uploadPlantPhoto(
        record.serverId,
        photo
      );

      nextPhotos[index] = {
        ...photo,
        serverId,
        syncStatus: UPLOADED,
        lastError: undefined,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Plant photo upload failed.';

      const retryable =
        error instanceof ApiError &&
        (error.status === 0 || error.status >= 500);

      nextPhotos[index] = {
        ...photo,
        syncStatus: retryable
          ? NOT_UPLOADED
          : FAILED,
        lastError: message,
      };

      if (!firstError) {
        firstError = message;
      }

      // If the network/server is unavailable, don't repeatedly
      // try the remaining photos. Reconnect auto-sync will retry.
      if (retryable) {
        break;
      }
    }
  }

  return {
    record: {
      ...record,
      photoEntries: nextPhotos,
      photoUris: nextPhotos.map(
        (photo) => photo.uri
      ),
    },
    error: firstError,
  };
}