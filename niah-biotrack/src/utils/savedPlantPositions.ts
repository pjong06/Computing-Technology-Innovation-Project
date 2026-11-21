// savedPlantPositions.ts - the coordinates of other botanists' (and imported) approved plants,
// kept on the phone so "Find plant" can still show them without signal.
// Plain TypeScript with no imports (tested by offlineMap.test.mjs).
//
// Plants the botanist OPENED are already on the phone: the tag lookup caches them as records
// with their coordinates (tagLookup.ts). Plants only LISTED (the Plants tab and Home load
// GET /api/plants, kept in memory) are saved here when the list loads. Each successful load
// replaces the saved list, so a plant deleted on the server drops out the next time the
// phone is online.

export interface SavedPlantPosition {
  serverId: string;
  speciesId: string | null;
  tagCode: string | null;
  locationNote: string | null;
  latitude: number;
  longitude: number;
}

interface ListedPlantLike {
  serverId: string;
  speciesId: string | null;
  tagCode: string | null;
  details: { latitude: number | null; longitude: number | null; locationNote: string | null } | null;
}

const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

// The listed plants that have coordinates, in the form saved on the phone.
export function positionsFromList(plants: ListedPlantLike[]): SavedPlantPosition[] {
  const saved: SavedPlantPosition[] = [];
  for (const plant of plants) {
    const latitude = plant.details?.latitude;
    const longitude = plant.details?.longitude;
    if (!plant.serverId || !isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) continue;
    saved.push({
      serverId: plant.serverId,
      speciesId: plant.speciesId,
      tagCode: plant.tagCode,
      locationNote: plant.details?.locationNote ?? null,
      latitude,
      longitude,
    });
  }
  return saved;
}

// Reads the saved list back, dropping anything malformed (e.g. from an older app version).
export function parseSavedPositions(raw: string | null): SavedPlantPosition[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is SavedPlantPosition =>
        item && typeof item.serverId === 'string' && isCoordinate(item.latitude, 90) && isCoordinate(item.longitude, 180)
    );
  } catch {
    return [];
  }
}
