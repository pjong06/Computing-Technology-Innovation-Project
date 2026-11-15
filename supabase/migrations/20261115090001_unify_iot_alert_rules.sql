
-- Unify IoT database alert thresholds.
-- Draft migration: Phoebe must review against the live Supabase schema.
-- Existing station-specific rules take priority over global defaults.

ALTER TABLE public.alert_rules
DROP CONSTRAINT IF EXISTS alert_rules_metric_check;

ALTER TABLE public.alert_rules
ADD CONSTRAINT alert_rules_metric_check
CHECK (
  metric IN (
    'temperature_c',
    'humidity_percent',
    'movement_detected',
    'vibration_level',
    'battery_percent',
    'movement_nearby_cm',
    'soil_moisture_pct',
    'rain_intensity_pct'
  )
);

CREATE OR REPLACE FUNCTION public.generate_sensor_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.alerts (
    station_id,
    reading_id,
    alert_message,
    severity
  )
  SELECT
    NEW.station_id,
    NEW.id,
    r.rule_name || ' (' || r.metric || ')',
    r.severity
  FROM public.alert_rules r
  CROSS JOIN LATERAL (
    SELECT CASE r.metric
      WHEN 'temperature_c'
        THEN NEW.temperature_c
      WHEN 'humidity_percent'
        THEN NEW.humidity_percent
      WHEN 'vibration_level'
        THEN NEW.vibration_level
      WHEN 'battery_percent'
        THEN NEW.battery_percent
      WHEN 'movement_nearby_cm'
        THEN CASE
          WHEN NEW.distance_valid IS TRUE
            THEN NEW.distance_cm
          ELSE NULL
        END
      WHEN 'movement_detected'
        THEN CASE
          WHEN NEW.movement_detected IS TRUE
            THEN 1::numeric
          ELSE 0::numeric
        END
      WHEN 'soil_moisture_pct'
        THEN NEW.soil_moisture_pct
      WHEN 'rain_intensity_pct'
        THEN NEW.rain_intensity_pct
      ELSE NULL
    END AS measured
  ) m
  WHERE
    r.is_enabled
    AND (
      r.station_id = NEW.station_id
      OR r.station_id IS NULL
    )

    -- Do not apply a global rule when an enabled
    -- station-specific rule for that metric exists.
    AND (
      r.station_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.alert_rules specific
        WHERE specific.station_id = NEW.station_id
          AND specific.metric = r.metric
          AND specific.is_enabled
      )
    )

    AND m.measured IS NOT NULL
    AND CASE r.comparison_operator
      WHEN '>' THEN m.measured > r.threshold_value
      WHEN '>=' THEN m.measured >= r.threshold_value
      WHEN '<' THEN m.measured < r.threshold_value
      WHEN '<=' THEN m.measured <= r.threshold_value
      WHEN '=' THEN m.measured = r.threshold_value
      ELSE FALSE
    END;

  RETURN NEW;
END;
$function$;

-- Create global defaults where none exist.
-- Uses 'high', a value present in the existing migration.
-- Severity categories need live-schema confirmation.

INSERT INTO public.alert_rules (
  station_id,
  rule_name,
  metric,
  comparison_operator,
  threshold_value,
  severity,
  is_enabled
)
SELECT
  NULL,
  defaults.rule_name,
  defaults.metric,
  defaults.comparison_operator,
  defaults.threshold_value,
  'high',
  TRUE
FROM (
  VALUES
    ('IoT high temperature', 'temperature_c', '>=', 35),
    ('IoT low soil moisture', 'soil_moisture_pct', '<=', 20),
    ('IoT heavy rain', 'rain_intensity_pct', '>=', 70),
    ('IoT proximity breach', 'movement_nearby_cm', '<=', 50)
) AS defaults (
  rule_name,
  metric,
  comparison_operator,
  threshold_value
)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.alert_rules existing
  WHERE existing.station_id IS NULL
    AND existing.metric = defaults.metric
);
