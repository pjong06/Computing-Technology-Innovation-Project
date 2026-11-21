const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../supabase/migrations/20261119140000_add_iot_alert_cooldowns.sql',
  ),
  'utf8',
);

test('cooldown migration adds configurable rule durations', () => {
  assert.match(sql, /ADD COLUMN cooldown_seconds integer NOT NULL DEFAULT 300/i);
  assert.match(sql, /cooldown_seconds BETWEEN 0 AND 86400/i);
});

test('movement alerts have a 120-second cooldown', () => {
  assert.match(sql, /SET cooldown_seconds = 120/i);
  assert.match(sql, /'movement_nearby_cm'/);
  assert.match(sql, /'movement_detected'/);
});

test('generated alerts reference their alert rule', () => {
  assert.match(sql, /ADD COLUMN alert_rule_id uuid/i);
  assert.match(sql, /previous\.alert_rule_id = r\.id/i);
});

test('cooldowns are independent for each station', () => {
  assert.match(sql, /previous\.station_id = NEW\.station_id/i);
});

test('concurrent readings use a transaction advisory lock', () => {
  assert.match(sql, /pg_advisory_xact_lock/i);
});

test('proximity alerts still require motion and valid distance', () => {
  assert.match(
    sql,
    /NEW\.movement_detected IS TRUE\s+AND NEW\.distance_valid IS TRUE/i,
  );
});

test('cooldowns use previous alert timestamps', () => {
  assert.match(sql, /previous\.triggered_at/i);
  assert.match(sql, /r\.cooldown_seconds \* INTERVAL '1 second'/i);
});
