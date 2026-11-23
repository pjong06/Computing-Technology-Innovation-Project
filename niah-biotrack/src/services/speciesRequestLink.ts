// A plant registered for a species that isn't in the catalogue yet waits for the species
// request the botanist sent for it. Once the plant is on the server, this links the two
// (POST /api/plants/:id/species-request); when the officer adds the species, the plant gets
// it. The request itself uploads on its own path (species requests); until it has, the link
// answers "not uploaded yet" and is tried again on the next sync.

import { ApiError, apiFetch } from '../api/client';
import type { PlantRecord } from '../store/useRecordStore';

export type LinkResult =
  | { ok: true; linked: boolean }
  | { ok: false; reason: string; retryable: boolean };

export function needsSpeciesRequestLink(record: Pick<PlantRecord, 'speciesRequestId' | 'speciesRequestLinked' | 'speciesId' | 'serverId'>): boolean {
  return Boolean(record.speciesRequestId) && !record.speciesRequestLinked && !record.speciesId && Boolean(record.serverId);
}

export async function linkSpeciesRequest(record: PlantRecord): Promise<LinkResult> {
  if (!needsSpeciesRequestLink(record)) return { ok: true, linked: false };
  try {
    await apiFetch(`/api/plants/${encodeURIComponent(record.serverId as string)}/species-request`, {
      method: 'POST',
      body: { request_client_id: record.speciesRequestId },
    });
    return { ok: true, linked: true };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'species_request_not_uploaded') {
      return { ok: false, reason: "The species request hasn't uploaded yet. It will be linked on the next sync.", retryable: true };
    }
    const status = error instanceof ApiError ? error.status : 0;
    const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Could not link the species request.',
      retryable,
    };
  }
}
