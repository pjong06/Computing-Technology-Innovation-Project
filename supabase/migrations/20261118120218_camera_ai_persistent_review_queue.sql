-- REVIEW PROPOSAL, not an applied migration. New objects only; no historical backfill.
-- Generate the final versioned migration using the team's Supabase CLI before applying.
CREATE SCHEMA camera_ai_private;
REVOKE ALL ON SCHEMA camera_ai_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE camera_ai_private.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  station_code text NOT NULL DEFAULT 'steven-sprint2-test-01',
  daily_limit integer NOT NULL DEFAULT 10 CHECK (daily_limit BETWEEN 1 AND 10),
  budget_day date NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
  attempts_today integer NOT NULL DEFAULT 0 CHECK (attempts_today >= 0),
  next_claim_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO camera_ai_private.settings(singleton) VALUES (true);
REVOKE ALL ON camera_ai_private.settings FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.camera_ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.alert_camera_evidence(id) ON DELETE CASCADE,
  model text NOT NULL DEFAULT 'gemini-3.5-flash-lite' CHECK (model = 'gemini-3.5-flash-lite'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  targets text[] CHECK (targets <@ ARRAY['person','animal']::text[] AND cardinality(targets) <= 2),
  uncertain boolean,
  scene_status text CHECK (scene_status IN ('target_detected','no_target_detected','unclear')),
  human_review_required boolean NOT NULL DEFAULT true CHECK (human_review_required),
  error_code text,
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  UNIQUE (evidence_id,model),
  CHECK (status <> 'completed' OR (targets IS NOT NULL AND uncertain IS NOT NULL AND scene_status IS NOT NULL))
);
CREATE INDEX camera_ai_reviews_pending ON public.camera_ai_reviews(status,available_at,created_at);
ALTER TABLE public.camera_ai_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.camera_ai_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id,evidence_id,model,status,attempts,targets,uncertain,scene_status,human_review_required,error_code,created_at,updated_at,completed_at)
  ON public.camera_ai_reviews TO authenticated;
CREATE POLICY camera_ai_staff_read ON public.camera_ai_reviews FOR SELECT TO authenticated
USING (
  (SELECT public.current_app_role()) IN ('officer','botanist','researcher')
  AND EXISTS (SELECT 1 FROM public.alert_camera_evidence e WHERE e.id = evidence_id)
);

CREATE FUNCTION camera_ai_private.enqueue_new_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM camera_ai_private.settings cfg
    JOIN public.alerts a ON a.id = NEW.alert_id
    JOIN public.sensor_stations s ON s.id = a.station_id
    WHERE cfg.singleton AND cfg.enabled AND s.station_code = cfg.station_code
  ) THEN
    INSERT INTO public.camera_ai_reviews(evidence_id) VALUES (NEW.id)
    ON CONFLICT (evidence_id,model) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION camera_ai_private.enqueue_new_evidence() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enqueue_camera_ai_after_upload AFTER INSERT ON public.alert_camera_evidence
FOR EACH ROW EXECUTE FUNCTION camera_ai_private.enqueue_new_evidence();

-- Only the server credential can claim; lock serializes budgets across instances.
CREATE FUNCTION public.camera_ai_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cfg camera_ai_private.settings; job public.camera_ai_reviews;
        evidence public.alert_camera_evidence; today date := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT * INTO cfg FROM camera_ai_private.settings WHERE singleton FOR UPDATE;
  IF NOT cfg.enabled THEN RETURN NULL; END IF;
  IF cfg.budget_day <> today THEN
    UPDATE camera_ai_private.settings SET budget_day=today,attempts_today=0 WHERE singleton;
    cfg.attempts_today := 0;
  END IF;
  IF cfg.attempts_today >= cfg.daily_limit OR cfg.next_claim_at > CURRENT_TIMESTAMP THEN RETURN NULL; END IF;
  UPDATE public.camera_ai_reviews SET status='failed',error_code='LEASE_EXHAUSTED',lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE status='processing' AND lease_until < CURRENT_TIMESTAMP AND attempts >= 3;
  SELECT j.* INTO job FROM public.camera_ai_reviews j
    JOIN public.alert_camera_evidence e ON e.id=j.evidence_id
    JOIN public.alerts a ON a.id=e.alert_id
    JOIN public.sensor_stations s ON s.id=a.station_id
    WHERE s.station_code=cfg.station_code AND j.attempts<3 AND
      ((j.status='pending' AND j.available_at<=CURRENT_TIMESTAMP) OR
       (j.status='processing' AND j.lease_until<CURRENT_TIMESTAMP))
    ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.camera_ai_reviews SET status='processing',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=CURRENT_TIMESTAMP+interval '3 minutes',updated_at=CURRENT_TIMESTAMP
    WHERE id=job.id RETURNING * INTO job;
  UPDATE camera_ai_private.settings SET attempts_today=attempts_today+1,next_claim_at=CURRENT_TIMESTAMP+interval '15 seconds' WHERE singleton;
  SELECT * INTO evidence FROM public.alert_camera_evidence WHERE id=job.evidence_id;
  RETURN jsonb_build_object('id',job.id,'evidence_id',job.evidence_id,'model',job.model,
    'lease_token',job.lease_token,'alert_id',evidence.alert_id,'file_path',evidence.file_path,
    'sha256',evidence.sha256,'byte_count',evidence.byte_count);
END $$;
REVOKE ALL ON FUNCTION public.camera_ai_claim() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.camera_ai_claim() TO service_role;

