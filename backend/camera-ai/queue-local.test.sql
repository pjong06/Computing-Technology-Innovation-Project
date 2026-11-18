-- Run ONLY against the isolated test PostgreSQL instance. Transaction rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,account_status text);
CREATE TABLE public.sensor_stations(id uuid PRIMARY KEY,station_code text);
CREATE TABLE public.alerts(id uuid PRIMARY KEY,station_id uuid REFERENCES public.sensor_stations(id));
CREATE TABLE public.alert_camera_evidence(id uuid PRIMARY KEY,alert_id uuid REFERENCES public.alerts(id),file_path text,byte_count integer,sha256 text);
CREATE FUNCTION public.current_app_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() AND account_status='active' $$;
ALTER TABLE public.alert_camera_evidence ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT ON public.alert_camera_evidence TO authenticated;
CREATE POLICY staff ON public.alert_camera_evidence FOR SELECT TO authenticated USING (public.current_app_role() IN ('officer','botanist','researcher'));
INSERT INTO public.profiles VALUES
 ('00000000-0000-0000-0000-000000000001','officer','active'),
 ('00000000-0000-0000-0000-000000000002','botanist','active'),
 ('00000000-0000-0000-0000-000000000003','researcher','active'),
 ('00000000-0000-0000-0000-000000000004','visitor','active'),
 ('00000000-0000-0000-0000-000000000005','officer','suspended');
INSERT INTO public.sensor_stations VALUES
 ('10000000-0000-0000-0000-000000000001','steven-sprint2-test-01'),
 ('10000000-0000-0000-0000-000000000002','other-station');
INSERT INTO public.alerts VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
\ir ../../supabase/migrations/20261118120218_camera_ai_persistent_review_queue.sql
\ir ../../supabase/migrations/20261118123358_camera_ai_settle_exhausted_leases_before_quota.sql
-- Disabled deployment cannot submit historical/existing metadata to AI.
INSERT INTO public.alert_camera_evidence VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','old.jpg',1,repeat('a',64));
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.camera_ai_reviews) THEN RAISE EXCEPTION 'disabled enqueue'; END IF; END $$;
UPDATE camera_ai_private.settings SET enabled=true WHERE singleton;
INSERT INTO public.alert_camera_evidence VALUES
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','new.jpg',1,repeat('a',64)),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','other.jpg',1,repeat('a',64));
DO $$ BEGIN IF (SELECT count(*) FROM public.camera_ai_reviews)<>1 THEN RAISE EXCEPTION 'scope or backfill'; END IF; END $$;
DO $$ BEGIN
  BEGIN INSERT INTO public.camera_ai_reviews(evidence_id) VALUES ('30000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'duplicate allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
-- Actual service role can claim RPC but has no direct queue table permissions.
SET LOCAL ROLE service_role;
SELECT public.camera_ai_claim() IS NOT NULL AS service_claim;
DO $$ BEGIN
  IF public.camera_ai_claim() IS NOT NULL THEN RAISE EXCEPTION 'concurrent duplicate claim'; END IF;
  BEGIN PERFORM 1 FROM public.camera_ai_reviews; RAISE EXCEPTION 'direct access allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Expired lease: a new worker can reclaim and stale completion is fenced out.
CREATE TEMP TABLE old_lease AS SELECT id,lease_token FROM public.camera_ai_reviews;
UPDATE public.camera_ai_reviews SET lease_until=CURRENT_TIMESTAMP-interval '1 second' WHERE status='processing';
UPDATE camera_ai_private.settings SET next_claim_at=CURRENT_TIMESTAMP WHERE singleton;
SELECT public.camera_ai_claim();
DO $$ DECLARE old old_lease; j public.camera_ai_reviews; BEGIN
  SELECT * INTO old FROM old_lease;
  IF public.camera_ai_finish(old.id,old.lease_token,'{"targets":["person"],"uncertain":false,"scene_status":"target_detected"}',NULL) THEN RAISE EXCEPTION 'stale completion accepted'; END IF;
  SELECT * INTO j FROM public.camera_ai_reviews;
  IF j.attempts<>2 THEN RAISE EXCEPTION 'restart did not reclaim'; END IF;
  BEGIN PERFORM public.camera_ai_finish(j.id,j.lease_token,'{"targets":[],"uncertain":false,"scene_status":"unclear"}',NULL); RAISE EXCEPTION 'invalid accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'AI_RESULT_INVALID' THEN RAISE; END IF; END;
  IF NOT public.camera_ai_finish(j.id,j.lease_token,'{"targets":["person","animal"],"uncertain":false,"scene_status":"target_detected"}',NULL) THEN RAISE EXCEPTION 'completion failed'; END IF;
END $$;
-- All three active staff can read and review. Visitor/suspended cannot.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE j uuid; BEGIN
 SELECT id INTO j FROM public.camera_ai_reviews; IF j IS NULL THEN RAISE EXCEPTION 'officer read'; END IF;
 PERFORM public.camera_ai_review_human(j,'confirmed');
 BEGIN PERFORM public.camera_ai_claim(); RAISE EXCEPTION 'staff claimed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.camera_ai_reviews(evidence_id) VALUES ('30000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'staff wrote AI'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
DO $$ DECLARE j uuid; BEGIN SELECT id INTO j FROM public.camera_ai_reviews; IF j IS NULL THEN RAISE EXCEPTION 'botanist read'; END IF; PERFORM public.camera_ai_review_human(j,'incorrect'); END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
DO $$ DECLARE j uuid; BEGIN SELECT id INTO j FROM public.camera_ai_reviews; IF j IS NULL THEN RAISE EXCEPTION 'researcher read'; END IF; PERFORM public.camera_ai_review_human(j,'uncertain'); END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.camera_ai_reviews) THEN RAISE EXCEPTION 'visitor read'; END IF;
 BEGIN PERFORM public.camera_ai_review_human(gen_random_uuid(),'confirmed'); RAISE EXCEPTION 'visitor reviewed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.camera_ai_reviews) THEN RAISE EXCEPTION 'suspended read'; END IF; END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN BEGIN PERFORM 1 FROM public.camera_ai_reviews; RAISE EXCEPTION 'anonymous read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
