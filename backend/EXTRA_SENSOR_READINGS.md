# Persist all current firmware telemetry fields

User requested persistence of additional ESP32 readings. Live migration `20261103154012_persist_additional_sensor_readings.sql` applied successfully, then independently verified: nine nullable columns with range checks. Old rows remain null; no invented sensor backfill. Existing policies and alert rules/trigger unchanged. Necessary new-column INSERT grants added only to service_role, consistent with current ingestion credential; this does not make that broad credential least privilege.

Ingestion now maps soil_raw/soil_moisture_pct, distance_cm/distance_valid, rain_raw/rain_intensity_pct, dht_valid, sequence, uptime_ms. Invalid distance is null, preserving false validity flag; invalid DHT temperature/humidity remain null. History API returns these fields under its existing role/RLS protection. Vibration/battery fields are not repurposed. Sequence/uptime alone do not provide deduplication across device boots. Recorded time remains server time.

207/207 local backend tests passed including all mappings and invalid-sensor null behavior. Live database structure verified; no new full-sensor live reading claimed before deployment. Merge code and deploy before expecting populated new columns; the current old backend leaves them null. Physical sensors not connected/calibrated may produce unreliable raw readings, so storage does not establish calibration or sensor validity beyond DHT/distance flags.

No firmware change or new sensor alert rules included. Existing historical test evidence is preserved. Next: compare a fresh ESP32 serial payload's sequence/uptime and sensor values with a new database row after deployment.
