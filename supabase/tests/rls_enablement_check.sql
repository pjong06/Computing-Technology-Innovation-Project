-- Owner-run, rollback-only check of this equivalent Task 6 enablement commands.
-- No real-account login or policy correctness acceptance is claimed.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $check$
DECLARE
    before_policies text;
    after_policies text;
    before_access text;
    after_access text;
    pass integer;
    target_table text;
BEGIN
    SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY tablename, policyname), '[]'::jsonb)::text)
    INTO before_policies FROM pg_policies p WHERE schemaname = 'public';
    SELECT md5(coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'acl',c.relacl,
        'owner',c.relowner,'force',c.relforcerowsecurity,'columns',
        (SELECT jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl) ORDER BY a.attnum)
         FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))
        ORDER BY c.relname), '[]'::jsonb)::text)
    INTO before_access FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p');

    FOR pass IN 1..2 LOOP
        FOREACH target_table IN ARRAY ARRAY[
            'alert_camera_evidence',
            'alert_rules',
            'alerts',
            'audit_logs',
            'observation_media',
            'observation_reviews',
            'observations',
            'park_visitors',
            'plant_edit_requests',
            'plant_media',
            'plant_observation_history',
            'plants',
            'profiles',
            'sensor_readings',
            'sensor_stations',
            'species',
            'species_media',
            'species_reference_photos',
            'sync_events',
            'tag_reservation_batches',
            'tag_reservations',
            'taxonomy',
            'website_plant_migration_map',
            'website_species',
            'website_users'
        ] LOOP
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
        END LOOP;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity) THEN
        RAISE EXCEPTION 'FAIL: public table remains without RLS';
    END IF;
    SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY tablename, policyname), '[]'::jsonb)::text)
    INTO after_policies FROM pg_policies p WHERE schemaname = 'public';
    SELECT md5(coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'acl',c.relacl,
        'owner',c.relowner,'force',c.relforcerowsecurity,'columns',
        (SELECT jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl) ORDER BY a.attnum)
         FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))
        ORDER BY c.relname), '[]'::jsonb)::text)
    INTO after_access FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p');
    IF before_policies IS DISTINCT FROM after_policies OR before_access IS DISTINCT FROM after_access THEN
        RAISE EXCEPTION 'FAIL: policy, grant, owner or FORCE RLS changed';
    END IF;
END;
$check$;
ROLLBACK;
SELECT 'PASS' AS result, 'Equivalent enablement commands executed twice; policies, table/column grants, owners and FORCE RLS unchanged; all changes rolled back' AS scope;
