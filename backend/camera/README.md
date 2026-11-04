# Laptop camera and private alert evidence

Camera is disabled in the normal backend. Render serves authenticated metadata and short-lived links; the laptop process alone operates its webcam. No frontend/mobile code is included.

## Architecture and rules

Synthetic MQTT -> existing HTTPS ingestion -> sensor_readings -> existing generate_sensor_alerts trigger -> laptop camera -> private camera-evidence bucket -> alert_camera_evidence.

The combined database metric `movement_nearby_cm` evaluates distance only when PIR movement and distance_valid are true. Its <=100 cm high-severity prototype rule is enabled only for `steven-sprint2-test-01`; field values require team calibration. Existing temperature rules remain unchanged. The adapter filters the metric suffix so a temperature alert cannot substitute for the movement alert. There is no database alert deduplication/hysteresis in this change.

The two included migrations are already applied to Niah Biotrack (versions 20261104160421 and 20261104165102). Do not rerun them manually on that project. They preserve existing buckets and RLS policies; the added server read privileges are restricted to columns actually queried. Service-role credentials still bypass RLS; they are trusted backend credentials, not a dedicated least-privilege ingestion identity.

## Laptop setup

Create an ignored `.camera-runtime` Python environment under backend and install the pinned `camera/requirements.txt`. Copy `camera/camera.env.example` to ignored `backend/camera.local.env`. Keep existing MQTT TLS, Supabase public configuration, HTTPS ingestion URL/token and any camera writer credential in local ignored configuration only. The cloud uploader uses CAMERA_DATABASE_SERVER_KEY; the API uses the Officer's user-scoped Supabase client instead.

`npm run camera:start` explicitly enables the webcam service. It requires CAMERA_MQTT_TOPIC_FILTER matching `niah/camera-test/<name>`. Configure a simulated sender to publish on that same dedicated topic. Normal startup (`npm start`) does not enable camera capture. On Windows, close this process to stop capture; no always-running agent is installed.

Do not run another ingesting subscriber against the same telemetry topic. The prototype does not correlate a laptop event to a previously inserted Render reading or provide ingestion idempotency. Dedicated test topics avoid duplicate inserts. Continuous real-device capture alongside Render needs that single-ingester/correlation design before field use.

CAMERA_STORAGE_ENABLED=false keeps images local. Cloud mode requires true, the private resources, the server credential and successful persistence of the triggering reading. Images are JPEG only, <=5 MiB. PIR true plus valid distance 0..CAMERA_DISTANCE_CM (default 100) and a matching active local threat alert are required. Per-station photo cooldown defaults to 30 seconds. Duplicate/cooldown records persist across normal process restart; local capacity is 1000 records and there is no automatic retention/deletion or disk encryption. Local `.camera-evidence` and runtime/config files are ignored by Git.

## Officer APIs after integration/deployment

All paths start `/api/iot`; require the normal Bearer JWT and an active Officer profile. Botanist/Researcher readings/alerts permissions do not extend to photos.

| Method/path | Purpose |
| --- | --- |
| GET /alerts/:alertId/camera/cloud | At most 100 newest cloud metadata rows; does not touch a webcam |
| GET /alerts/:alertId/camera/:evidenceId/url | User-scoped metadata lookup and 60-second signed URL |
| GET /camera/status | Local service status |
| GET /alerts/:alertId/camera | Local laptop manifests |
| POST /alerts/:alertId/camera/capture | Local capture; cannot bypass gates/cooldown |
| GET /alerts/:alertId/camera/:evidenceId/image | Local authenticated bytes |
| POST /alerts/:alertId/camera/:evidenceId/retry | Retry a local pending cloud upload |

Dashboard integration uses the cloud list, then the URL endpoint; show empty/error states and refresh expired links. Signed URLs are bearer links until expiry and must not be logged/persisted. Local endpoints are for the laptop host; the hosted backend does not control it.

## Tests and acceptance

- `npm run test:camera`: controlled dependency and loopback HTTP regressions.
- `node camera/verify-local-trigger.cjs --capture`: explicit one-photo local-only sensor-gate test.
- `node camera/verify-mqtt-cloud.cjs --capture-and-upload`: isolated real MQTT/HTTPS/DB/webcam/upload test; creates disposable fixtures requiring exact-ID cleanup after testing. This requires the runtime and ignored configuration.
- `npm run test:camera:live -- --local-api`: real JWTs and live RLS/bytes through the local camera router. Prefilled Officer/Botanist/Researcher emails, hidden Windows password input, one login per account, no password/token/URL output. Uses only a public key.
- `npm run test:camera:live`: same checks against Render after deployment. It never uploads or activates a camera. It needs the retained synthetic 631-byte access fixture specified in the runner; if cleaned up, replace those fixture IDs using a new approved disposable fixture before retesting. It waits 65 seconds for fixed-TTL expiry and requires an expiry-specific denial response.

Synthetic live MQTT/DB/webcam/cloud acceptance passed on 5 November 2026 MYT; its four readings, one alert, metadata and uploaded photo were removed and absence independently verified. Real sensors and dashboard acceptance remain separate. Real-account and deployed acceptance must be recorded as pending until the live runner passes; unit tests do not substitute for them.

Base main c712f549f6086371ce23917190243f88c7650db6 already has six failing backend tests (three plant photo cases, signup-page assertion, Botanist/Researcher website mutation assertions). Main CI run 41871473506 reports 241 PASS / 6 FAIL; initial camera branch run reports 252 PASS / the same 6 FAIL. These failures are retained, not skipped or fixed by changing teammate modules.
