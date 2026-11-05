-- Scoped to the three website tables. Existing unverified owners remain NULL.
ALTER TABLE public.website_observations ADD COLUMN owner_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.website_observations ALTER COLUMN owner_id SET DEFAULT auth.uid();
CREATE INDEX website_observations_owner_id_idx ON public.website_observations(owner_id);

DROP POLICY "active staff can use website observations" ON public.website_observations;
DROP POLICY "active staff can use website species" ON public.website_species;
DROP POLICY "only the officer can use website users" ON public.website_users;

CREATE POLICY website_observations_read ON public.website_observations FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) = 'officer'
 OR ((SELECT public.current_app_role()) = 'botanist' AND owner_id = (SELECT auth.uid()))
 OR ((SELECT public.current_app_role()) = 'researcher' AND state = 'Approved'));
CREATE POLICY website_observations_submit ON public.website_observations FOR INSERT TO authenticated
WITH CHECK ((SELECT public.current_app_role()) = 'botanist' AND owner_id = (SELECT auth.uid())
 AND state IN ('Draft', 'Pending') AND reject_reason = '');
CREATE POLICY website_observations_edit_own ON public.website_observations FOR UPDATE TO authenticated
USING ((SELECT public.current_app_role()) = 'botanist' AND owner_id = (SELECT auth.uid()) AND state IN ('Draft','Rejected'))
WITH CHECK ((SELECT public.current_app_role()) = 'botanist' AND owner_id = (SELECT auth.uid()) AND state IN ('Draft','Pending') AND reject_reason = '');
CREATE POLICY website_observations_review ON public.website_observations FOR UPDATE TO authenticated
USING ((SELECT public.current_app_role()) = 'officer' AND state IN ('Pending','Rejected'))
WITH CHECK ((SELECT public.current_app_role()) = 'officer' AND state IN ('Approved','Rejected','Pending'));
REVOKE DELETE ON public.website_observations FROM authenticated;

-- Officers review submissions without rewriting the submitted scientific evidence.
CREATE FUNCTION public.guard_website_observation_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE caller_role text := public.current_app_role();
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF TG_OP = 'INSERT' THEN
  IF caller_role IS DISTINCT FROM 'botanist' OR NEW.owner_id IS DISTINCT FROM auth.uid()
    OR NEW.state NOT IN ('Draft','Pending') OR NEW.reject_reason <> '' THEN
   RAISE EXCEPTION 'Only botanists may submit their own Draft or Pending observations' USING ERRCODE='42501';
  END IF;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'Observation identity and ownership are immutable' USING ERRCODE='42501';
  END IF;
  IF caller_role = 'officer' THEN
   IF (to_jsonb(NEW) - ARRAY['state','reject_reason']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['state','reject_reason']) THEN
    RAISE EXCEPTION 'Officers may change review fields only' USING ERRCODE='42501';
   END IF;
   IF NOT ((OLD.state = 'Pending' AND NEW.state IN ('Approved','Rejected'))
        OR (OLD.state = 'Rejected' AND NEW.state = 'Pending')) THEN
    RAISE EXCEPTION 'Invalid officer review transition' USING ERRCODE='42501';
   END IF;
   IF NEW.state = 'Rejected' AND btrim(NEW.reject_reason) = '' THEN
    RAISE EXCEPTION 'Rejection requires a reason' USING ERRCODE='23514';
   END IF;
   IF NEW.state <> 'Rejected' AND NEW.reject_reason <> '' THEN
    RAISE EXCEPTION 'Clear rejection reason when approving or reopening' USING ERRCODE='23514';
   END IF;
  ELSIF caller_role = 'botanist' THEN
   IF OLD.owner_id IS DISTINCT FROM auth.uid() OR OLD.state NOT IN ('Draft','Rejected')
      OR NEW.state NOT IN ('Draft','Pending') OR NEW.reject_reason <> '' THEN
    RAISE EXCEPTION 'Only own editable observations may be changed' USING ERRCODE='42501';
   END IF;
  ELSE
   RAISE EXCEPTION 'Observation writes are not authorized' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_website_observation_write() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_website_observation_write BEFORE INSERT OR UPDATE ON public.website_observations
FOR EACH ROW EXECUTE FUNCTION public.guard_website_observation_write();

-- Full location-bearing catalogue is for officers and internal researchers.
-- Botanist/public reference browsing continues through the existing approved species API.
CREATE POLICY website_species_read ON public.website_species FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) IN ('officer','researcher'));
CREATE POLICY website_species_insert ON public.website_species FOR INSERT TO authenticated
WITH CHECK ((SELECT public.current_app_role()) = 'officer');
CREATE POLICY website_species_update ON public.website_species FOR UPDATE TO authenticated
USING ((SELECT public.current_app_role()) = 'officer')
WITH CHECK ((SELECT public.current_app_role()) = 'officer');
CREATE POLICY website_species_delete ON public.website_species FOR DELETE TO authenticated
USING ((SELECT public.current_app_role()) = 'officer');

CREATE POLICY website_users_admin ON public.website_users FOR ALL TO authenticated
USING ((SELECT public.current_app_role()) = 'admin')
WITH CHECK ((SELECT public.current_app_role()) = 'admin');

CREATE OR REPLACE FUNCTION public.sync_website_user_to_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE mapped_role text;
BEGIN
 IF TG_OP = 'DELETE' THEN
  UPDATE public.profiles SET account_status = 'suspended' WHERE id = OLD.id;
  RETURN OLD;
 END IF;
 mapped_role := CASE NEW.role
  WHEN 'Botanist' THEN 'botanist' WHEN 'botanist' THEN 'botanist'
  WHEN 'Conservation Officer' THEN 'officer' WHEN 'officer' THEN 'officer'
  WHEN 'Researcher' THEN 'researcher' WHEN 'researcher' THEN 'researcher'
  WHEN 'Administrator' THEN 'admin' WHEN 'admin' THEN 'admin'
  ELSE NULL END;
 IF mapped_role IS NULL THEN
  RAISE EXCEPTION 'Unsupported website role: %', NEW.role USING ERRCODE='23514';
 END IF;
 UPDATE public.profiles SET role = mapped_role,
  account_status = CASE WHEN NEW.active THEN 'active' ELSE 'suspended' END WHERE id = NEW.id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Website user requires an existing Auth profile' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_website_user_to_profile() FROM PUBLIC, anon, authenticated;
DROP TRIGGER website_users_update_profile ON public.website_users;
CREATE TRIGGER website_users_update_profile AFTER INSERT OR UPDATE OF role, active ON public.website_users
FOR EACH ROW EXECUTE FUNCTION public.sync_website_user_to_profile();
