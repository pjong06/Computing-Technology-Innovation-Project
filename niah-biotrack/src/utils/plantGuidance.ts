// plantGuidance.ts - the maths for live "Find plant" guidance inside the app: which way the
// plant is, where the arrow points as the phone turns, when the botanist has arrived, and
// the walked trail (thinned so it stays light). Plain TypeScript with no imports (tested by
// plantGuidance.test.mjs).

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

// GPS readings less accurate than this get a warning (and are not added to the trail).
export const ACCURACY_WARNING_M = 30;
// "You've arrived": within this distance of the plant...
export const ARRIVAL_RADIUS_M = 10;
// ...plus up to this much extra when the GPS itself is only accurate to several metres, so a
// botanist standing at the plant isn't told to keep walking because of GPS scatter.
export const MAX_ARRIVAL_ALLOWANCE_M = 10;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const normalise = (deg: number) => ((deg % 360) + 360) % 360;

// Distance in metres (haversine).
export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Compass bearing from `from` to `to`, in degrees clockwise from north (0-360).
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const phi1 = toRad(from.latitude);
  const phi2 = toRad(to.latitude);
  const dLambda = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalise(toDeg(Math.atan2(y, x)));
}

// How far to rotate an "up" arrow on screen so it points at the plant, given which way the
// phone faces (compass heading). Without a compass reading the arrow shows the bearing
// itself (it then points correctly only when the phone faces north).
export function relativeArrowAngle(bearing: number, heading: number | null): number {
  return heading === null || !Number.isFinite(heading) ? normalise(bearing) : normalise(bearing - heading);
}

const DIRECTIONS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];

// The bearing in words: "North", "North-east", ...
export function bearingInWords(bearing: number): string {
  return DIRECTIONS[Math.round(normalise(bearing) / 45) % 8];
}

// The arrival radius for a GPS reading: 10 m, plus the reading's accuracy up to 10 m more.
export function arrivalRadius(accuracyM: number | null): number {
  const allowance = accuracyM !== null && Number.isFinite(accuracyM) && accuracyM > 0
    ? Math.min(accuracyM, MAX_ARRIVAL_ALLOWANCE_M)
    : 0;
  return ARRIVAL_RADIUS_M + allowance;
}

// Has the botanist arrived? Only with a usable reading (no worse than ±30 m).
export function hasArrived(distanceM: number | null, accuracyM: number | null): boolean {
  if (distanceM === null || !Number.isFinite(distanceM)) return false;
  if (accuracyM !== null && accuracyM > ACCURACY_WARNING_M) return false;
  return distanceM <= arrivalRadius(accuracyM);
}

export function isAccuracyPoor(accuracyM: number | null): boolean {
  return accuracyM !== null && accuracyM > ACCURACY_WARNING_M;
}

// Adds a GPS reading to the walked trail, thinned: readings closer than minStepM to the last
// kept point, or less accurate than ±30 m, are skipped (they would only draw jitter). When the
// trail grows past maxPoints, every other older point is dropped, so a long walk keeps its
// whole shape at a coarser resolution. Returns the same array when nothing changed.
export function appendTrailPoint<T extends GeoPoint & { accuracy?: number | null }>(
  trail: T[],
  point: T,
  { minStepM = 3, maxPoints = 400 }: { minStepM?: number; maxPoints?: number } = {}
): T[] {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return trail;
  if (isAccuracyPoor(point.accuracy ?? null)) return trail;
  const last = trail[trail.length - 1];
  if (last && distanceMeters(last, point) < minStepM) return trail;
  let next = [...trail, point];
  if (next.length > maxPoints) {
    // Keep the first and newest points; halve everything in between.
    const middle = next.slice(1, -1).filter((_, index) => index % 2 === 1);
    next = [next[0], ...middle, next[next.length - 1]];
  }
  return next;
}
