-- Store stationary GPS locations for IoT sensor stations.
ALTER TABLE public.sensor_stations
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS location_note text;

-- Validate latitude and longitude values.
ALTER TABLE public.sensor_stations
  ADD CONSTRAINT sensor_stations_location_range_check
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (
      latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
    )
  );

-- Limit location note length.
ALTER TABLE public.sensor_stations
  ADD CONSTRAINT sensor_stations_location_note_length_check
  CHECK (
    location_note IS NULL
    OR char_length(location_note) <= 500
  );