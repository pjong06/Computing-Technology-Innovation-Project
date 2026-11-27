// observationParent.ts - which plant a queued observation is sent for.
// An observation is linked to its plant's SERVER id (plant_id) whenever the phone knows it:
// the botanist's own uploaded plants, and any plant the server returned (found by scanning
// or in the Plants list, registered on another phone or by someone else). Only a plant that
// exists solely on this phone and hasn't uploaded yet is named by its phone id
// (plant_client_record_id); the outbox holds that observation until the plant has uploaded.
// Plain TypeScript with no imports, so Node can test it (observationParent.test.mjs).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The plant reference for a new observation's payload. */
export function observationParent(plant: { id: string; serverId?: string | null }):
  | { plant_id: string }
  | { plant_client_record_id: string } {
  return plant.serverId ? { plant_id: plant.serverId } : { plant_client_record_id: plant.id };
}

/**
 * A queued observation create named its plant by phone id; the phone now knows the plant's
 * server id: the same payload with plant_id instead. null when nothing changes (it already
 * has plant_id, or the plant still isn't on the server).
 */
export function linkObservationPayload(
  payload: unknown,
  plantServerId: string | null | undefined
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const { plant_client_record_id: phoneId, ...rest } = payload as Record<string, unknown>;
  if (phoneId === undefined || typeof rest.plant_id === 'string') return null;
  if (!plantServerId || !UUID.test(plantServerId)) return null;
  return { ...rest, plant_id: plantServerId };
}

// The server's answer when it could not find the observation's plant.
export const PLANT_NOT_FOUND = 'plant_not_found';
