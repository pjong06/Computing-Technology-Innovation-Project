'use strict';

// Attaching a physical tag to a plant AFTER it was submitted (registered with "No physical
// tag yet", tag attached later): supabase/migrations/20261122140000_attach_tag_after_submission.sql
// and the sync route's answers. The database behaviour itself (pending plant + own reserved
// tag -> bound; real tag already -> refused; another botanist's tag -> refused; any other
// column on a locked plant -> still refused) is exercised against Postgres by
// supabase/tests/tag-after-submission.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const repoRoot = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(repoRoot, 'supabase/migrations/20261122140000_attach_tag_after_submission.sql'), 'utf8'
).replace(/\r\n/g, '\n');
const syncRouter = require('../src/routes/sync');

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';

test('migration: attach_reserved_plant_tag binds only the owner\'s placeholder-tagged plant, in any review status', () => {
  const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.attach_reserved_plant_tag'),
    migration.indexOf('REVOKE ALL ON FUNCTION public.attach_reserved_plant_tag'));
  assert.match(fn, /SECURITY DEFINER SET search_path = ''/);
  assert.match(fn, /public\.current_app_role\(\) IS DISTINCT FROM 'botanist'/);
  assert.match(fn, /plant\.registered_by IS DISTINCT FROM auth\.uid\(\) OR plant\.deleted_at IS NOT NULL/);
  // Placeholder or no tag only; a real tag is never replaced.
  assert.match(fn, /plant\.qr_code_value !~ '\^plant:'/);
  assert.match(fn, /RAISE EXCEPTION 'Plant already has a physical tag' USING ERRCODE = '42501';/);
  // No review status condition: pending, approved and sent back are all allowed.
  assert.doesNotMatch(fn, /plant_status|review_status|plant_has_submitted_observation/);
  // Only the tag (and the row version) change.
  assert.match(fn, /UPDATE public\.plants SET qr_code_value = p_tag, row_version = row_version \+ 1\s+WHERE id = p_plant_id;/);
  assert.equal((fn.match(/UPDATE public\.plants/g) || []).length, 1);
  // Grants unchanged: authenticated may call it; the trigger still checks the reservation.
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.attach_reserved_plant_tag\(uuid, text\) TO authenticated;/);
  assert.doesNotMatch(migration, /DROP TRIGGER|plants_require_reserved_tag ON|enforce_reserved_plant_tag\(\)\s*RETURNS/);
});

test('migration: the sync update attaches a tag-only payload when the review lock hides the plant', () => {
  const patch = migration.slice(migration.indexOf('new_not_found text :='), migration.indexOf('occurrences integer;'));
  // Only a payload that is exactly { qr_code_value: "NIAH-PLT-#####" }.
  assert.match(patch, /\(SELECT pg_catalog\.array_agg\(payload_key\)\s+FROM pg_catalog\.jsonb_object_keys\(p_payload\) AS payload_key\) = ARRAY\['qr_code_value'\]/);
  assert.match(patch, /pg_catalog\.btrim\(p_payload ->> 'qr_code_value'\) ~ '\^NIAH-PLT-\[0-9\]\{5\}\$'/);
  // Through the existing tag path, on the botanist's own, not deleted plant.
  assert.match(patch, /AND registered_by = current_user_id\s+AND deleted_at IS NULL;/);
  assert.match(patch, /PERFORM public\.attach_reserved_plant_tag\(\s*plant_row\.id,/);
  // Anything else is still refused as before.
  assert.match(patch, /ELSE\s+result := jsonb_build_object\(\s+'operation_id', p_operation_id,\s+'status', 'failed',\s+'code', 'not_found',/);
  // The patch must match exactly one place, whatever the stored line endings.
  assert.match(migration, /function_definition := replace\(function_definition, E'\\r\\n', E'\\n'\);/);
  assert.match(migration, /IF function_definition IS NULL OR occurrences <> 1 THEN/);
  // RLS stays as it is.
  assert.doesNotMatch(migration, /CREATE POLICY|DROP POLICY|ALTER POLICY|DISABLE ROW LEVEL SECURITY/);
});

test('migration: the lookup it replaces is exactly the plant update lookup of the sync function', () => {
  const original = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/20261103133000_apply_offline_sync_operation.sql'), 'utf8'
  ).replace(/\r\n/g, '\n');
  const oldText = migration.slice(migration.indexOf("old_not_found text := $old$") + 'old_not_found text := $old$'.length,
    migration.indexOf('$old$;'));
  assert.equal(original.split(oldText).length - 1, 1, 'found once in the sync function');
});

async function pushOne(rpcAnswer, payload = { qr_code_value: 'NIAH-PLT-00042' }, operationType = 'update') {
  const app = express();
  app.use(express.json());
  app.use('/api/sync', (req, _res, next) => {
    req.user = { id: '55555555-5555-4555-8555-555555555555' };
    req.supabase = { rpc: async () => rpcAnswer };
    next();
  }, syncRouter);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [{
        operation_id: OPERATION_ID, entity_type: 'plant', operation_type: operationType,
        client_record_id: CLIENT_ID, base_version: 3, payload,
      }] }),
    });
    return (await response.json()).results[0];
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('sync push: a tag-only update on a submitted plant that the server binds is a success', async () => {
  const result = await pushOne({
    data: { operation_id: OPERATION_ID, status: 'success', entity_type: 'plant', operation_type: 'update',
      client_record_id: CLIENT_ID, server_id: '44444444-4444-4444-8444-444444444444', row_version: 4 },
    error: null,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.row_version, 4);
});

test('sync push: another botanist\'s tag and a plant that already has a tag come back with their own codes', async () => {
  const notYours = await pushOne({ data: null, error: { code: '42501', message: 'Tag is not reserved by this botanist' } });
  assert.deepEqual(notYours, { operation_id: OPERATION_ID, status: 'conflict', code: 'tag_not_yours',
    message: "This tag isn't one of your reserved tags" });
  for (const message of ['Plant already has a physical tag', 'A physical tag cannot be replaced']) {
    const already = await pushOne({ data: null, error: { code: '42501', message } });
    assert.equal(already.code, 'tag_already_set', message);
    assert.equal(already.status, 'conflict');
  }
  // A used tag stays tag_in_use (unique tag on plants / "Tag has already been used").
  const used = await pushOne({ data: null, error: { code: '23505', message: 'Tag has already been used' } });
  assert.equal(used.code, 'tag_in_use');
});

test('sync push: any other change to a locked plant is still plant_locked', async () => {
  const hidden = await pushOne(
    { data: { operation_id: OPERATION_ID, status: 'failed', code: 'not_found', message: 'Plant record not found' }, error: null },
    { qr_code_value: 'NIAH-PLT-00042', location_description: 'Moved' }
  );
  assert.equal(hidden.code, 'plant_locked');
  const refused = await pushOne({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "plants"' } });
  assert.equal(refused.code, 'plant_locked');
});

test('sync push: a new plant registered with an unreserved tag is tag_not_yours too, not a failure', async () => {
  // The phone then sends the plant again without the tag, so its observations still upload.
  const created = await pushOne(
    { data: null, error: { code: '42501', message: 'Tag is not reserved by this botanist' } },
    { qr_code_value: 'NIAH-PLT-00042', species_id: null, latitude: 3.8, longitude: 113.7 },
    'create'
  );
  assert.deepEqual(created, { operation_id: OPERATION_ID, status: 'conflict', code: 'tag_not_yours',
    message: "This tag isn't one of your reserved tags" });
});
