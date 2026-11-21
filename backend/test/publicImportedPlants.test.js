'use strict';

// Imported plants (plants.data_source = 'inaturalist') arrive approved with no field record,
// so the old public rule (an approved observation) hid all of them: no QR page, no public
// photo copy. Migration 20261121170000_public_imported_plants.sql lets an approved, active
// imported plant be public; field plants still need an approved record. The visitor page
// and the officer's photo refresh both use public_plant_by_qr_v2, so they share the rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { createPublicPlantsRouter } = require('../src/routes/publicPlants');
const { refreshPublicPlantPhoto } = require('../src/services/publicPlantPhotos');
const { photoWithMetadata } = require('./helpers/testImages');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = 'supabase/migrations/20261121170000_public_imported_plants.sql';

// The visibility part of the WHERE clause, as written in both functions of the migration.
const VISIBILITY_SQL = `      AND p.plant_status = 'approved'
      AND p.deleted_at IS NULL`;
const SOURCE_OR_RECORD_SQL = `      AND s.verification_status = 'approved'
      AND (
          p.data_source = 'inaturalist'
          OR EXISTS (
              SELECT 1
              FROM public.observations AS o
              WHERE o.plant_id = p.id
                AND o.review_status = 'approved'
                AND o.deleted_at IS NULL
          )
      )`;

// The same rule in JS, for the fake database below. The migration test pins it to the SQL.
function isPublic(plant, observations) {
  return plant.plant_status === 'approved'
    && plant.deleted_at === null
    && plant.species_status === 'approved'
    && (plant.data_source === 'inaturalist'
      || observations.some((o) => o.plant_id === plant.id && o.review_status === 'approved' && o.deleted_at === null));
}

const PLANTS = [
  { id: 'imported', qr_code_value: 'NIAH-PLT-00101', plant_status: 'approved', deleted_at: null, data_source: 'inaturalist', species_status: 'approved' },
  { id: 'imported-pending', qr_code_value: 'NIAH-PLT-00102', plant_status: 'pending', deleted_at: null, data_source: 'inaturalist', species_status: 'approved' },
  { id: 'imported-deleted', qr_code_value: 'NIAH-PLT-00103', plant_status: 'approved', deleted_at: '2026-11-20T00:00:00Z', data_source: 'inaturalist', species_status: 'approved' },
  { id: 'field-pending', qr_code_value: 'NIAH-PLT-00104', plant_status: 'pending', deleted_at: null, data_source: 'field', species_status: 'approved' },
  { id: 'field-approved', qr_code_value: 'NIAH-PLT-00105', plant_status: 'approved', deleted_at: null, data_source: 'field', species_status: 'approved' },
  { id: 'field-no-record', qr_code_value: 'NIAH-PLT-00106', plant_status: 'approved', deleted_at: null, data_source: 'field', species_status: 'approved' },
  { id: 'field-deleted', qr_code_value: 'NIAH-PLT-00107', plant_status: 'approved', deleted_at: '2026-11-20T00:00:00Z', data_source: 'field', species_status: 'approved' },
  { id: 'imported-rejected', qr_code_value: 'NIAH-PLT-00108', plant_status: 'rejected', deleted_at: null, data_source: 'inaturalist', species_status: 'approved' },
];
const OBSERVATIONS = [
  { plant_id: 'field-pending', review_status: 'pending', deleted_at: null },
  { plant_id: 'field-approved', review_status: 'approved', deleted_at: null },
  { plant_id: 'field-no-record', review_status: 'rejected', deleted_at: null },
  { plant_id: 'field-deleted', review_status: 'approved', deleted_at: null },
];

function publicRows(tag) {
  return PLANTS.filter((plant) => plant.qr_code_value === tag && isPublic(plant, OBSERVATIONS))
    .map((plant) => ({ plant_id: plant.id, qr_code_value: tag, scientific_name: 'Nepenthes a', conservation_status: 'EN' }));
}

// The officer's client during the refresh: reads the plant and its main photo, asks the
// QR function, then publishes or removes the public copy.
function officerClient(plantId, original) {
  const calls = [];
  const chain = (result) => {
    const c = {};
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) c[m] = (...a) => { calls.push([m, ...a]); return c; };
    c.maybeSingle = async () => result;
    c.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
    return c;
  };
  const plant = PLANTS.find((row) => row.id === plantId);
  return {
    calls,
    from(table) {
      if (table === 'plants') return chain({ data: { id: plant.id, qr_code_value: plant.qr_code_value }, error: null });
      if (table === 'plant_media') return chain({ data: [{ id: 'm1', file_path: `u/${plant.id}/a.jpg` }], error: null });
      throw new Error(table);
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      assert.equal(name, 'public_plant_by_qr_v2');
      return { data: publicRows(args.p_qr), error: null };
    },
    storage: {
      from(bucket) {
        return {
          async download(file) { calls.push(['download', bucket, file]); return { data: new Blob([original]), error: null }; },
          async upload(file) { calls.push(['upload', bucket, file]); return { error: null }; },
          async remove(files) { calls.push(['remove', bucket, files]); return { error: null }; },
        };
      },
    },
  };
}

