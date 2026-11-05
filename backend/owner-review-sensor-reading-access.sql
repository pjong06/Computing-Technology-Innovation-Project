-- APPLIED on 4 November 2026 with the owner's authorization; do not rerun.
-- Canonical migration: 20261104133949_staff_read_sensor_readings_and_alerts.sql.
-- Scope: read-only sensor readings AND alerts for active Botanist/Researcher.
-- Existing SELECT policies: "officers read sensor readings" / "officers read alerts", authenticated,
-- USING (public.current_app_role() = 'officer').
-- Existing authenticated SELECT grant and RLS remain in place.
-- current_app_role() reads profiles and returns a role only for active accounts.
-- Retained as the reviewed SQL record; the two policies now exist live.
BEGIN;

CREATE POLICY "botanists and researchers read sensor readings"
ON public.sensor_readings
FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) IN ('botanist', 'researcher'));

CREATE POLICY "botanists and researchers read alerts"
ON public.alerts
FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) IN ('botanist', 'researcher'));

COMMIT;

-- Rollback (separate operation, only if reverting this permission change):
-- DROP POLICY "botanists and researchers read sensor readings" ON public.sensor_readings;
-- DROP POLICY "botanists and researchers read alerts" ON public.alerts;
