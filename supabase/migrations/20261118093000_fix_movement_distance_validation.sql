-- Require both detected movement and a valid distance
-- before evaluating movement_nearby_cm alert rules.
-- Preserve the existing station-specific rule precedence.

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
          WHEN NEW.movement_detected IS TRUE
            AND NEW.distance_valid IS TRUE
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

    -- Station-specific rules override global rules
    -- for the same metric.
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