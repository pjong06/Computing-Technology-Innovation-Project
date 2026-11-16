'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20261115170000_plant_source_metadata.sql'),
  'utf8'
);

test('plant source migration adds only the four requested columns and source check', () => {
  for (const column of [
    'data_source text NOT NULL DEFAULT \'field\'',
    'source_url text',
    'source_observer text',
    'source_licence text',
  ]) {
    assert.ok(
      migration.includes(`ADD COLUMN IF NOT EXISTS ${column}`),
      `migration must safely add ${column}`
    );
  }
  assert.match(migration, /CHECK \(data_source IN \('field', 'inaturalist'\)\)/);
});

test('plant map and public QR views retain active-plant guards and access controls', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.plant_map_points\s+WITH \(security_invoker = true\)/);
  assert.match(migration, /p\.deleted_at IS NULL/);
  assert.match(migration, /GRANT SELECT ON public\.plant_map_points TO authenticated/);
  assert.match(migration, /REVOKE ALL ON public\.plant_map_points FROM anon/);

  for (const sourceColumn of ['data_source', 'source_observer', 'source_licence']) {
    assert.match(migration, new RegExp(`p\\.${sourceColumn}`));
  }
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.public_plant_by_qr_v2\(text\)/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*?SET search_path = ''/);
  assert.match(migration, /p\.plant_status = 'approved'\s+AND p\.deleted_at IS NULL/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.public_plant_by_qr_v2\(text\)\s+TO anon, authenticated/);
});
