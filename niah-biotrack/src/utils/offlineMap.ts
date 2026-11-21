// offlineMap.ts - the maths behind the offline "Find plant" map (OfflinePlantMap.tsx): the
// phone in the centre, north up, everything else placed by its real bearing and distance.
// Plain TypeScript with no imports (tested by offlineMap.test.mjs).
//
// Distances here are short (a park, not a continent), so a flat-earth approximation is used:
// one degree of latitude is 111 320 m, one degree of longitude 111 320 m × cos(latitude).

export interface LatLng {
  latitude: number;
  longitude: number;
}

// Metres east and north of a reference point.
export interface Offset {
  east: number;
  north: number;
}

export interface ViewSize {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

const METRES_PER_DEGREE = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;

// How far east and north `to` is from `from`, in metres.
export function offsetMeters(from: LatLng, to: LatLng): Offset {
  const midLatitude = toRad((from.latitude + to.latitude) / 2);
  return {
    east: (to.longitude - from.longitude) * METRES_PER_DEGREE * Math.cos(midLatitude),
    north: (to.latitude - from.latitude) * METRES_PER_DEGREE,
  };
}

// The same offset from a bearing (degrees clockwise from north) and a distance in metres.
export function offsetFromBearing(bearingDeg: number, distanceM: number): Offset {
  return {
    east: Math.sin(toRad(bearingDeg)) * distanceM,
    north: Math.cos(toRad(bearingDeg)) * distanceM,
  };
}

// Where an offset from the phone appears on screen: the phone is the centre of the view,
// north is up (screen y grows downwards, so north is subtracted).
export function toScreen(offset: Offset, view: ViewSize, metresPerPixel: number): ScreenPoint {
  return {
    x: view.width / 2 + offset.east / metresPerPixel,
    y: view.height / 2 - offset.north / metresPerPixel,
  };
}

// Auto-zoom: the scale (metres per pixel) at which every offset fits inside the view with
// `padding` pixels to spare, with the phone staying in the centre. minRadiusM keeps it from
// zooming in absurdly when the plant is only a few metres away.
export function fitMetersPerPixel(
  offsets: Offset[],
  view: ViewSize,
  padding = 36,
  minRadiusM = 25
): number {
  const halfWidth = Math.max(1, view.width / 2 - padding);
  const halfHeight = Math.max(1, view.height / 2 - padding);
  let scale = minRadiusM / Math.min(halfWidth, halfHeight);
  for (const offset of offsets) {
    scale = Math.max(scale, Math.abs(offset.east) / halfWidth, Math.abs(offset.north) / halfHeight);
  }
  return scale;
}

// Keeps a point inside the view (margin pixels from the edge), along the line from the centre
// so its direction stays true. clamped: it was really further away than the view shows.
export function clampToView(point: ScreenPoint, view: ViewSize, margin = 16): ScreenPoint & { clamped: boolean } {
  const cx = view.width / 2;
  const cy = view.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const maxX = Math.max(1, cx - margin);
  const maxY = Math.max(1, cy - margin);
  const factor = Math.max(Math.abs(dx) / maxX, Math.abs(dy) / maxY, 1);
  return { x: cx + dx / factor, y: cy + dy / factor, clamped: factor > 1 };
}

// 1, 2, 5, 10, 20, 50, ... : the "nice" number at or above `value`.
export function niceAtLeast(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= value - 1e-9) return step * power;
  }
  return 10 * power;
}

// 1, 2, 5, 10, ... : the "nice" number at or below `value`.
function niceAtMost(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [10, 5, 2, 1]) {
    if (step * power <= value + 1e-9) return step * power;
  }
  return power;
}

export function formatMeters(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

// The scale bar: the longest nice distance (10 m, 20 m, 50 m, 100 m, ...) that fits in maxPx.
export function scaleBar(metresPerPixel: number, maxPx = 90): { meters: number; px: number; label: string } {
  const meters = niceAtMost(maxPx * metresPerPixel);
  return { meters, px: meters / metresPerPixel, label: formatMeters(meters) };
}

// Grid spacing: every 50 m normally. Zoomed out (to show a far plant) 50 m lines would be
// closer than minPx, so a wider nice distance is used; zoomed right in (50 m lines more than
// maxPx apart) a closer one, never under 10 m.
export function gridSpacingMeters(metresPerPixel: number, minPx = 22, maxPx = 160): number {
  const pxFor50 = 50 / metresPerPixel;
  if (pxFor50 < minPx) return niceAtLeast(minPx * metresPerPixel);
  if (pxFor50 > maxPx) return Math.max(10, niceAtLeast(minPx * 2 * metresPerPixel));
  return 50;
}

// The phone's position as metres east/north of 0°N 0°E: the grid is drawn at whole multiples
// of the spacing in these units, so it slides under the phone as the botanist walks.
export function absoluteMeters(point: LatLng): Offset {
  return {
    east: point.longitude * METRES_PER_DEGREE * Math.cos(toRad(point.latitude)),
    north: point.latitude * METRES_PER_DEGREE,
  };
}

// Screen positions of the grid lines: x of each vertical (north-south) line, y of each
// horizontal (east-west) line.
export function gridLines(
  phone: Offset,
  spacingM: number,
  metresPerPixel: number,
  view: ViewSize
): { xs: number[]; ys: number[] } {
  const halfWidthM = (view.width / 2) * metresPerPixel;
  const halfHeightM = (view.height / 2) * metresPerPixel;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let east = Math.ceil((phone.east - halfWidthM) / spacingM) * spacingM; east <= phone.east + halfWidthM; east += spacingM) {
    xs.push(view.width / 2 + (east - phone.east) / metresPerPixel);
  }
  for (let north = Math.ceil((phone.north - halfHeightM) / spacingM) * spacingM; north <= phone.north + halfHeightM; north += spacingM) {
    ys.push(view.height / 2 - (north - phone.north) / metresPerPixel);
  }
  return { xs, ys };
}

// The dashes of a dashed line from `from` to `to`: the centre, angle (degrees) and length of
// each, for drawing with small rotated Views.
export function dashSegments(
  from: ScreenPoint,
  to: ScreenPoint,
  dash = 8,
  gap = 6
): { x: number; y: number; angle: number; length: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const total = Math.hypot(dx, dy);
  if (total < 1) return [];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const segments: { x: number; y: number; angle: number; length: number }[] = [];
  for (let start = 0; start < total; start += dash + gap) {
    const length = Math.min(dash, total - start);
    const middle = (start + length / 2) / total;
    segments.push({ x: from.x + dx * middle, y: from.y + dy * middle, angle, length });
  }
  return segments;
}

// The other plants worth drawing: those within radiusM of the phone, nearest first.
export function plantsWithin<T extends LatLng>(here: LatLng, plants: T[], radiusM = 1000): T[] {
  return plants
    .map((plant) => {
      const offset = offsetMeters(here, plant);
      return { plant, distance: Math.hypot(offset.east, offset.north) };
    })
    .filter((item) => item.distance <= radiusM)
    .sort((a, b) => a.distance - b.distance)
    .map((item) => item.plant);
}
