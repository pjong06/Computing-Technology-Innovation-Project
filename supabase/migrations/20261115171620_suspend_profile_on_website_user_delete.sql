-- Task 4. User-authorized fix, applied via Supabase migration API as postgres.
-- Version matches the live migration history; no RLS or table grants changed.
-- Live inspection found both a hard-delete Auth trigger and a suspension trigger.
-- Keep one DELETE path, retaining profiles/Auth users and their historical links.
BEGIN;

CREATE OR REPLACE FUNCTION public.website_users_delete_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    target_role text;
BEGIN
    -- Use the immutable account ID, never an email supplied by the portal.
    SELECT p.role INTO target_role
    FROM public.profiles AS p
    WHERE p.id = OLD.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cannot remove website user without a matching profile'
            USING ERRCODE = '23503';
    END IF;

    -- Match the portal's Officer protection, using the authoritative profile role.
    IF target_role = 'officer' OR OLD.id = auth.uid() THEN
        RAISE EXCEPTION 'Officer and own accounts cannot be removed'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.profiles
    SET account_status = 'suspended', updated_at = now()
    WHERE id = OLD.id;

    -- No exception swallowing: if suspension fails, the DELETE also rolls back.
    RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.website_users_delete_login()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS website_users_delete_login ON public.website_users;
CREATE TRIGGER website_users_delete_login
AFTER DELETE ON public.website_users
FOR EACH ROW EXECUTE FUNCTION public.website_users_delete_login();

-- Remove only the duplicate DELETE hook; keep INSERT/UPDATE sync unchanged.
DROP TRIGGER IF EXISTS website_users_delete_profile ON public.website_users;

COMMIT;
