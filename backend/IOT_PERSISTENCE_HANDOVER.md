# Activity 5.1 deployment

After merge and deployment, configure Render environment variables: IOT_INGESTION_SERVER_ENABLED=true, IOT_PERSISTENCE_ENABLED=true, IOT_INGESTION_URL=https://niah-backend.onrender.com/api/ingestion/telemetry. Set IOT_INGESTION_TOKEN to a cryptographically random value of at least 32 characters, IOT_INGESTION_STATION_CODE to an active registered station (test code steven-sprint2-test-01), and IOT_DATABASE_SERVER_KEY to the owner-approved backend credential. Supabase public configuration and MQTT broker URL/credentials are also required. Never publish values in chat/Git.

POST ingestion validates the dedicated token, legacy telemetry payload and active station; insert returns reading_id. Server endpoint disabled by default. Database alert trigger remains the only database alert-generation path. API body limit 16 KiB; sender requires HTTPS, rejects redirects and times out after 10 seconds. Failed persistence is not reported as success and does not update the live cache.

Secret/service_role keys bypass RLS and retain broad privileges. The restricted endpoint does not narrow those credentials. No database grants or migrations changed; use the previously approved temporary column grants. Long-term dedicated role/RPC remains pending.

Stored: resolved station UUID, server receipt time in recorded_at/received_at, valid DHT temperature/humidity, motion. Soil/distance/rain are validated legacy fields but not stored because current schema lacks them. Sequence/uptime also not stored. No deduplication, durable retry, device-time preservation or topic-to-device binding is claimed. Multiple subscribers can duplicate readings; broker ACL and instance strategy need owner review. Existing in-memory alert display is separate from database trigger alerts.

Final acceptance still requires deploying this exact revision, configured broker and ingestion credentials, labelled MQTT sample/database alert readback, restart and role-read checks. No physical ESP32 or deployed acceptance is established by unit tests. Confirm test station and enabled alert rule still exist before the live test.
