-- Dedicated camera resources. Preserve every existing bucket and policy.
CREATE TABLE public.alert_camera_evidence (
  id uuid PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES public.alerts(id),
  file_path text NOT NULL UNIQUE CHECK (char_length(file_path) = 114),
  captured_at timestamptz NOT NULL,
  byte_count integer NOT NULL CHECK (byte_count > 0 AND byte_count <= 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_camera_evidence_alert_time_idx
  ON public.alert_camera_evidence(alert_id, captured_at);
ALTER TABLE public.alert_camera_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alert_camera_evidence FROM anon, authenticated, service_role;
GRANT SELECT ON public.alert_camera_evidence TO authenticated;
GRANT SELECT, INSERT ON public.alert_camera_evidence TO service_role;

-- Only columns actually queried by the existing camera upload adapter.
GRANT SELECT (station_id) ON public.sensor_readings TO service_role;
GRANT SELECT (id, reading_id, station_id, triggered_at) ON public.alerts TO service_role;

CREATE FUNCTION public.validate_camera_evidence_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE station_uuid uuid;
BEGIN
  SELECT a.station_id INTO station_uuid FROM public.alerts a WHERE a.id = NEW.alert_id;
  IF station_uuid IS NULL OR NEW.file_path IS DISTINCT FROM
    station_uuid::text || '/' || NEW.alert_id::text || '/' || NEW.id::text || '.jpg'
  THEN
    RAISE EXCEPTION 'Invalid camera evidence association' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'camera-evidence' AND o.name = NEW.file_path
      AND o.metadata->>'mimetype' = 'image/jpeg'
      AND (o.metadata->>'size')::bigint = NEW.byte_count
  ) THEN
    RAISE EXCEPTION 'Matching camera object required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_camera_evidence_link() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_camera_evidence_link() TO service_role;
CREATE TRIGGER validate_camera_evidence_link
BEFORE INSERT OR UPDATE ON public.alert_camera_evidence
FOR EACH ROW EXECUTE FUNCTION public.validate_camera_evidence_link();

CREATE POLICY camera_evidence_officer_read
ON public.alert_camera_evidence FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) = 'officer');

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('camera-evidence', 'camera-evidence', false, 5242880, ARRAY['image/jpeg']);

CREATE POLICY camera_objects_officer_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'camera-evidence'
  AND (SELECT public.current_app_role()) = 'officer'
  AND EXISTS (
    SELECT 1 FROM public.alert_camera_evidence e WHERE e.file_path = storage.objects.name
  )
);
