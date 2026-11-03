-- Nullable fields preserve historical readings; existing RLS/alert trigger unchanged.
ALTER TABLE public.sensor_readings
 ADD COLUMN soil_raw integer CHECK (soil_raw BETWEEN 0 AND 4095),
 ADD COLUMN soil_moisture_pct numeric CHECK (soil_moisture_pct BETWEEN 0 AND 100),
 ADD COLUMN distance_cm numeric CHECK (distance_cm BETWEEN 0 AND 1000),
 ADD COLUMN distance_valid boolean,
 ADD COLUMN rain_raw integer CHECK (rain_raw BETWEEN 0 AND 4095),
 ADD COLUMN rain_intensity_pct numeric CHECK (rain_intensity_pct BETWEEN 0 AND 100),
 ADD COLUMN dht_valid boolean,
 ADD COLUMN sequence bigint CHECK (sequence BETWEEN 0 AND 9007199254740991),
 ADD COLUMN uptime_ms bigint CHECK (uptime_ms BETWEEN 0 AND 9007199254740991);
GRANT INSERT (soil_raw,soil_moisture_pct,distance_cm,distance_valid,rain_raw,rain_intensity_pct,dht_valid,sequence,uptime_ms)
 ON public.sensor_readings TO service_role;
