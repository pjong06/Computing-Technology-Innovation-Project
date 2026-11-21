const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../supabase/migrations/20261120150000_environmental_alert_recovery.sql'
  ),
  'utf8'
);

test('creates persistent per-station and per-rule state', () => {
  assert.match(sql, /CREATE TABLE public\.iot_alert_rule_states/i);
  assert.match(sql, /PRIMARY KEY \(station_id, alert_rule_id\)/i);
  assert.match(sql, /is_abnormal boolean NOT NULL DEFAULT false/i);
});

test('protects state table with RLS', () => {
  assert.match(sql, /ALTER TABLE public\.iot_alert_rule_states ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON public\.iot_alert_rule_states/i);
});

test('movement cooldown is 120 seconds', () => {
  assert.match(sql, /SET cooldown_seconds = 120/i);
  assert.match(sql, /movement_nearby_cm/);
  assert.match(sql, /movement_detected/);
});

test('serializes processing by station', () => {
  assert.match(sql, /pg_advisory_xact_lock/i);
});

test('invalid measurements are skipped', () => {
  assert.match(sql, /IF measured IS NULL THEN\s+CONTINUE;/i);
  assert.match(sql, /NEW\.dht_valid IS TRUE/i);
});

test('environmental state is locked before transition', () => {
  assert.match(sql, /SELECT state\.is_abnormal[\s\S]*?FOR UPDATE;/i);
});

test('creates alert on first abnormal reading', () => {
  assert.match(sql, /IF triggered AND NOT already_abnormal THEN/i);
  assert.match(sql, /SET is_abnormal = true/i);
});

test('re-arms after recovery', () => {
  assert.match(sql, /ELSIF NOT triggered AND already_abnormal THEN/i);
  assert.match(sql, /SET is_abnormal = false/i);
});

test('movement retains separate cooldown logic', () => {
  assert.match(sql, /IF is_movement THEN/i);
  assert.match(sql, /previous\.alert_rule_id = r\.id/i);
  assert.match(sql, /r\.cooldown_seconds \* INTERVAL '1 second'/i);
});