test('the migration makes approved, active imported plants public; field plants still need an approved record', () => {
  const sql = read(MIGRATION);
  for (const fn of ['public.public_plant_by_qr_v2(p_qr text)', 'public.public_species_photo_tags(p_species_ids uuid[])']) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}`);
    assert.ok(start !== -1, fn);
    const body = sql.slice(start, sql.indexOf('$function$;', start));
    assert.ok(body.includes(VISIBILITY_SQL), `${fn}: approved and not deleted`);
    assert.ok(body.includes(SOURCE_OR_RECORD_SQL), `${fn}: imported, or an approved record`);
    assert.match(body, /SECURITY DEFINER\s+SET search_path = ''/);
  }
  // Same return columns as before, so the page, QR API and refresh read it unchanged.
  const columns = (text) => /CREATE FUNCTION public\.public_plant_by_qr_v2\(p_qr text\)\s+RETURNS TABLE \(([^)]*)\)/.exec(text)?.[1]
    ?? /CREATE OR REPLACE FUNCTION public\.public_plant_by_qr_v2\(p_qr text\)\s+RETURNS TABLE \(([^)]*)\)/.exec(text)[1];
  assert.equal(columns(sql), columns(read('supabase/migrations/20261115170000_plant_source_metadata.sql')));
  // No RLS, policy or grant to new roles.
  assert.doesNotMatch(sql, /POLICY|ROW LEVEL SECURITY|ALTER TABLE|TO (public|service_role)\b/i);
  assert.doesNotMatch(sql, /GRANT [^;]*TO (?!anon, authenticated;)/);
});

test('refresh: an imported approved plant gets a public copy; pending, rejected or deleted plants do not', async () => {
  const original = await photoWithMetadata({ width: 80, height: 60 });
  const expected = {
    imported: 'published',
    'imported-pending': 'removed',
    'imported-deleted': 'removed',
    'imported-rejected': 'removed',
    'field-pending': 'removed',
    'field-approved': 'published',
    'field-no-record': 'removed',
    'field-deleted': 'removed',
  };
  for (const [plantId, outcome] of Object.entries(expected)) {
    const client = officerClient(plantId, original);
    assert.equal(await refreshPublicPlantPhoto(client, plantId), outcome, plantId);
    const tag = PLANTS.find((plant) => plant.id === plantId).qr_code_value;
    if (outcome === 'published') {
      assert.deepEqual(client.calls.find(([k]) => k === 'upload'), ['upload', 'public-plant-photos', `${tag}.jpg`], plantId);
    } else {
      assert.ok(!client.calls.some(([k]) => k === 'upload' || k === 'download'), plantId);
      assert.deepEqual(client.calls.find(([k]) => k === 'remove'), ['remove', 'public-plant-photos', [`${tag}.jpg`]], plantId);
    }
  }
});

test('the visitor page uses the same rule: imported approved plant shown, pending field or deleted plant not', async (t) => {
  const client = {
    async rpc(name, args) {
      if (name === 'public_plant_by_qr_v2') return { data: publicRows(args.p_qr), error: null };
      if (name === 'public_plant_tag_is_pending') return { data: false, error: null };
      return { data: null, error: { code: 'PGRST202' } };
    },
    from(table) { throw new Error(`no table reads expected (${table})`); },
    storage: { from() { return { async list() { return { data: [], error: null }; }, async download() { return { data: null, error: new Error('none') }; } }; } },
  };
  const app = express();
  app.use(createPublicPlantsRouter({ client }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;

  const page = await fetch(`${url}/p/NIAH-PLT-00101`);
  assert.equal(page.status, 200, 'imported approved plant');
  const html = await page.text();
  assert.match(html, /<h2>About this species<\/h2>/);
  assert.doesNotMatch(html, /latitude|longitude|113\.|Source|naturalist/i);
  for (const [tag, why] of [['NIAH-PLT-00104', 'pending field plant'], ['NIAH-PLT-00103', 'deleted imported plant'],
    ['NIAH-PLT-00107', 'deleted field plant'], ['NIAH-PLT-00106', 'field plant without an approved record']]) {
    assert.equal((await fetch(`${url}/p/${tag}`)).status, 404, why);
  }
});
