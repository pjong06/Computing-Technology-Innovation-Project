// Tests for src/utils/offlineMap.ts and savedPlantPositions.ts: the offline "Find plant" map.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clampToView,
  dashSegments,
  fitMetersPerPixel,
  gridLines,
  gridSpacingMeters,
  offsetFromBearing,
  offsetMeters,
  plantsWithin,
  scaleBar,
  toScreen,
} from './offlineMap.ts';
import { parseSavedPositions, positionsFromList } from './savedPlantPositions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');
const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ${expected} ± ${tolerance}, got ${actual}`);

const PHONE = { latitude: 3.8150, longitude: 113.7800 };
const VIEW = { width: 320, height: 280 };

test('bearing and distance become screen x/y: phone in the centre, north up', () => {
  // 100 m due north of the phone, at 1 m per pixel: straight up from the centre.
  const north = toScreen(offsetFromBearing(0, 100), VIEW, 1);
  near(north.x, 160, 1e-9);
  near(north.y, 40, 1e-9);
  // Due east: to the right; due south: down; due west: to the left.
  const east = toScreen(offsetFromBearing(90, 100), VIEW, 1);
  near(east.x, 260, 1e-9);
  near(east.y, 140, 1e-9);
  near(toScreen(offsetFromBearing(180, 50), VIEW, 1).y, 190, 1e-9);
  near(toScreen(offsetFromBearing(270, 50), VIEW, 1).x, 110, 1e-9);
  // North-east at 2 m per pixel: equal parts right and up.
  const ne = toScreen(offsetFromBearing(45, 100), VIEW, 2);
  near(ne.x - 160, 140 - ne.y, 1e-9);

  // Real coordinates: about 111 m per 0.001° of latitude, and less per degree of longitude.
  const plantNorth = offsetMeters(PHONE, { latitude: 3.8160, longitude: 113.7800 });
  near(plantNorth.north, 111.3, 0.2);
  near(plantNorth.east, 0, 1e-9);
  const plantEast = offsetMeters(PHONE, { latitude: 3.8150, longitude: 113.7810 });
  near(plantEast.east, 111.3 * Math.cos((3.815 * Math.PI) / 180), 0.2);
  // Matches the bearing/distance form: a plant 200 m to the south-west lands where expected.
  const sw = offsetFromBearing(225, 200);
  near(Math.hypot(sw.east, sw.north), 200, 1e-9);
  assert.ok(sw.east < 0 && sw.north < 0);
});

test('auto-zoom fits the plant in view with the phone centred; never zooms in absurdly', () => {
  for (const [bearing, distance] of [[0, 30], [90, 400], [200, 1500], [315, 5000]]) {
    const offset = offsetFromBearing(bearing, distance);
    const scale = fitMetersPerPixel([offset], VIEW, 36);
    const point = toScreen(offset, VIEW, scale);
    assert.ok(point.x >= 36 - 1e-6 && point.x <= VIEW.width - 36 + 1e-6, `x ${point.x} for ${distance} m at ${bearing}°`);
    assert.ok(point.y >= 36 - 1e-6 && point.y <= VIEW.height - 36 + 1e-6, `y ${point.y} for ${distance} m at ${bearing}°`);
  }
  // A plant 2 m away: the view still shows at least 25 m around the phone.
  const close = fitMetersPerPixel([offsetFromBearing(10, 2)], VIEW, 36, 25);
  near(close, 25 / (Math.min(VIEW.width, VIEW.height) / 2 - 36), 1e-9);
  // Further plants zoom out.
  assert.ok(fitMetersPerPixel([offsetFromBearing(0, 800)], VIEW) > fitMetersPerPixel([offsetFromBearing(0, 80)], VIEW));
});

test('keep the plant on screen: a point outside is pulled in along its true direction', () => {
  const inside = clampToView({ x: 200, y: 100 }, VIEW, 16);
  assert.deepEqual(inside, { x: 200, y: 100, clamped: false });
  const far = clampToView({ x: 160 + 1000, y: 140 - 1000 }, VIEW, 16); // far north-east
  assert.equal(far.clamped, true);
  assert.ok(far.x <= VIEW.width - 16 + 1e-9 && far.y >= 16 - 1e-9);
  near(far.x - 160, 140 - far.y, 1e-9, 'still exactly north-east');
});

test('scale bar: the longest nice distance that fits, labelled in m or km', () => {
  assert.deepEqual(scaleBar(1, 90), { meters: 50, px: 50, label: '50 m' });
  assert.deepEqual(scaleBar(2, 90), { meters: 100, px: 50, label: '100 m' });
  const bar = scaleBar(3.1, 90);
  assert.equal(bar.meters, 200);
  near(bar.px, 200 / 3.1, 1e-9);
  assert.ok(bar.px <= 90);
  assert.equal(scaleBar(25, 90).label, '2 km');
  assert.equal(scaleBar(0.2, 90).label, '10 m');
});

test('grid: lines every ~50 m at walking scale, wider when zoomed out, fixed to the ground', () => {
  assert.equal(gridSpacingMeters(1), 50);
  assert.equal(gridSpacingMeters(1.5), 50);
  assert.ok(gridSpacingMeters(10) >= 200, 'zoomed out: no crowded lines');
  assert.ok(gridSpacingMeters(0.1) < 50 && gridSpacingMeters(0.1) >= 10, 'zoomed in: closer lines, never under 10 m');
  for (const scale of [0.1, 1, 3, 10, 40]) {
    assert.ok(gridSpacingMeters(scale) / scale >= 22 - 1e-9, `at ${scale} m/px the lines are at least 22 px apart`);
  }
  // Lines sit at whole multiples of the spacing: walking 20 m east moves them 20 px left at 1 m/px.
  const before = gridLines({ east: 1000, north: 0 }, 50, 1, VIEW);
  const after = gridLines({ east: 1020, north: 0 }, 50, 1, VIEW);
  assert.ok(before.xs.includes(160), 'a line through the phone at a multiple of 50 m');
  assert.ok(after.xs.includes(140));
  assert.ok(before.xs.every((x) => x >= 0 && x <= VIEW.width) && before.ys.every((y) => y >= 0 && y <= VIEW.height));
});

test('dashed line from the phone to the plant: dashes along the line, none past the end', () => {
  const dashes = dashSegments({ x: 0, y: 0 }, { x: 100, y: 0 }, 8, 6);
  assert.equal(dashes.length, Math.ceil(100 / 14));
  assert.ok(dashes.every((dash) => dash.angle === 0 && dash.y === 0 && dash.x + dash.length / 2 <= 100 + 1e-9));
  const diagonal = dashSegments({ x: 0, y: 0 }, { x: 30, y: 40 });
  near(diagonal[0].angle, (Math.atan2(40, 30) * 180) / Math.PI, 1e-9);
  assert.deepEqual(dashSegments({ x: 5, y: 5 }, { x: 5, y: 5 }), []);
});

test('other plants: only those within 1 km, nearest first', () => {
  const plants = [
    { key: 'far', latitude: 3.8300, longitude: 113.7800 }, // ~1.7 km north
    { key: 'mid', latitude: 3.8190, longitude: 113.7800 }, // ~445 m
    { key: 'near', latitude: 3.8155, longitude: 113.7800 }, // ~56 m
  ];
  assert.deepEqual(plantsWithin(PHONE, plants, 1000).map((plant) => plant.key), ['near', 'mid']);
});

test('coordinates of listed plants are kept on the phone for offline use', () => {
  const saved = positionsFromList([
    { serverId: 'a', speciesId: 's1', tagCode: 'NIAH-PLT-00001', details: { latitude: 3.81, longitude: 113.78, locationNote: 'Zone B' } },
    { serverId: 'b', speciesId: null, tagCode: null, details: { latitude: null, longitude: null, locationNote: null } },
    { serverId: 'c', speciesId: null, tagCode: null, details: null },
    { serverId: 'd', speciesId: null, tagCode: null, details: { latitude: 95, longitude: 113, locationNote: null } },
  ]);
  assert.deepEqual(saved, [
    { serverId: 'a', speciesId: 's1', tagCode: 'NIAH-PLT-00001', locationNote: 'Zone B', latitude: 3.81, longitude: 113.78 },
  ]);
  assert.deepEqual(parseSavedPositions(JSON.stringify(saved)), saved);
  assert.deepEqual(parseSavedPositions('not json'), []);
  assert.deepEqual(parseSavedPositions(null), []);
  assert.deepEqual(parseSavedPositions(JSON.stringify([{ serverId: 'x', latitude: 'a' }])), []);

  // Saved on every successful list load, read back offline, cleared at logout.
  const store = read('../store/usePlantListStore.ts');
  assert.match(store, /const savedPositions = positionsFromList\(list\.others\);/);
  assert.match(store, /AsyncStorage\.setItem\(SAVED_POSITIONS_KEY, JSON\.stringify\(savedPositions\)\)/);
  assert.match(store, /parseSavedPositions\(raw\)/);
  assert.match(read('../context/AuthRoleContext.tsx'), /await clearSavedPlantList\(\);/);
  // Plants opened while online are cached as records with their server coordinates.
  assert.match(read('../services/tagLookup.ts'), /latitude: serverDetails\?\.latitude \?\? undefined,/);
});

test('Find plant: offline or without tiles, the phone-drawn map replaces the blank one; the online map stays', () => {
  const map = read('../components/TransectMapView.tsx');
  // The map page reports whether tiles arrive (and when Leaflet itself could not load).
  assert.match(map, /layer\.on\('tileload'/);
  assert.match(map, /layer\.on\('tileerror'/);
  assert.match(map, /typeof L === 'undefined'/);
  assert.match(map, /const showOffline = offline \|\| tiles === 'failed';/);
  // It switches back by itself: a loaded tile sets 'ok', and the page is retried while failing.
  assert.match(map, /if \(message === 'tiles-ok'\) setTiles\('ok'\);/);
  assert.match(map, /setInterval\(\(\) => webViewRef\.current\?\.reload\(\), TILE_RETRY_MS\)/);

  const screen = read('../../app/navigate-plant.tsx');
  assert.match(screen, /offline=\{offline\}/);
  assert.match(screen, /<OfflinePlantMap\s+here=\{currentPoint\}\s+headingDegrees=\{headingDegrees\}/);
  // Arrival allows for GPS accuracy (plantGuidance.ts); distance and direction are on the map panel.
  assert.match(screen, /const hasArrived = isWithinArrival\(distanceToPlant, currentPoint\?\.accuracy \?\? null\);/);
  assert.match(screen, /overlay=\{guidancePanel\}/);

  const offlineView = read('../components/OfflinePlantMap.tsx');
  assert.match(offlineView, /Offline map: GPS and compass only/);
  assert.doesNotMatch(offlineView, /react-native-svg|react-native-maps|WebView/);
});

test('Find plant layout: guidance on the map, zoom and follow, plant card below', () => {
  const screen = read('../../app/navigate-plant.tsx');
  // No separate guidance box or distance/compass card any more: the panel sits on the map.
  assert.doesNotMatch(screen, /styles\.guideCard|styles\.telemetryCard|DISTANCE TO PLANT/);
  assert.match(screen, /const guidancePanel = selectedTarget \? \(/);
  assert.match(screen, /heading=\{headingDegrees\}/);
  assert.match(screen, /follow=\{navigating\}/);
  // Below the map: the plant card ("Change plant") and Start / Stop.
  assert.match(screen, /styles\.plantCard/);
  assert.match(screen, />Change plant</);

  const map = read('../components/TransectMapView.tsx');
  // Pinch, drag and double-tap zoom; a metric scale bar; + / − / recenter buttons.
  assert.match(map, /dragging: true,\s*touchZoom: true,\s*doubleClickZoom: true/);
  assert.match(map, /L\.control\.scale\(\{ metric: true, imperial: false/);
  assert.match(map, /<MapControls onZoomIn=\{\(\) => zoom\(1\)\} onZoomOut=\{\(\) => zoom\(-1\)\} onRecenter=\{handleRecenter\}/);
  // Following pauses on a manual pan, pinch or double-tap, until recenter.
  assert.match(map, /map\.on\('dragstart', pauseFollowing\);/);
  assert.match(map, /event\.touches\.length > 1\) pauseFollowing\(\)/);
  assert.match(map, /window\.recenterMap = function\(\) \{\s*following = true;/);
  // The phone is an arrow with a direction cone turning with the compass.
  assert.match(map, /me-cone/);
  assert.match(map, /rot\.style\.transform = 'rotate\('/);

  const offlineView = read('../components/OfflinePlantMap.tsx');
  assert.match(offlineView, /<MapControls/);
  assert.match(offlineView, /fitMetersPerPixel\(\[targetOffset\], view\) \* 2 \*\* -zoomSteps/);
  assert.match(offlineView, /styles\.meCone/);
});
