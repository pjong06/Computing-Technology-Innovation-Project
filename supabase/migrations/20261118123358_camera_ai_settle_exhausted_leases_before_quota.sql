-- Settle expired terminal leases even when quota/backoff prevents another API attempt.
CREATE OR REPLACE FUNCTION public.camera_ai_claim() RETURNS jsonb
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
  UPDATE public.camera_ai_reviews SET status='failed',error_code='LEASE_EXHAUSTED',lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE status='processing' AND lease_until < CURRENT_TIMESTAMP AND attempts >= 3;
  IF cfg.attempts_today >= cfg.daily_limit OR cfg.next_claim_at > CURRENT_TIMESTAMP THEN RETURN NULL; END IF;
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
