'use strict';

// Round 2 fixes on the server (migrations are written, not run here):
//   - TC-APP-06: observations on any approved plant the server returned
//     (supabase/migrations/20261127130000_observations_on_server_plants.sql);
//   - TC-APP-24: "Edit and resend" a plant registration the officer sent back
//     (supabase/migrations/20261127120000_edit_sent_back_plant.sql).
// Each migration patches apply_botanist_sync_operation by exact text: these tests check the
// text it looks for really is what the earlier migrations left, and the rules it states.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const repoRoot = path.join(__dirname, '..', '..');
const read = (name) => fs.readFileSync(path.join(repoRoot, 'supabase/migrations', name), 'utf8').replace(/\r\n/g, '\n');
const original = read('20261103133000_apply_offline_sync_operation.sql');
const approvedVisits = read('20261112090000_allow_visits_on_approved_readable_plants.sql');
const attachTag = read('20261122140000_attach_tag_after_submission.sql');
const serverPlants = read('20261127130000_observations_on_server_plants.sql');
const sentBack = read('20261127120000_edit_sent_back_plant.sql');
const between = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `not found: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to >= 0, `no end after: ${start}`);
  return text.slice(from + start.length, to);
};
const quoted = (text, name) => between(text, `${name} text := $${name.startsWith('old') ? 'old' : 'new'}$`, '$');

// ---- TC-APP-06 ----

test('observations: the plant_id lookup accepts own or approved plants, with or without 20261112090000', () => {
  const oldId = quoted(serverPlants, 'old_id_lookup');
  const newId = quoted(serverPlants, 'new_id_lookup');
  // Before 20261112090000: the original text; after it: that migration's new text.
  assert.ok(original.includes(oldId), 'old plant_id lookup is the original text');
  assert.equal(newId, between(approvedVisits, 'new_parent_lookup text := $new$', '$new$'));
  assert.match(newId, /AND \(registered_by = current_user_id OR plant_status = 'approved'\)/);
  assert.match(serverPlants, /IF position\(old_id_lookup IN function_definition\) > 0 THEN[\s\S]*?ELSIF position\(new_id_lookup IN function_definition\) = 0 THEN\s*RAISE EXCEPTION/);
});

test('observations: a plant named by its client record id is found when it is own or approved', () => {
  const oldClient = quoted(serverPlants, 'old_client_lookup');
  const newClient = quoted(serverPlants, 'new_client_lookup');
  assert.ok(original.includes(oldClient), 'old plant_client_record_id lookup is the original text');
  assert.match(newClient, /client_record_id = \(p_payload ->> 'plant_client_record_id'\)::uuid\s*AND \(registered_by = current_user_id OR plant_status = 'approved'\)\s*AND deleted_at IS NULL;/);
  // Another botanist's plant that isn't approved is still not found.
  assert.doesNotMatch(newClient, /OR plant_status IN|OR TRUE/i);
  // The not-found answer itself is unchanged.
  assert.match(original, /'code', 'plant_not_found',\s*'message', 'Parent plant has not been synced'/);
});

// ---- TC-APP-24 ----

test('sent back: update_sent_back_plant states its rules (owner, sent back, editable fields only)', () => {
  const fn = between(sentBack, 'CREATE OR REPLACE FUNCTION public.update_sent_back_plant(', 'REVOKE ALL ON FUNCTION public.update_sent_back_plant');
  assert.match(fn, /SECURITY DEFINER SET search_path = ''/);
  assert.match(fn, /public\.current_app_role\(\) IS DISTINCT FROM 'botanist'/);
  assert.match(fn, /plant\.registered_by IS DISTINCT FROM auth\.uid\(\) OR plant\.deleted_at IS NOT NULL/);
  // Waiting for review or approved: still refused.
  assert.match(fn, /plant\.plant_status IN \('approved', 'archived'\) OR NOT public\.plant_is_sent_back\(p_plant_id\)/);
  assert.match(fn, /verification_status = 'approved'/);
  // Never the tag, owner or review status.
  const set = between(fn, 'UPDATE public.plants', 'WHERE id = p_plant_id');
  for (const column of ['qr_code_value', 'registered_by', 'plant_status']) assert.doesNotMatch(set, new RegExp(`\\b${column}\\s*=`));
  for (const column of ['species_id', 'location', 'gps_accuracy_m', 'location_description', 'morphology', 'description', 'row_version']) {
    assert.match(set, new RegExp(`\\b${column} =`));
  }
  // Out-of-date copy: NULL, answered as a version conflict.
  assert.match(fn, /IF p_base_version IS NOT NULL AND plant\.row_version IS DISTINCT FROM p_base_version THEN\s*RETURN NULL;/);
  assert.match(sentBack, /GRANT EXECUTE ON FUNCTION public\.update_sent_back_plant\(uuid, integer, jsonb\) TO authenticated;/);
  assert.match(sentBack, /REVOKE ALL ON FUNCTION public\.update_sent_back_plant\(uuid, integer, jsonb\) FROM PUBLIC, anon, authenticated;/);
});

test('sent back means the registration (earliest live observation) is rejected and not resubmitted', () => {
  const fn = between(sentBack, 'CREATE OR REPLACE FUNCTION public.plant_is_sent_back(', 'REVOKE ALL ON FUNCTION public.plant_is_sent_back');
  assert.match(fn, /SELECT o\.review_status = 'rejected'/);
  assert.match(fn, /o\.deleted_at IS NULL\s*ORDER BY o\.observed_at ASC, o\.id ASC\s*LIMIT 1/);
});

test('sent back: the sync function patch finds the text 20261122140000 left, exactly once', () => {
  const oldLocked = between(sentBack, 'old_locked text := $old$', '$old$');
  const attachNew = between(attachTag, 'new_not_found text := $new$', '$new$');
  assert.ok(attachNew.endsWith(oldLocked), 'the locked-plant answer is the end of the tag-after-submission branch');
  assert.equal(attachNew.split(oldLocked).length - 1, 1);
  const newLocked = between(sentBack, 'new_locked text := $new$', '$new$');
  assert.match(newLocked, /ELSIF FOUND\s*AND public\.plant_is_sent_back\(plant_row\.id\) THEN/);
  assert.match(newLocked, /edited_row := public\.update_sent_back_plant\(plant_row\.id, p_base_version, p_payload\);/);
  assert.match(newLocked, /'code', 'version_conflict'/);
  // Anything else still answers not_found (the app shows "plant_locked").
  assert.match(newLocked, /ELSE\s*result := jsonb_build_object\([\s\S]*?'code', 'not_found'/);
  assert.match(sentBack, /IF occurrences <> 1 THEN\s*RAISE EXCEPTION/);
  assert.match(sentBack, /regexp_replace\(function_definition, '\\mDECLARE\\M', new_declare\)/);
  assert.equal((original.match(/\bDECLARE\b/g) || []).length, 1);
});

// ---- the backend submit path already accepts sent-back observations ----

test('resubmitting a sent-back observation is accepted by PATCH /api/observations/:id/submit', async () => {
  const OBSERVATION = '55555555-5555-4555-8555-555555555555';
  const ME = '66666666-6666-4666-8666-666666666666';
  const updates = [];
  const tables = {
    observations: { id: OBSERVATION, observer_id: ME, review_status: 'rejected', plant_id: null, deleted_at: null },
  };
  const chain = (table) => {
    const query = { filters: [] };
    const self = {
      select: () => self,
      eq: (column, value) => { query.filters.push([column, value]); return self; },
      in: (column, values) => { query.in = [column, values]; return self; },
      update: (values) => { query.update = values; updates.push(values); return self; },
      maybeSingle: async () => {
        const row = tables[table];
        if (query.in && !query.in[1].includes(row[query.in[0]])) return { data: null, error: null };
        if (query.update) Object.assign(row, query.update);
        return { data: { ...row }, error: null };
      },
    };
    return self;
  };

  const routeKit = require('./helpers/routeTestKit');
  routeKit.mockAuth(() => ({ userId: ME, role: 'botanist', db: { from: chain } }));
  delete require.cache[require.resolve('../src/routes/observations')];
  const router = require('../src/routes/observations');
  const app = express();
  app.use(express.json());
  app.use('/api/observations', router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/observations/${OBSERVATION}/submit`, { method: 'PATCH' });
    assert.equal(response.status, 200);
    assert.deepEqual(updates, [{ review_status: 'pending' }]);
    assert.equal(tables.observations.review_status, 'pending');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
