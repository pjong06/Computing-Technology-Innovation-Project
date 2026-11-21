// plantDetails.ts - what "This plant" shows: the phone's own values and the server's
// details of approved plants (GET /api/plants and the tag lookup send them as "details";
// backend/src/services/plantDetails.js), merged in one place.
//   - The botanist's own plants: the phone's values first; where one is empty, the server's.
//   - Plants someone else registered (or imported ones): the server's values first; where one
//     is empty, the phone's (e.g. an observation this botanist added).
// Coordinates and their accuracy always come together from one source.
// Plain TypeScript with no imports (tested by plantDetails.test.mjs).

export interface ServerPlantDetails {
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyM: number | null;
  locationNote: string | null;
  morphology: string | null;
  notes: string | null;
  // The latest approved observation (newest value per field).
  observedAt: string | null;
  heightCm: number | null;
  diameterCm: number | null;
  health: string | null;
  stage: string | null;
}

export type PlantDetailValues = ServerPlantDetails;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// The server's "details" object (snake_case) for the app, or null when there is none.
export function detailsFromServer(raw: unknown): ServerPlantDetails | null {
  if (!raw || typeof raw !== 'object') return null;
  const details = raw as Record<string, unknown>;
  const latest = (details.latest_observation && typeof details.latest_observation === 'object'
    ? details.latest_observation
    : {}) as Record<string, unknown>;
  const heightM = num(latest.height_m);
  const latitude = num(details.latitude);
  const longitude = num(details.longitude);
  const located = latitude !== null && longitude !== null;
  return {
    latitude: located ? latitude : null,
    longitude: located ? longitude : null,
    gpsAccuracyM: located ? num(details.gps_accuracy_m) : null,
    locationNote: text(details.location_note),
    morphology: text(details.morphology),
    notes: text(details.notes),
    observedAt: text(latest.observed_at),
    // Sent in metres; the app keeps heights in centimetres.
    heightCm: heightM === null ? null : Math.round(heightM * 100),
    diameterCm: num(latest.diameter_cm),
    health: text(latest.health_status),
    stage: text(latest.life_stage),
  };
}

const EMPTY: PlantDetailValues = {
  latitude: null, longitude: null, gpsAccuracyM: null, locationNote: null, morphology: null, notes: null,
  observedAt: null, heightCm: null, diameterCm: null, health: null, stage: null,
};

function firstSet<T>(first: T | null | undefined, second: T | null | undefined): T | null {
  const isSet = (value: T | null | undefined) =>
    value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');
  if (isSet(first)) return first as T;
  return isSet(second) ? (second as T) : null;
}

// The values "This plant" shows. own: the botanist registered this plant.
export function pickPlantDetails(
  own: boolean,
  local: Partial<PlantDetailValues>,
  server: ServerPlantDetails | null | undefined
): PlantDetailValues {
  const phone = { ...EMPTY, ...local };
  const remote = server ?? EMPTY;
  const [primary, secondary] = own ? [phone, remote] : [remote, phone];
  const hasPair = (values: PlantDetailValues) => values.latitude !== null && values.longitude !== null;
  const located = hasPair(primary) ? primary : hasPair(secondary) ? secondary : EMPTY;
  return {
    latitude: located.latitude,
    longitude: located.longitude,
    gpsAccuracyM: located.gpsAccuracyM,
    locationNote: firstSet(primary.locationNote, secondary.locationNote),
    morphology: firstSet(primary.morphology, secondary.morphology),
    notes: firstSet(primary.notes, secondary.notes),
    observedAt: firstSet(primary.observedAt, secondary.observedAt),
    heightCm: firstSet(primary.heightCm, secondary.heightCm),
    diameterCm: firstSet(primary.diameterCm, secondary.diameterCm),
    health: firstSet(primary.health, secondary.health),
    stage: firstSet(primary.stage, secondary.stage),
  };
}

// "Navigate to plant": an approved plant with coordinates (from the phone or the server).
export function navigableCoordinates(
  record: { latitude?: number | null; longitude?: number | null; serverDetails?: ServerPlantDetails | null }
): { latitude: number; longitude: number } | null {
  const valid = (lat: unknown, lng: unknown) =>
    typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
  if (valid(record.latitude, record.longitude)) {
    return { latitude: record.latitude as number, longitude: record.longitude as number };
  }
  const server = record.serverDetails;
  if (server && valid(server.latitude, server.longitude)) {
    return { latitude: server.latitude as number, longitude: server.longitude as number };
  }
  return null;
}
