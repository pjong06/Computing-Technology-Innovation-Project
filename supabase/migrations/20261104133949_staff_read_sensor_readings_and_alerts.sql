-- Owner-authorized shared IoT read access, 4 November 2026.
-- Retain existing RLS, grants, Officer policies and all write restrictions.
CREATE POLICY "botanists and researchers read sensor readings"
ON public.sensor_readings
FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) IN ('botanist', 'researcher'));

CREATE POLICY "botanists and researchers read alerts"
ON public.alerts
FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) IN ('botanist', 'researcher'));
