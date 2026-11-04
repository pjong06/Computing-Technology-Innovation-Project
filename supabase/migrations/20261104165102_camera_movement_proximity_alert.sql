-- Preserve all original metrics, comparisons, function owner and ACL.
ALTER TABLE public.alert_rules DROP CONSTRAINT alert_rules_metric_check;
ALTER TABLE public.alert_rules ADD CONSTRAINT alert_rules_metric_check CHECK (metric IN ('temperature_c','humidity_percent','movement_detected','vibration_level','battery_percent','movement_nearby_cm'));
CREATE OR REPLACE FUNCTION public.generate_sensor_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 insert into public.alerts(station_id,reading_id,alert_message,severity)
 select new.station_id,new.id,r.rule_name || ' (' || r.metric || ')',r.severity
 from public.alert_rules r
 cross join lateral (select case r.metric
 when 'temperature_c' then new.temperature_c
 when 'humidity_percent' then new.humidity_percent
 when 'vibration_level' then new.vibration_level
 when 'battery_percent' then new.battery_percent
 when 'movement_nearby_cm' then case when new.movement_detected and new.distance_valid then new.distance_cm else null end
 when 'movement_detected' then case when new.movement_detected then 1::numeric else 0::numeric end
 end as measured) m
 where r.is_enabled and (r.station_id = new.station_id or r.station_id is null)
 and m.measured is not null
 and case r.comparison_operator
 when '>' then m.measured > r.threshold_value
 when '>=' then m.measured >= r.threshold_value
 when '<' then m.measured < r.threshold_value
 when '<=' then m.measured <= r.threshold_value
 when '=' then m.measured = r.threshold_value
 else false end;
 return new;
end $function$;

-- The adapter filters the alert type marker, so it needs this SELECT column.
GRANT SELECT (alert_message) ON public.alerts TO service_role;
-- Prototype rule is deliberately limited to the existing Steven test station.
INSERT INTO public.alert_rules(station_id,rule_name,metric,comparison_operator,threshold_value,severity,is_enabled)
SELECT id,'Camera movement within range','movement_nearby_cm','<=',100,'high',true
FROM public.sensor_stations WHERE station_code='steven-sprint2-test-01';
