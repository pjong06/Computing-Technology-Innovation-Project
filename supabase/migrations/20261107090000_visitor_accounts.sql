-- Visitor accounts (sign-up from the mobile app) and closing every place where "signed
-- in" alone was enough to read or write staff data.
--
-- Until now every signed-in account was staff (self-registered accounts start pending),
-- so a few policies only checked "signed in" or "active". With visitor accounts those
-- policies would let a visitor in, so each one now also checks a staff role.
-- Nothing is loosened: every change below only narrows who may do something.
--
-- Unchanged and confirmed fine:
--   * park_visitors: users only see/create their own rows.
--   * profiles own-row read/update: role and account_status can't be written by users
--     (column UPDATE revoked + protect_profile_privileges trigger).
--   * species "read approved species", taxonomy public read: public data by design.
--   * website_users: officer only.
--   * observation-media and species-media storage, observation_media and species_media
--     tables: every policy already checks a role (anon only reads approved species
--     images).
--
-- One transaction: if anything fails, nothing is applied.

BEGIN;

-- 1. Allow the 'visitor' role on profiles.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role = ANY (ARRAY['botanist'::text, 'officer'::text, 'researcher'::text, 'visitor'::text]));

-- 2. Sign-ups. The sign-up SOURCE decides the role; nothing else in the user's metadata
--    can (only name/username are read). The website branch is unchanged.
--      source = 'app'     -> visitor, active, no website_users row
--      source = 'website' -> botanist, PENDING until an officer activates it (as before)
--      anything else      -> no profile (as before)
CREATE OR REPLACE FUNCTION public.handle_website_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  signup_source text := coalesce(new.raw_user_meta_data->>'source', '');
  chosen_username text;
  shown_name text;
begin
  -- NEW: "Create a free account" in the mobile app. Always a visitor.
  if signup_source = 'app' then
    shown_name := left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''),
                                split_part(new.email, '@', 1)), 200);
    insert into public.profiles (id, full_name, role, account_status)
    values (new.id, shown_name, 'visitor', 'active')
    on conflict (id) do nothing;
    return new;
  end if;

  if signup_source <> 'website' then
    return new;
  end if;

  chosen_username := coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1));
  shown_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), chosen_username);

  -- 'pending', not 'active'. An officer activates the account.
  insert into public.profiles (id, full_name, role, account_status)
  values (new.id, shown_name, 'botanist', 'pending')
  on conflict (id) do nothing;

  -- active = false until the officer activates it.
  insert into public.website_users (id, name, username, email, role, active, sort_order)
  values (new.id, shown_name, chosen_username, new.email, 'Botanist', false,
          (select coalesce(max(sort_order), -1) + 1 from public.website_users))
  on conflict (id) do nothing;

  return new;
end $function$;

-- 3. plant_media rows: was "the plant exists", so any signed-in visitor could read every
--    plant photo row. Now staff only; the existing condition is kept.
DROP POLICY IF EXISTS "staff read visible plant photos" ON public.plant_media;
CREATE POLICY "staff read visible plant photos"
    ON public.plant_media
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.current_app_role()) IN ('botanist', 'officer', 'researcher')
        AND EXISTS (
            SELECT 1 FROM public.plants AS p WHERE p.id = plant_media.plant_id
        )
    );

-- 4. plant-media files: the first branch ("the file is linked in plant_media") had no role
--    check, so any signed-in visitor could download every plant photo file. Now staff
--    only. The second branch (a botanist's own, not yet linked files) is unchanged.
DROP POLICY IF EXISTS "staff read visible plant image files" ON storage.objects;
CREATE POLICY "staff read visible plant image files"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'plant-media'
        AND (
            (
                (SELECT public.current_app_role()) IN ('botanist', 'officer', 'researcher')
                AND EXISTS (SELECT 1 FROM public.plant_media AS m WHERE m.file_path = objects.name)
            )
            OR (
                (SELECT public.current_app_role()) = 'botanist'
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
                AND EXISTS (
                    SELECT 1 FROM public.plants AS p
                    WHERE (p.id)::text = (storage.foldername(objects.name))[2]
                      AND p.registered_by = (SELECT auth.uid())
                )
            )
        )
    );

-- 5. web_data (the web portal's saved settings): was "any active account" for read,
--    add and change. Now staff may read; only the officer may add or change (matches
--    /api/web-data, which is officer-only for writes).
DROP POLICY IF EXISTS "active staff can read web data" ON public.web_data;
DROP POLICY IF EXISTS "active staff can add web data" ON public.web_data;
DROP POLICY IF EXISTS "active staff can change web data" ON public.web_data;
CREATE POLICY "staff read web data"
    ON public.web_data FOR SELECT TO authenticated
    USING ((SELECT public.current_app_role()) IN ('botanist', 'officer', 'researcher'));
CREATE POLICY "officer adds web data"
    ON public.web_data FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.current_app_role()) = 'officer');
CREATE POLICY "officer changes web data"
    ON public.web_data FOR UPDATE TO authenticated
    USING ((SELECT public.current_app_role()) = 'officer')
    WITH CHECK ((SELECT public.current_app_role()) = 'officer');

-- 6. website_observations and website_species (the web portal's catalogue copy): was one
--    "ALL for any active account" policy each. Now staff read; only the officer adds,
--    changes or deletes.
DROP POLICY IF EXISTS "active staff can use website observations" ON public.website_observations;
CREATE POLICY "staff read website observations"
    ON public.website_observations FOR SELECT TO authenticated
    USING ((SELECT public.current_app_role()) IN ('botanist', 'officer', 'researcher'));
CREATE POLICY "officer adds website observations"
    ON public.website_observations FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.current_app_role()) = 'officer');
CREATE POLICY "officer changes website observations"
    ON public.website_observations FOR UPDATE TO authenticated
    USING ((SELECT public.current_app_role()) = 'officer')
    WITH CHECK ((SELECT public.current_app_role()) = 'officer');
CREATE POLICY "officer deletes website observations"
    ON public.website_observations FOR DELETE TO authenticated
    USING ((SELECT public.current_app_role()) = 'officer');

DROP POLICY IF EXISTS "active staff can use website species" ON public.website_species;
CREATE POLICY "staff read website species"
    ON public.website_species FOR SELECT TO authenticated
    USING ((SELECT public.current_app_role()) IN ('botanist', 'officer', 'researcher'));
CREATE POLICY "officer adds website species"
    ON public.website_species FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.current_app_role()) = 'officer');
CREATE POLICY "officer changes website species"
    ON public.website_species FOR UPDATE TO authenticated
    USING ((SELECT public.current_app_role()) = 'officer')
    WITH CHECK ((SELECT public.current_app_role()) = 'officer');
CREATE POLICY "officer deletes website species"
    ON public.website_species FOR DELETE TO authenticated
    USING ((SELECT public.current_app_role()) = 'officer');

COMMIT;
