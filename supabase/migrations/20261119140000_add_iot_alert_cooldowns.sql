-- Add configurable cooldowns for IoT alert rules.
-- Historical alerts remain unchanged.

ALTER TABLE public.alert_rules
ADD COLUMN cooldown_seconds integer NOT NULL DEFAULT 300
CHECK (cooldown_seconds BETWEEN 0 AND 86400);

ALTER TABLE public.alerts
ADD COLUMN alert_rule_id uuid
REFERENCES public.alert_rules(id)
ON DELETE SET NULL;

-- Accelerate searches for recent alerts from the same rule.
CREATE INDEX alerts_station_rule_triggered_idx
ON public.alerts (
  station_id,
  alert_rule_id,
  triggered_at DESC
)
WHERE alert_rule_id IS NOT NULL;

-- Movement-related alerts use a shorter cooldown.
UPDATE public.alert_rules
SET cooldown_seconds = 120
WHERE metric IN (
  'movement_nearby_cm',
  'movement_detected'
);

-- Generate database alerts with a per-station, per-rule cooldown.
-- Serialize alert generation for each station to avoid
-- concurrent readings bypassing the cooldown.

CREATE OR REPLACE FUNCTION public.generate_sensor_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    872033,
    pg_catalog.hashtext(NEW.station_id::text)
  );

  INSERT INTO public.alerts (
    station_id,
    reading_id,
    alert_rule_id,
    alert_message,
    severity,
    triggered_at
  )
  SELECT
    NEW.station_id,
    NEW.id,
    r.id,
    r.rule_name || ' (' || r.metric || ')',
    r.severity,
    pg_catalog.clock_timestamp()
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

    -- Station-specific rules override global rules.
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

    -- Only evaluate valid measurements.
    AND m.measured IS NOT NULL
    AND CASE r.comparison_operator
      WHEN '>' THEN m.measured > r.threshold_value
      WHEN '>=' THEN m.measured >= r.threshold_value
      WHEN '<' THEN m.measured < r.threshold_value
      WHEN '<=' THEN m.measured <= r.threshold_value
      WHEN '=' THEN m.measured = r.threshold_value
      ELSE FALSE
    END

    -- Suppress repeated alerts during their cooldown.
    AND NOT EXISTS (
      SELECT 1
      FROM public.alerts previous
      WHERE previous.station_id = NEW.station_id
        AND previous.alert_rule_id = r.id
        AND previous.triggered_at >
          pg_catalog.clock_timestamp()
          - (r.cooldown_seconds * INTERVAL '1 second')
    );

  RETURN NEW;
END;
$function$;
