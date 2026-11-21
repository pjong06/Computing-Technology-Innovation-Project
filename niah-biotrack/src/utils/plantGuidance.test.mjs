// Tests for src/utils/plantGuidance.ts: live "Find plant" guidance inside the app.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCURACY_WARNING_M,
  appendTrailPoint,
  arrivalRadius,
  bearingDegrees,
  bearingInWords,
  distanceMeters,
  hasArrived,
  isAccuracyPoor,
  relativeArrowAngle,
} from './plantGuidance.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');
const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ${expected} ± ${tolerance}, got ${actual}`);

const PHONE = { latitude: 3.815, longitude: 113.78 };
// ~0.001° of latitude ≈ 111 m; near the equator 0.001° of longitude ≈ 111 m too.
const north = { latitude: 3.816, longitude: 113.78 };
const east = { latitude: 3.815, longitude: 113.781 };
const southWest = { latitude: 3.814, longitude: 113.779 };

test('bearing: degrees clockwise from north, 0-360', () => {
  near(bearingDegrees(PHONE, north), 0, 0.01);
  near(bearingDegrees(PHONE, east), 90, 0.01);
  near(bearingDegrees(PHONE, { latitude: 3.814, longitude: 113.78 }), 180, 0.01);
  near(bearingDegrees(PHONE, southWest), 225, 0.1);
  near(bearingDegrees(PHONE, { latitude: 3.815, longitude: 113.779 }), 270, 0.01);
  near(distanceMeters(PHONE, north), 111.2, 0.3);
});

test('arrow angle: rotates with the phone heading so it points at the plant', () => {
  // Plant due east; phone facing north: arrow points right (90°).
  assert.equal(relativeArrowAngle(90, 0), 90);
  // Phone turned to face east: arrow points straight ahead.
  assert.equal(relativeArrowAngle(90, 90), 0);
  // Phone facing south: arrow points right-behind-left... i.e. to the phone's left (270°).
  assert.equal(relativeArrowAngle(90, 180), 270);
  // Wraps around north.
  assert.equal(relativeArrowAngle(10, 350), 20);
  assert.equal(relativeArrowAngle(350, 10), 340);
  // No compass: the bearing itself.
  assert.equal(relativeArrowAngle(225, null), 225);
  assert.equal(relativeArrowAngle(-45, null), 315);
  assert.equal(relativeArrowAngle(45, Number.NaN), 45);
});

test('bearing in words', () => {
  assert.equal(bearingInWords(0), 'North');
  assert.equal(bearingInWords(44), 'North-east');
  assert.equal(bearingInWords(90), 'East');
  assert.equal(bearingInWords(135), 'South-east');
  assert.equal(bearingInWords(181), 'South');
  assert.equal(bearingInWords(225), 'South-west');
  assert.equal(bearingInWords(270), 'West');
  assert.equal(bearingInWords(316), 'North-west');
  assert.equal(bearingInWords(359), 'North');
  assert.equal(bearingInWords(-90), 'West');
});

test('arrival: within 10 m, allowing up to 10 m more for GPS accuracy; never on a weak reading', () => {
  assert.equal(arrivalRadius(null), 10);
  assert.equal(arrivalRadius(4), 14);
  assert.equal(arrivalRadius(25), 20);
  assert.equal(hasArrived(9.9, null), true);
  assert.equal(hasArrived(10.5, null), false);
  assert.equal(hasArrived(13, 5), true, 'GPS ±5 m: 13 m counts');
  assert.equal(hasArrived(16, 5), false);
  assert.equal(hasArrived(19, 15), true, 'allowance capped at 10 m');
  assert.equal(hasArrived(21, 15), false);
  assert.equal(hasArrived(5, 40), false, 'worse than ±30 m: not trusted');
  assert.equal(hasArrived(null, 5), false);
  assert.equal(isAccuracyPoor(ACCURACY_WARNING_M + 1), true);
  assert.equal(isAccuracyPoor(ACCURACY_WARNING_M), false);
  assert.equal(isAccuracyPoor(null), false);
});

test('trail: thinned (no jitter, no weak fixes) and capped while keeping the whole walk', () => {
  let trail = [];
  trail = appendTrailPoint(trail, { ...PHONE, accuracy: 5 });
  assert.equal(trail.length, 1);
  // Under 3 m from the last kept point: skipped (same array back).
  const before = trail;
  trail = appendTrailPoint(trail, { latitude: 3.81501, longitude: 113.78, accuracy: 5 });
  assert.equal(trail, before);
  // Weaker than ±30 m: skipped.
  trail = appendTrailPoint(trail, { latitude: 3.8152, longitude: 113.78, accuracy: 45 });
  assert.equal(trail.length, 1);
  // A real step (~22 m): kept.
  trail = appendTrailPoint(trail, { latitude: 3.8152, longitude: 113.78, accuracy: 8 });
  assert.equal(trail.length, 2);
  // Not a number: ignored.
  assert.equal(appendTrailPoint(trail, { latitude: Number.NaN, longitude: 113.78 }), trail);

  // A long walk: never more than maxPoints, first and newest points kept.
  let walk = [];
  for (let i = 0; i < 500; i++) {
    walk = appendTrailPoint(walk, { latitude: 3.815 + i * 0.0001, longitude: 113.78, accuracy: 5 }, { maxPoints: 100 });
    assert.ok(walk.length <= 100);
  }
  assert.equal(walk[0].latitude, 3.815);
  near(walk[walk.length - 1].latitude, 3.815 + 499 * 0.0001, 1e-12);
  for (let i = 1; i < walk.length; i++) assert.ok(walk[i].latitude > walk[i - 1].latitude, 'still in walking order');
});

test('Find plant screen: navigation inside the app, Google Maps only as a small link', () => {
  const screen = read('../../app/navigate-plant.tsx');
  // Main button and live guidance with Stop.
  assert.match(screen, />Start navigation</);
  assert.match(screen, />Stop</);
  assert.match(screen, /relativeArrowAngle\(bearingToPlant, headingDegrees\)/);
  assert.match(screen, /bearingInWords\(bearingToPlant\)/);
  assert.match(screen, /setTrail\(\(current\) => appendTrailPoint\(current, currentPoint\)\)/);
  assert.match(screen, /trail=\{navigating \? trail : \[\]\}/);
  // Position every second; GPS and compass only while the screen is focused.
  assert.match(screen, /timeInterval: 1_000/);
  assert.match(screen, /useFocusEffect\(\s*useCallback\(/);
  // Keep awake only while navigating; one buzz on arrival; Scan tag and Record observation.
  assert.match(screen, /activateKeepAwakeAsync\(KEEP_AWAKE_TAG\)/);
  assert.match(screen, /deactivateKeepAwake\(KEEP_AWAKE_TAG\)/);
  assert.match(screen, /Vibration\.vibrate\(ARRIVAL_VIBRATION_MS\)/);
  assert.match(screen, /You've arrived/);
  assert.match(screen, />Scan tag</);
  assert.match(screen, />Record observation</);
  assert.match(screen, /pathname: '\/add-observation'/);
  // Google Maps is no longer the main action: only the small "Open in Maps" link.
  assert.doesNotMatch(screen, /Open walking directions in Google Maps/);
  assert.match(screen, />Open in Maps</);
  assert.equal((screen.match(/Linking\.openURL/g) || []).length, 1);

  // Both maps draw the trail; vibration is allowed on Android builds; keep-awake is a direct dependency.
  assert.match(read('../components/TransectMapView.tsx'), /trailLine\.setLatLngs\(data\.trail \|\| \[\]\)/);
  assert.match(read('../components/OfflinePlantMap.tsx'), /trailSegments\.map/);
  assert.ok(JSON.parse(read('../../app.json')).expo.android.permissions.includes('android.permission.VIBRATE'));
  assert.ok(JSON.parse(read('../../package.json')).dependencies['expo-keep-awake']);
});
