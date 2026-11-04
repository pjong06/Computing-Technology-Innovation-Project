// Small geometry helpers for walking to a plant. Coordinates are WGS84 degrees,
// as reported by expo-location and saved on PlantRecord.

const EARTH_RADIUS_M = 6371e3;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

// Straight-line ("as the crow flies") distance in metres, using the haversine formula.
// On a forest trail the walking distance will be longer.
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Direction to walk from point 1 to point 2, in degrees clockwise from true north (0-360).
export function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const DIRECTIONS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

// "north-east" etc. for a bearing (8 compass points, 45° each).
export function compassDirection(bearing: number): string {
  return DIRECTIONS[Math.round(bearing / 45) % 8];
}

// "85 m" under a kilometre, "1.4 km" above.
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}
