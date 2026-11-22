// Tag attached AFTER submission (supabase/migrations/20261122140000_attach_tag_after_submission.sql),
// against a real Postgres (PGlite), like tag-reservations.cjs. Run from the repo root with
// @electric-sql/pglite available:  node supabase/tests/tag-after-submission.cjs
// It applies the tag reservation migration and the new attach_reserved_plant_tag, with the
// review lock (RLS "botanists edit own pending plants") in place. The sync-function patch in
// the same migration needs PostGIS, so it is covered by backend/test/tagAfterSubmission.test.js.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PENDING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';   // submitted, waiting for review
const APPROVED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SENT_BACK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TAGGED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';    // already has a real tag

(async () => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text, account_status text);
    CREATE FUNCTION public.current_app_role() RETURNS text LANGUAGE sql AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() AND account_status='active' $$;
    CREATE TABLE public.plants(id uuid PRIMARY KEY, qr_code_value text UNIQUE, registered_by uuid, row_version integer DEFAULT 1,
      plant_status text NOT NULL DEFAULT 'pending', location_description text, deleted_at timestamptz);
    CREATE TABLE public.observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plant_id uuid, review_status text);
    CREATE FUNCTION public.plant_has_submitted_observation(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS
      $$ SELECT EXISTS (SELECT 1 FROM public.observations o WHERE o.plant_id = p AND o.review_status <> 'draft') $$;
    INSERT INTO profiles VALUES ('${BOTANIST}','botanist','active'),('${OTHER}','botanist','active');`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261031090000_tag_reservations.sql'), 'utf8'));

  // The new attach_reserved_plant_tag (the DO block after it patches the PostGIS sync function).
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261122140000_attach_tag_after_submission.sql'), 'utf8');
  await db.exec(migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.attach_reserved_plant_tag'),
    migration.indexOf('DO $migration$')));

  // The review lock, as in the live database.
  await db.exec(`ALTER TABLE plants ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "botanists read own plants" ON plants FOR SELECT TO authenticated
      USING (registered_by = auth.uid() AND current_app_role() = 'botanist');
    CREATE POLICY "botanists edit own pending plants" ON plants FOR UPDATE TO authenticated
      USING (registered_by = auth.uid() AND plant_status = 'pending' AND current_app_role() = 'botanist' AND NOT plant_has_submitted_observation(id))
      WITH CHECK (registered_by = auth.uid() AND plant_status = 'pending' AND current_app_role() = 'botanist' AND NOT plant_has_submitted_observation(id));
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid(), current_app_role(), plant_has_submitted_observation(uuid) TO authenticated;
    GRANT SELECT ON profiles TO authenticated; GRANT SELECT, UPDATE ON plants TO authenticated;
    INSERT INTO plants VALUES
      ('${PENDING}', 'plant:${PENDING}', '${BOTANIST}', 3, 'pending', 'Zone B', NULL),
      ('${APPROVED}', NULL, '${BOTANIST}', 5, 'approved', 'Zone C', NULL),
      ('${SENT_BACK}', 'plant:${SENT_BACK}', '${BOTANIST}', 2, 'rejected', 'Zone D', NULL);
    INSERT INTO observations(plant_id, review_status) VALUES ('${PENDING}', 'pending'), ('${SENT_BACK}', 'rejected');`);

  let checks = 0;
  const query = sql => db.query(sql);
  async function rejects(sql, code, message) {
    await assert.rejects(query(sql), error => error.code === code && (!message || message.test(error.message)));
    checks++;
  }

  // The botanist reserves three tags; another botanist reserves one.
  await db.exec(`SET test.uid='${BOTANIST}'`);
  const mine = (await query(`SELECT * FROM reserve_plant_tags(3,'33333333-3333-4333-8333-333333333333')`)).rows.map(r => r.qr_code_value);
  await db.exec(`SET test.uid='${OTHER}'`);
  const theirs = (await query(`SELECT * FROM reserve_plant_tags(1,'44444444-4444-4444-8444-444444444444')`)).rows[0].qr_code_value;
  await db.exec(`SET test.uid='${BOTANIST}'; SET ROLE authenticated`);

  // Changing any column of a submitted (locked) plant directly is still refused: RLS hides it.
  assert.equal((await query(`UPDATE plants SET location_description='Moved' WHERE id='${PENDING}'`)).affectedRows, 0); checks++;
  assert.equal((await query(`UPDATE plants SET qr_code_value='${mine[0]}' WHERE id='${PENDING}'`)).affectedRows, 0); checks++;

  // Pending (submitted) plant + own reserved tag -> bound; only the tag and row_version change.
  await query(`SELECT attach_reserved_plant_tag('${PENDING}','${mine[0]}')`);
  const pending = (await query(`SELECT * FROM plants WHERE id='${PENDING}'`)).rows[0];
  assert.equal(pending.qr_code_value, mine[0]); checks++;
  assert.equal(pending.row_version, 4); checks++;
  assert.equal(pending.plant_status, 'pending'); checks++;
  assert.equal(pending.location_description, 'Zone B'); checks++;
  // The same tag again (a retried upload) does nothing.
  await query(`SELECT attach_reserved_plant_tag('${PENDING}','${mine[0]}')`);
  assert.equal((await query(`SELECT row_version FROM plants WHERE id='${PENDING}'`)).rows[0].row_version, 4); checks++;

  // Approved plant with no tag, and a sent-back plant: also bound.
  await query(`SELECT attach_reserved_plant_tag('${APPROVED}','${mine[1]}')`);
  assert.equal((await query(`SELECT qr_code_value, plant_status FROM plants WHERE id='${APPROVED}'`)).rows[0].plant_status, 'approved'); checks++;
  await query(`SELECT attach_reserved_plant_tag('${SENT_BACK}','${mine[2]}')`);
  assert.equal((await query(`SELECT qr_code_value FROM plants WHERE id='${SENT_BACK}'`)).rows[0].qr_code_value, mine[2]); checks++;

  // A plant that already has a real tag -> refused (nothing changes).
  await db.exec(`RESET ROLE; INSERT INTO plants VALUES ('${TAGGED}', NULL, '${BOTANIST}', 1, 'pending', 'Zone E', NULL)`);
  await db.exec(`SET test.uid='${BOTANIST}'`);
  const extra = (await query(`SELECT * FROM reserve_plant_tags(2,'55555555-5555-4555-8555-555555555555')`)).rows.map(r => r.qr_code_value);
  await query(`SELECT attach_reserved_plant_tag('${TAGGED}','${extra[0]}')`);
  await db.exec(`SET ROLE authenticated`);
  await rejects(`SELECT attach_reserved_plant_tag('${TAGGED}','${extra[1]}')`, '42501', /already has a physical tag/);
  assert.equal((await query(`SELECT qr_code_value FROM plants WHERE id='${TAGGED}'`)).rows[0].qr_code_value, extra[0]); checks++;

  // Another botanist's tag -> refused.
  await db.exec(`RESET ROLE; INSERT INTO plants VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', NULL, '${BOTANIST}', 1, 'approved', NULL, NULL); SET ROLE authenticated`);
  await rejects(`SELECT attach_reserved_plant_tag('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','${theirs}')`, '42501', /not reserved by this botanist/);

  // Someone else's plant -> refused.
  await db.exec(`SET test.uid='${OTHER}'`);
  await rejects(`SELECT attach_reserved_plant_tag('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','${theirs}')`, '42501', /Plant is unavailable/);

  console.log(`tag-after-submission: ${checks} checks passed`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
