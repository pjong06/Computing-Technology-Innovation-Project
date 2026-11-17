// Tests for src/utils/routeSync.ts. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildRouteUpload,
  linkedPlantServerId,
  routesToUpload,
  migrateRoutesToV10,
  routeSyncLabel,
  routesUploadedText,
  DRAFT_ROUTE_WAIT_MS,
} from './routeSync.ts';

const CLIENT_ROUTE_ID = '33333333-3333-4333-8333-333333333333';
const PLANT_SERVER_ID = '44444444-4444-4444-8444-444444444444';

function savedRoute(overrides = {}) {
  return {
    id: 'route-1795400000000',
    distanceMeters: 842.46,
    durationSeconds: 1800,
    endLatitude: 3.8183,
    endLongitude: 113.7819,
    endAccuracyM: 7,
    breadcrumbs: [
      { latitude: 3.8176, longitude: 113.781, timestamp: 1795400000000, accuracy: 6 },
      { latitude: 3.8179, longitude: 113.7814, timestamp: 1795400900000, accuracy: null },
      { latitude: 3.8183, longitude: 113.7819, timestamp: 1795401800000, accuracy: 8 },
    ],
    waypoints: [{ id: 'w1', number: 1, label: '  Cave entrance ', latitude: 3.8179, longitude: 113.7814, timeString: '9:15 AM' }],
    createdAt: '2026-11-18T01:30:05.000Z',
    clientRouteId: CLIENT_ROUTE_ID,
    syncStatus: 'not_uploaded',
    ...overrides,
  };
}

test('upload request: the format POST /api/routes checks', () => {
  const body = buildRouteUpload(savedRoute(), null);
  assert.deepEqual(body, {
    client_route_id: CLIENT_ROUTE_ID,
    started_at: new Date(1795400000000).toISOString(),
    ended_at: new Date(1795401800000).toISOString(),
    distance_m: 842.5,
    duration_s: 1800,
    points: [
      [3.8176, 113.781, 1795400000000, 6],
      [3.8179, 113.7814, 1795400900000, null],
      [3.8183, 113.7819, 1795401800000, 8],
    ],
    waypoints: [{ number: 1, label: 'Cave entrance', lat: 3.8179, lng: 113.7814, time: '9:15 AM' }],
  });
  assert.equal('plant_id' in body, false, 'no plant_id without a synced plant');
  // Same route, same request: a repeat upload finds the same server row.
  assert.deepEqual(buildRouteUpload(savedRoute(), null), body);
});

test('upload request: a route with no GPS trail uses its end point and the walking time', () => {
  const body = buildRouteUpload(savedRoute({ breadcrumbs: [] }), PLANT_SERVER_ID);
  assert.deepEqual(body.points, [[3.8183, 113.7819, Date.parse('2026-11-18T01:30:05.000Z'), 7]]);
  assert.equal(body.ended_at, '2026-11-18T01:30:05.000Z');
  assert.equal(body.started_at, '2026-11-18T01:00:05.000Z'); // 1800 s earlier
  assert.equal(body.plant_id, PLANT_SERVER_ID);
});

test('upload request: long labels and times are cut to the server limits; no upload ID is an error', () => {
  const body = buildRouteUpload(
    savedRoute({ waypoints: [{ number: 2, label: 'x'.repeat(250), latitude: 3.8, longitude: 113.7, timeString: 't'.repeat(60) }] }),
    null
  );
  assert.equal(body.waypoints[0].label.length, 200);
  assert.equal(body.waypoints[0].time.length, 50);
  assert.throws(() => buildRouteUpload(savedRoute({ clientRouteId: undefined }), null), /no upload ID/);
});