CREATE FUNCTION public.camera_ai_finish(p_job uuid,p_lease uuid,p_result jsonb DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE job public.camera_ai_reviews; ts text[]; scene text; unsure boolean;
BEGIN
  -- Same lock order as claim (settings, then job), including 429 backoff updates.
  PERFORM 1 FROM camera_ai_private.settings WHERE singleton FOR UPDATE;
  SELECT * INTO job FROM public.camera_ai_reviews WHERE id=p_job AND status='processing'
    AND lease_token=p_lease AND lease_until>CURRENT_TIMESTAMP FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_error IS NULL THEN
    IF p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR
       jsonb_typeof(p_result->'targets') IS DISTINCT FROM 'array' OR
       jsonb_typeof(p_result->'uncertain') IS DISTINCT FROM 'boolean' OR
       p_result->>'scene_status' IS NULL OR
       (SELECT count(*) FROM jsonb_object_keys(p_result))<>3 THEN
      RAISE EXCEPTION 'AI_RESULT_INVALID';
    END IF;
    ts := ARRAY(SELECT jsonb_array_elements_text(p_result->'targets'));
    scene := p_result->>'scene_status'; unsure := (p_result->>'uncertain')::boolean;
    IF NOT (ts <@ ARRAY['person','animal']::text[]) OR cardinality(ts)>2 OR
      cardinality(ts)<>(SELECT count(DISTINCT t) FROM unnest(ts) t) OR
      scene NOT IN ('target_detected','no_target_detected','unclear') OR
      (scene='target_detected' AND cardinality(ts)=0) OR
      (scene='no_target_detected' AND (cardinality(ts)>0 OR unsure)) OR
      (scene='unclear' AND NOT unsure) THEN RAISE EXCEPTION 'AI_RESULT_INVALID'; END IF;
    UPDATE public.camera_ai_reviews SET status='completed',targets=ts,uncertain=unsure,scene_status=scene,
      error_code=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,lease_token=NULL,lease_until=NULL WHERE id=p_job;
  ELSE
    IF p_error NOT IN ('GEMINI_HTTP_429','GEMINI_HTTP_500','GEMINI_HTTP_502','GEMINI_HTTP_503','GEMINI_HTTP_504',
      'GEMINI_HTTP_400','GEMINI_HTTP_401','GEMINI_HTTP_403','GEMINI_HTTP_404','GEMINI_TIMEOUT','GEMINI_NETWORK_FAILED',
      'AI_RESULT_INVALID','AI_RESPONSE_INCOMPLETE','IMAGE_SIZE_INVALID','IMAGE_DECODE_FAILED',
      'EVIDENCE_INTEGRITY_FAILED','STORAGE_UNAVAILABLE','WORKER_FAILED') THEN RAISE EXCEPTION 'ERROR_CODE_INVALID'; END IF;
    UPDATE public.camera_ai_reviews SET
      status=CASE WHEN attempts<3 AND p_error IN ('GEMINI_HTTP_429','GEMINI_HTTP_500','GEMINI_HTTP_502','GEMINI_HTTP_503','GEMINI_HTTP_504','GEMINI_TIMEOUT','GEMINI_NETWORK_FAILED','STORAGE_UNAVAILABLE') THEN 'pending' ELSE 'failed' END,
      available_at=CURRENT_TIMESTAMP+CASE WHEN p_error='GEMINI_HTTP_429' THEN interval '15 minutes' ELSE interval '1 minute' END,
      error_code=p_error,updated_at=CURRENT_TIMESTAMP,lease_token=NULL,lease_until=NULL WHERE id=p_job;
    IF p_error='GEMINI_HTTP_429' THEN
      UPDATE camera_ai_private.settings SET next_claim_at=CURRENT_TIMESTAMP+interval '15 minutes' WHERE singleton;
    END IF;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.camera_ai_finish(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.camera_ai_finish(uuid,uuid,jsonb,text) TO service_role;

-- Minimal separate human confirmation, never change the original alert lifecycle.
CREATE TABLE public.camera_ai_human_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.camera_ai_reviews(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
  decision text NOT NULL CHECK (decision IN ('confirmed','incorrect','uncertain')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.camera_ai_human_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.camera_ai_human_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.camera_ai_human_reviews TO authenticated;
CREATE POLICY camera_ai_human_staff_read ON public.camera_ai_human_reviews FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) IN ('officer','botanist','researcher')
  AND EXISTS (SELECT 1 FROM public.camera_ai_reviews r WHERE r.id=review_id));

CREATE FUNCTION public.camera_ai_review_human(p_review uuid,p_decision text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.current_app_role() IS NULL OR
     public.current_app_role() NOT IN ('officer','botanist','researcher') THEN RAISE EXCEPTION 'STAFF_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('confirmed','incorrect','uncertain') THEN RAISE EXCEPTION 'DECISION_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.camera_ai_reviews WHERE id=p_review AND status='completed') THEN RAISE EXCEPTION 'REVIEW_NOT_COMPLETED'; END IF;
  INSERT INTO public.camera_ai_human_reviews(review_id,reviewer_id,decision) VALUES (p_review,auth.uid(),p_decision) RETURNING id INTO new_id;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.camera_ai_review_human(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.camera_ai_review_human(uuid,text) TO authenticated;

-- Deliberately disabled. After review, enable only the approved station with:
-- UPDATE camera_ai_private.settings SET enabled=true WHERE singleton;
-- No INSERT SELECT/backfill from existing photos is performed.
