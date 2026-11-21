-- Draft for review before deployment.
-- Track environmental conditions independently of staff alert status.
-- Assumes sensor_stations.id and sensor_readings.station_id are UUIDs.

CREATE TABLE public.iot_alert_rule_states (
  station_id uuid NOT NULL REFERENCES public.sensor_stations(id)
    ON DELETE CASCADE,
  alert_rule_id uuid NOT NULL REFERENCES public.alert_rules(id)
    ON DELETE CASCADE,
  is_abnormal boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (station_id, alert_rule_id)
);

ALTER TABLE public.iot_alert_rule_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.iot_alert_rule_states
  FROM PUBLIC, anon, authenticated;

-- Update movement rules even if the previous migration
-- was already applied with the old 10-second value.
UPDATE public.alert_rules
SET cooldown_seconds = 120
WHERE metric IN ('movement_nearby_cm', 'movement_detected');

CREATE OR REPLACE FUNCTION public.generate_sensor_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  r record;
  measured numeric;
  triggered boolean;
  already_abnormal boolean;
  is_movement boolean;
BEGIN
  -- Serialize alert processing for each monitoring station.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    872033,
    pg_catalog.hashtext(NEW.station_id::text)
  );

  FOR r IN
    SELECT rule.*
    FROM public.alert_rules rule
    WHERE rule.is_enabled
      AND (rule.station_id = NEW.station_id
           OR rule.station_id IS NULL)
      AND (
        rule.station_id IS NOT NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.alert_rules specific
          WHERE specific.station_id = NEW.station_id
            AND specific.metric = rule.metric
            AND specific.is_enabled
        )
      )
  LOOP
    measured := CASE r.metric
      WHEN 'temperature_c' THEN
        CASE WHEN NEW.dht_valid IS TRUE
          THEN NEW.temperature_c ELSE NULL END
      WHEN 'humidity_percent' THEN
        CASE WHEN NEW.dht_valid IS TRUE
          THEN NEW.humidity_percent ELSE NULL END
      WHEN 'soil_moisture_pct' THEN NEW.soil_moisture_pct
      WHEN 'rain_intensity_pct' THEN NEW.rain_intensity_pct
      WHEN 'vibration_level' THEN NEW.vibration_level
      WHEN 'battery_percent' THEN NEW.battery_percent
      WHEN 'movement_nearby_cm' THEN
        CASE WHEN NEW.movement_detected IS TRUE
          AND NEW.distance_valid IS TRUE
          THEN NEW.distance_cm ELSE NULL END
      WHEN 'movement_detected' THEN
        CASE WHEN NEW.movement_detected IS TRUE
          THEN 1::numeric ELSE 0::numeric END
      ELSE NULL
    END;

    -- Invalid or unavailable readings must not reset state.
    IF measured IS NULL THEN
      CONTINUE;
    END IF;

    triggered := CASE r.comparison_operator
      WHEN '>' THEN measured > r.threshold_value
      WHEN '>=' THEN measured >= r.threshold_value
      WHEN '<' THEN measured < r.threshold_value
      WHEN '<=' THEN measured <= r.threshold_value
      WHEN '=' THEN measured = r.threshold_value
      ELSE false
    END;

    is_movement := r.metric IN (
      'movement_nearby_cm', 'movement_detected'
    );

    IF is_movement THEN
      -- Movement keeps its time-based cooldown.
      IF triggered AND NOT EXISTS (
        SELECT 1
        FROM public.alerts previous
        WHERE previous.station_id = NEW.station_id
          AND previous.alert_rule_id = r.id
          AND previous.triggered_at >
            pg_catalog.clock_timestamp()
              - (r.cooldown_seconds * INTERVAL '1 second')
      ) THEN
        INSERT INTO public.alerts (
          station_id, reading_id, alert_rule_id,
          alert_message, severity, triggered_at
        )
        VALUES (
          NEW.station_id, NEW.id, r.id,
          r.rule_name || ' (' || r.metric || ')',
          r.severity, pg_catalog.clock_timestamp()
        );
      END IF;
    ELSE
      -- Ensure each environmental rule has a state record.
      INSERT INTO public.iot_alert_rule_states (
        station_id, alert_rule_id, is_abnormal
      )
      VALUES (NEW.station_id, r.id, false)
      ON CONFLICT (station_id, alert_rule_id) DO NOTHING;

      SELECT state.is_abnormal
      INTO already_abnormal
      FROM public.iot_alert_rule_states state
      WHERE state.station_id = NEW.station_id
        AND state.alert_rule_id = r.id
      FOR UPDATE;

      IF triggered AND NOT already_abnormal THEN
        -- First abnormal reading of a new episode.
        INSERT INTO public.alerts (
          station_id, reading_id, alert_rule_id,
          alert_message, severity, triggered_at
        )
        VALUES (
          NEW.station_id, NEW.id, r.id,
          r.rule_name || ' (' || r.metric || ')',
          r.severity, pg_catalog.clock_timestamp()
        );

        UPDATE public.iot_alert_rule_states
        SET is_abnormal = true,
            updated_at = pg_catalog.clock_timestamp()
        WHERE station_id = NEW.station_id
          AND alert_rule_id = r.id;

      ELSIF NOT triggered AND already_abnormal THEN
        -- A valid normal reading re-arms the rule.
        UPDATE public.iot_alert_rule_states
        SET is_abnormal = false,
            updated_at = pg_catalog.clock_timestamp()
        WHERE station_id = NEW.station_id
          AND alert_rule_id = r.id;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