test('plant link option A: only a plant that has already synced is sent', () => {
  const records = [
    { id: 'local-1', serverId: PLANT_SERVER_ID },
    { id: 'local-2' }, // registered on this walk, not synced yet
  ];
  assert.equal(linkedPlantServerId({ linkedPlantId: 'local-1' }, records), PLANT_SERVER_ID);
  assert.equal(linkedPlantServerId({ linkedPlantId: PLANT_SERVER_ID }, records), PLANT_SERVER_ID);
  assert.equal(linkedPlantServerId({ linkedPlantId: 'local-2' }, records), null);
  assert.equal(linkedPlantServerId({ linkedPlantId: 'gone' }, records), null);
  assert.equal(linkedPlantServerId({}, records), null);
});

test('which routes to upload: all not uploaded yet; a fresh route waiting on Link route waits', () => {
  const now = Date.parse('2026-11-18T02:00:00.000Z');
  const routes = [
    savedRoute({ id: 'a', syncStatus: 'uploaded' }),
    savedRoute({ id: 'b', syncStatus: 'not_uploaded' }),
    savedRoute({ id: 'c', syncStatus: 'failed' }),
    savedRoute({ id: 'd', syncStatus: 'uploading' }), // left over from a closed app
    savedRoute({ id: 'e', syncStatus: undefined }),
    savedRoute({ id: 'draft', createdAt: new Date(now - 60_000).toISOString() }),
  ];
  assert.deepEqual(routesToUpload(routes, 'draft', now).map((r) => r.id), ['b', 'c', 'd', 'e']);
  // After 30 minutes the waiting route uploads anyway (the botanist may have left that screen).
  const later = now + DRAFT_ROUTE_WAIT_MS;
  assert.deepEqual(routesToUpload(routes, 'draft', later).map((r) => r.id), ['b', 'c', 'd', 'e', 'draft']);
  assert.deepEqual(routesToUpload(routes, null, now).map((r) => r.id), ['b', 'c', 'd', 'e', 'draft']);
});

test('migration v9 -> v10: routes get an upload ID and "not uploaded"; existing values stay', () => {
  let n = 0;
  const makeId = () => `uuid-${++n}`;
  const oldRoutes = [
    { id: 'route-1', distanceMeters: 100, createdAt: '2026-11-10T00:00:00Z' },
    { id: 'route-2', distanceMeters: 200, createdAt: '2026-11-11T00:00:00Z', clientRouteId: 'kept', syncStatus: 'uploaded', serverId: 's2' },
    { id: 'route-3', syncStatus: 'nonsense' },
  ];
  const migrated = migrateRoutesToV10(oldRoutes, makeId);
  assert.deepEqual(migrated[0], { ...oldRoutes[0], clientRouteId: 'uuid-1', syncStatus: 'not_uploaded' });
  assert.deepEqual(migrated[1], oldRoutes[1]);
  assert.equal(migrated[2].syncStatus, 'not_uploaded');
  assert.equal(migrated[2].clientRouteId, 'uuid-2');
  // The originals are not changed.
  assert.equal('clientRouteId' in oldRoutes[0], false);
});

test('the store migration to v10 only touches routes, never plant records', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const store = fs.readFileSync(path.join(here, '../store/useRecordStore.ts'), 'utf8');
  assert.match(store, /version: 10,/);
  const start = store.indexOf('version < 10');
  assert.ok(start > 0, 'there is a v10 step');
  const block = store.slice(start, store.indexOf('return state as unknown as', start));
  assert.match(block, /migrateRoutesToV10\(\s*state\.routes,\s*randomUUID\s*\)/);
  assert.doesNotMatch(block, /state\.records/);
});

test('labels shown on the phone', () => {
  assert.equal(routeSyncLabel('not_uploaded'), 'Not uploaded');
  assert.equal(routeSyncLabel(undefined), 'Not uploaded');
  assert.equal(routeSyncLabel('uploading'), 'Uploading…');
  assert.equal(routeSyncLabel('uploaded'), 'Uploaded');
  assert.equal(routeSyncLabel('failed'), 'Upload failed');
  assert.equal(routesUploadedText(1), '1 route uploaded');
  assert.equal(routesUploadedText(4), '4 routes uploaded');
});
