// routeSync.ts - uploading trace routes (transects), separate from the plant/visit sync.
// Plain TypeScript with no imports, so Node can test it directly
// (src/utils/routeSync.test.mjs). Plan: docs/trace-route-plan.md, section 2.2.
//
// The request body matches what POST /api/routes checks (backend/src/routes/fieldRoutes.js):
//   { client_route_id, plant_id?, started_at, ended_at, distance_m, duration_s,
//     points: [[lat, lng, recorded_at_ms, accuracy_m | null], ...],
//     waypoints: [{ number, label, lat, lng, time }, ...] }

export type RouteSyncStatus = 'not_uploaded' | 'uploading' | 'uploaded' | 'failed';

export interface RouteSyncPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number | null;
}

export interface RouteSyncWaypoint {
  number: number;
  label: string;
  latitude: number;
  longitude: number;
  timeString: string;
}

export interface RouteSyncFields {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  endLatitude?: number;
  endLongitude?: number;
  endAccuracyM?: number | null;
  breadcrumbs?: RouteSyncPoint[];
  waypoints?: RouteSyncWaypoint[];
  linkedPlantId?: string;
  createdAt: string;
  clientRouteId?: string;
  syncStatus?: RouteSyncStatus;
  serverId?: string;
  syncError?: string | null;
}

export interface RouteUploadBody {
  client_route_id: string;
  plant_id?: string;
  started_at: string;
  ended_at: string;
  distance_m: number;
  duration_s: number;
  points: [number, number, number, number | null][];
  waypoints: { number: number; label: string; lat: number; lng: number; time: string }[];
}

// The server's limits (fieldRoutes.js); a value over them is sent as is and the server's
// plain reason is shown on the route.
const MAX_LABEL_LENGTH = 200;
const MAX_TIME_TEXT_LENGTH = 50;

// A route just finished and still waiting on the Link route screen is not uploaded yet,
// so its plant link can go with it. After this long it uploads anyway (the botanist may
// have left that screen without linking).
export const DRAFT_ROUTE_WAIT_MS = 30 * 60 * 1000;

// Plant link, option A: send the plant only when it has already synced (it has a server
// id). A route linked to a plant that is still only on the phone uploads without the link.
export function linkedPlantServerId(
  route: Pick<RouteSyncFields, 'linkedPlantId'>,
  records: { id: string; serverId?: string }[]
): string | null {
  if (!route.linkedPlantId) return null;
  const plant = records.find(
    (record) => record.id === route.linkedPlantId || record.serverId === route.linkedPlantId
  );
  return plant?.serverId ?? null;
}

// The upload request for one saved route.
export function buildRouteUpload(route: RouteSyncFields, plantServerId: string | null): RouteUploadBody {
  if (!route.clientRouteId) {
    throw new Error('This route has no upload ID yet.');
  }
  const created = Date.parse(route.createdAt);
  const savedAt = Number.isNaN(created) ? Date.now() : created;

  let crumbs = (route.breadcrumbs ?? []).filter(
    (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  );
  if (crumbs.length === 0 && Number.isFinite(route.endLatitude) && Number.isFinite(route.endLongitude)) {
    crumbs = [
      {
        latitude: route.endLatitude as number,
        longitude: route.endLongitude as number,
        timestamp: savedAt,
        accuracy: route.endAccuracyM ?? null,
      },
    ];
  }

  const durationS = Math.max(0, Math.round(route.durationSeconds));
  const times = crumbs.map((point) => point.timestamp).filter((time) => Number.isFinite(time));
  // Start and end from the GPS points. With fewer than two points (e.g. only the end
  // point), the start is the end minus the walking time.
  const endedAtMs = times.length > 0 ? Math.max(...times) : savedAt;
  const startedAtMs = times.length >= 2 ? Math.min(...times) : endedAtMs - durationS * 1000;

  const body: RouteUploadBody = {
    client_route_id: route.clientRouteId,
    started_at: new Date(startedAtMs).toISOString(),
    ended_at: new Date(Math.max(endedAtMs, startedAtMs)).toISOString(),
    distance_m: Math.max(0, Math.round(route.distanceMeters * 10) / 10),
    duration_s: durationS,
    points: crumbs.map((point) => [
      point.latitude,
      point.longitude,
      Number.isFinite(point.timestamp) ? point.timestamp : savedAt,
      typeof point.accuracy === 'number' && Number.isFinite(point.accuracy) && point.accuracy >= 0
        ? point.accuracy
        : null,
    ]),
    waypoints: (route.waypoints ?? []).map((waypoint) => ({
      number: waypoint.number,
      label: String(waypoint.label ?? '').trim().slice(0, MAX_LABEL_LENGTH),
      lat: waypoint.latitude,
      lng: waypoint.longitude,
      time: String(waypoint.timeString ?? '').slice(0, MAX_TIME_TEXT_LENGTH),
    })),
  };
  if (plantServerId) body.plant_id = plantServerId;
  return body;
}

// Which saved routes to upload now: everything not uploaded yet (an "uploading" left over
// from a closed app is tried again; the server answers 200 for a repeat). A route that is
// still waiting on the Link route screen waits up to DRAFT_ROUTE_WAIT_MS.
export function routesToUpload<T extends RouteSyncFields>(
  routes: T[],
  activeDraftRouteId: string | null,
  now: number
): T[] {
  return routes.filter((route) => {
    if (route.syncStatus === 'uploaded') return false;
    if (route.id === activeDraftRouteId) {
      const created = Date.parse(route.createdAt);
      if (!Number.isNaN(created) && now - created < DRAFT_ROUTE_WAIT_MS) return false;
    }
    return true;
  });
}

// Store migration v9 -> v10: routes saved before route sync get an upload ID and
// "not uploaded". Routes that already have the fields are left as they are.
export function migrateRoutesToV10<T extends Record<string, unknown>>(
  routes: T[],
  makeId: () => string
): (T & { clientRouteId: string; syncStatus: RouteSyncStatus })[] {
  return routes.map((route) => ({
    ...route,
    clientRouteId:
      typeof route.clientRouteId === 'string' && route.clientRouteId !== ''
        ? route.clientRouteId
        : makeId(),
    syncStatus: isRouteSyncStatus(route.syncStatus) ? route.syncStatus : 'not_uploaded',
  }));
}

function isRouteSyncStatus(value: unknown): value is RouteSyncStatus {
  return value === 'not_uploaded' || value === 'uploading' || value === 'uploaded' || value === 'failed';
}

// The words shown next to a saved route.
export function routeSyncLabel(status: RouteSyncStatus | undefined): string {
  switch (status) {
    case 'uploaded':
      return 'Uploaded';
    case 'uploading':
      return 'Uploading…';
    case 'failed':
      return 'Upload failed';
    default:
      return 'Not uploaded';
  }
}

// "1 route uploaded" / "3 routes uploaded".
export function routesUploadedText(count: number): string {
  return `${count} ${count === 1 ? 'route' : 'routes'} uploaded`;
}
