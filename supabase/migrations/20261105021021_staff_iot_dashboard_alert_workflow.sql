-- User-approved active Officer/Botanist/Researcher dashboard and alert workflow.
ALTER TABLE public.alerts ADD COLUMN resolution_notes text
  CHECK (resolution_notes IS NULL OR char_length(resolution_notes) <= 2000);
GRANT SELECT (resolution_notes), UPDATE (resolution_notes) ON public.alerts TO authenticated;
CREATE POLICY staff_read_sensor_stations ON public.sensor_stations
FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) IN ('botanist','researcher'));
CREATE POLICY staff_handle_alerts ON public.alerts
FOR UPDATE TO authenticated
USING ((SELECT public.current_app_role()) IN ('botanist','researcher'))
WITH CHECK ((SELECT public.current_app_role()) IN ('botanist','researcher'));
CREATE FUNCTION public.enforce_alert_staff_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
BEGIN
  IF NEW.alert_status IS NOT DISTINCT FROM OLD.alert_status THEN
    IF NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes THEN
      RAISE EXCEPTION 'Notes can only be changed while resolving an alert' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT public.current_app_role()) IS NULL OR
     (SELECT public.current_app_role()) NOT IN ('officer','botanist','researcher') OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Active staff required' USING ERRCODE='42501';
  END IF;
  IF OLD.alert_status='open' AND NEW.alert_status='acknowledged' THEN
    IF NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes THEN
      RAISE EXCEPTION 'Notes require resolution' USING ERRCODE='23514';
    END IF;
    NEW.acknowledged_by := auth.uid();
    NEW.acknowledged_at := now();
    NEW.resolved_by := OLD.resolved_by;
    NEW.resolved_at := OLD.resolved_at;
  ELSIF OLD.alert_status='acknowledged' AND NEW.alert_status='resolved' THEN
    NEW.acknowledged_by := OLD.acknowledged_by;
    NEW.acknowledged_at := OLD.acknowledged_at;
    NEW.resolved_by := auth.uid();
    NEW.resolved_at := now();
  ELSE
    RAISE EXCEPTION 'Invalid alert state transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_alert_staff_transition() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER enforce_alert_staff_transition BEFORE UPDATE ON public.alerts
FOR EACH ROW EXECUTE FUNCTION public.enforce_alert_staff_transition();
