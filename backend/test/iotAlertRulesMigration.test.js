
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20261115090001_unify_iot_alert_rules.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');

test('migration supports all required IoT sensor metrics', () => {
  for (const metric of [
    'temperature_c',
    'soil_moisture_pct',
    'rain_intensity_pct',
    'movement_nearby_cm',
    'movement_detected',
  ]) {
    assert.ok(
      sql.includes(`'${metric}'`),
      `Missing metric: ${metric}`,
    );
  }
});

test('migration includes the agreed default thresholds', () => {
  const defaults = [
    ['temperature_c', '>=', 35],
    ['soil_moisture_pct', '<=', 20],
    ['rain_intensity_pct', '>=', 70],
    ['movement_nearby_cm', '<=', 50],
  ];

  for (const [metric, operator, threshold] of defaults) {
    const expected = `'${metric}', '${operator}', ${threshold}`;
    assert.ok(
      sql.includes(expected),
      `Missing default: ${expected}`,
    );
  }
});

test('proximity requires valid distance readings', () => {
  assert.match(sql, /NEW\.distance_valid\s+IS\s+TRUE/i);
});

test('station-specific rules override global rules', () => {
  assert.match(sql, /specific\.station_id\s*=\s*NEW\.station_id/i);
  assert.match(sql, /specific\.metric\s*=\s*r\.metric/i);
  assert.match(sql, /specific\.is_enabled/i);
});

test('migration preserves existing movement detection support', () => {
  assert.match(sql, /WHEN\s+'movement_detected'/i);
  assert.match(sql, /NEW\.movement_detected\s+IS\s+TRUE/i);
});
