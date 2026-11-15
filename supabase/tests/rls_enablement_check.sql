-- Owner-run, rollback-only check of this exact Task 6 migration body.
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
        EXECUTE $migration$
ALTER TABLE public.alert_camera_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observation_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.park_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_edit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_observation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.species ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.species_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.species_reference_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_reservation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_plant_migration_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_species ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_users ENABLE ROW LEVEL SECURITY;
$migration$;
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
SELECT 'PASS' AS result, 'Exact enablement body executed twice; policies, table/column grants, owners and FORCE RLS unchanged; all changes rolled back' AS scope;