-- Daily cap is persisted; UTC day change resets budget, not historical backfill.
UPDATE camera_ai_private.settings SET attempts_today=10,next_claim_at=CURRENT_TIMESTAMP WHERE singleton;
INSERT INTO public.alert_camera_evidence VALUES ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','new2.jpg',1,repeat('a',64));
DO $$ BEGIN IF public.camera_ai_claim() IS NOT NULL THEN RAISE EXCEPTION 'budget exceeded'; END IF; END $$;
UPDATE camera_ai_private.settings SET budget_day=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date-1 WHERE singleton;
DO $$ DECLARE j jsonb; BEGIN
 j:=public.camera_ai_claim(); IF j IS NULL THEN RAISE EXCEPTION 'day reset'; END IF;
 PERFORM public.camera_ai_finish((j->>'id')::uuid,(j->>'lease_token')::uuid,NULL,'GEMINI_HTTP_429');
 IF public.camera_ai_claim() IS NOT NULL THEN RAISE EXCEPTION 'global backoff missing'; END IF;
END $$;
-- Retry is bounded at three claims, including recovery after a process crash.
UPDATE camera_ai_private.settings SET next_claim_at=CURRENT_TIMESTAMP WHERE singleton;
UPDATE public.camera_ai_reviews SET available_at=CURRENT_TIMESTAMP WHERE status='pending';
DO $$ DECLARE j jsonb; BEGIN
 j:=public.camera_ai_claim();
 PERFORM public.camera_ai_finish((j->>'id')::uuid,(j->>'lease_token')::uuid,NULL,'GEMINI_TIMEOUT');
END $$;
UPDATE camera_ai_private.settings SET next_claim_at=CURRENT_TIMESTAMP WHERE singleton;
UPDATE public.camera_ai_reviews SET available_at=CURRENT_TIMESTAMP WHERE status='pending';
DO $$ DECLARE j jsonb; BEGIN
 j:=public.camera_ai_claim();
 PERFORM public.camera_ai_finish((j->>'id')::uuid,(j->>'lease_token')::uuid,NULL,'GEMINI_TIMEOUT');
 IF NOT EXISTS (SELECT 1 FROM public.camera_ai_reviews WHERE status='failed' AND attempts=3) THEN RAISE EXCEPTION 'retry limit missing'; END IF;
END $$;
UPDATE camera_ai_private.settings SET attempts_today=10,next_claim_at=CURRENT_TIMESTAMP+interval '1 hour' WHERE singleton;
UPDATE public.camera_ai_reviews SET status='processing',attempts=3,lease_token=gen_random_uuid(),lease_until=CURRENT_TIMESTAMP-interval '1 second' WHERE evidence_id='30000000-0000-0000-0000-000000000004';
DO $$ BEGIN
 IF public.camera_ai_claim() IS NOT NULL THEN RAISE EXCEPTION 'budget claim allowed'; END IF;
 IF EXISTS(SELECT 1 FROM public.camera_ai_reviews WHERE status='processing') THEN RAISE EXCEPTION 'terminal lease stuck at budget cap'; END IF;
 IF (SELECT attempts_today FROM camera_ai_private.settings WHERE singleton)<>10 THEN RAISE EXCEPTION 'cleanup used budget'; END IF;
END $$;
SELECT 'PASS: scope, no backfill, uniqueness, leases, recovery, real SQL roles/RLS, human review, budget, 429 backoff, bounded retries, terminal lease cleanup at budget cap' AS acceptance;
ROLLBACK;
