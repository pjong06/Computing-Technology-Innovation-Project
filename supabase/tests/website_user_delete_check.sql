-- Phoebe: run ONLY after the Task 4 migration, as postgres in SQL Editor.
-- Creates disposable fixtures within a transaction, then always ROLLBACK.
-- No existing account IDs/emails are used. Not a real-JWT/login acceptance test.
BEGIN;

DO $test$
DECLARE
    actor_id uuid := gen_random_uuid();
    target_id uuid := gen_random_uuid();
    other_id uuid := gen_random_uuid();
    missing_id uuid := gen_random_uuid();
    fixture_id uuid;
    deleted_count integer;
    rejected boolean;
BEGIN
    -- The known signup trigger ignores this source; profiles are explicit fixtures.
    FOREACH fixture_id IN ARRAY ARRAY[actor_id, target_id, other_id] LOOP
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (fixture_id, fixture_id::text || '@task4.invalid', '{"source":"task4-sql-check"}'::jsonb);
        INSERT INTO public.profiles (id, full_name, role, account_status)
        VALUES (fixture_id, 'Task 4 disposable fixture',
            CASE WHEN fixture_id = actor_id THEN 'officer' ELSE 'botanist' END, 'active');
        INSERT INTO public.website_users (id, name, username, email, role, active)
        VALUES (fixture_id, 'Task 4 disposable fixture', fixture_id::text,
            fixture_id::text || '@task4.invalid',
            CASE WHEN fixture_id = actor_id THEN 'Conservation Officer' ELSE 'Botanist' END, true);
    END LOOP;

    PERFORM set_config('request.jwt.claim.sub', actor_id::text, true);
    PERFORM set_config('request.jwt.claims',
        jsonb_build_object('sub', actor_id, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    DELETE FROM public.website_users WHERE id = target_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count <> 1 THEN
        RAISE EXCEPTION 'FAIL: Officer DELETE was blocked or did not match one fixture';
    END IF;

    -- Verify the protected Officer cannot remove their own account.
    rejected := false;
    BEGIN
        DELETE FROM public.website_users WHERE id = actor_id;
    EXCEPTION WHEN insufficient_privilege THEN
        rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'FAIL: Officer/self removal was permitted'; END IF;

    EXECUTE 'RESET ROLE';
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_id AND account_status = 'suspended') THEN
        RAISE EXCEPTION 'FAIL: matching profile was not retained and suspended';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_id) THEN
        RAISE EXCEPTION 'FAIL: Auth account was hard deleted';
    END IF;
    IF EXISTS (SELECT 1 FROM public.website_users WHERE id = target_id) THEN
        RAISE EXCEPTION 'FAIL: website row was not removed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = other_id AND account_status = 'active') THEN
        RAISE EXCEPTION 'FAIL: unrelated fixture changed';
    END IF;

    -- Exercise an unmatched ID with the actual trigger function on a temporary
    -- table, avoiding any changes to real INSERT sync or existing accounts.
    CREATE TEMP TABLE task4_orphan_delete (id uuid) ON COMMIT DROP;
    INSERT INTO task4_orphan_delete VALUES (missing_id);
    CREATE TRIGGER task4_orphan_delete AFTER DELETE ON task4_orphan_delete
    FOR EACH ROW EXECUTE FUNCTION public.website_users_delete_login();
    rejected := false;
    BEGIN
        DELETE FROM task4_orphan_delete WHERE id = missing_id;
    EXCEPTION WHEN foreign_key_violation THEN
        rejected := true;
    END;
    IF NOT rejected OR NOT EXISTS (SELECT 1 FROM task4_orphan_delete WHERE id = missing_id) THEN
        RAISE EXCEPTION 'FAIL: unmatched DELETE did not fail atomically';
    END IF;

    RAISE NOTICE 'PASS: Officer delete, retained suspended profile, retained Auth account, unrelated account, Officer/self denial, unmatched-profile atomic denial';
END;
$test$;

ROLLBACK;

-- Read-only configuration check; one enabled DELETE trigger should remain.
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.website_users'::regclass
  AND NOT tgisinternal AND (tgtype & 8) = 8
ORDER BY tgname;
