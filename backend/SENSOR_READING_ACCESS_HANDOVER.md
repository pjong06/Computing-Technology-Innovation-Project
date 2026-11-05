# Shared sensor-reading and alert read access

## 5 November requirement update (supersedes earlier read-only/Officer workflow wording)

All active Officer/Botanist/Researcher users may read dashboard summaries, readings, alerts/history and handle database alerts. Shared writes are limited to PATCH `/api/iot/alerts/:alertId/acknowledge` and `/resolve`. The latter accepts only optional `resolution_notes` (max 2000 characters); the former accepts an empty body. DB stamps the real actor/time and enforces open -> acknowledged -> resolved. Concurrent changes return 409. Other management paths/writes remain Officer-only. Photo reads are shared separately in PR #38; photo capture/retry remain Officer-only.

Migration `20261105021021_staff_iot_dashboard_alert_workflow.sql` is already applied. It adds station SELECT for Botanist/Researcher (for dashboard summaries), their alert UPDATE policy, a column-only notes grant and the transition trigger. It does not grant UPDATE on actor/time columns, general table UPDATE or DELETE. Existing audit logging remains active. Older evidence below reflects the previous requirement and must not be used as the current expected permission matrix.

Frontend owner: allow all three roles into IoT dashboard and display both lifecycle actions for them. Use database alert IDs from GET `/api/iot/alerts`, not in-memory `/alerts/live` IDs, for these PATCH endpoints. Read back status, actual actor/time and notes after each action. Website/mobile page files are not changed by this backend PR.

Updated 4 November 2026. Owner-authorized database migration applied:
`20261104133949_staff_read_sensor_readings_and_alerts.sql`.
Backend implementation is prepared for PR review. No deployment or PR merge
has been performed. Do not rerun the already applied database migration.

## Requested behavior

Active Botanist, Researcher and Officer accounts can GET:

- `/api/iot/readings/history` (Supabase history)
- `/api/iot/readings` (recent in-memory telemetry)
- `/api/iot/latest` (latest in-memory readings by station)
- `/api/iot/alerts` (stored alerts)
- `/api/iot/alerts/live` (in-memory alerts and counts)

Anonymous requests remain rejected by the existing server authentication mount.
The router also rejects visitors, legacy Admin and inactive profiles. All other
IoT paths remain Officer-only, including station summaries and future management routes.
This does not enable telemetry writes or ingestion credentials for staff clients.

## Backend changes

The server retains `requireAuth` and delegates path-specific authorization to
`src/middleware/iotAccess.js`, installed on the IoT router. It uses the verified
database profile populated by authentication, rather than client role claims.
Existing user-scoped Supabase queries and their limits/order remain unchanged.

## Database owner review

Preflight found RLS enabled and Officer-only SELECT policies on readings/alerts.
Existing authenticated SELECT grants were sufficient. The applied migration adds
active Botanist/Researcher SELECT policies to both tables. Station policies are
unchanged. `current_app_role()` reads the active database profile role.

`owner-review-sensor-reading-access.sql` records the two applied SELECT
policies, on sensor_readings and alerts, for Botanist and Researcher. It preserves
the existing Officer policies, including alert UPDATE, all other tables, grants
and write permissions. Do not rerun it: the canonical migration is already in
Supabase history and the matching file is under supabase/migrations.

Next validate direct user-scoped reads with actual active
Botanist, Researcher and Officer sessions and known existing reading/alert IDs.
Verify visitor/anonymous and suspended-account denial, and unchanged
write restrictions. Use rolled-back write probes or dedicated disposable data
if needed; never change existing readings merely to test permissions.

## Verification and release

Local router HTTP tests use controlled profiles/database responses; they do not
establish actual JWT, RLS or Render acceptance. Full suite: 248 PASS / 1 FAIL
(249 total). The failure is the existing signupApproval test asserting the
absence of frontend/signup.html; no signup files were modified here.

The targeted IoT suite has 11 passing tests, including five GET/HEAD read routes
for all three roles, denied POST/PUT/PATCH/DELETE for Botanist/Researcher,
unknown management route denial and inactive/unsupported profiles. Latest full
output: shared-reading-alert-access-20261104-tests.tap (248 PASS / the same one
signup failure). Historical sensor-read-access-tests.tap remains preserved.

Before backend release: review/merge/deploy the code,
and rerun genuine-account tests against the exact Render version. The frontend
owner must expose reading/alert viewing to Botanist/Researcher. No frontend or
mobile file was edited. The existing Officer-only page guard may still block
navigation until its owner integrates the revised permission.

Historical Officer-only test results describe the previous policy and must be
retained. Add new dated evidence rather than rewriting them as failed tests.

The separate security live runner defaults to shared readings AND alerts.
`--iot-policy=officer-only` selects the old baseline; the older
`--readings-policy=officer-only` remains an alias. Offline runner self-checks:
18 PASS. Updated to main 7c039a3 before PR preparation. Latest full regression:
245 PASS / 4 FAIL (249 tests). The same four failures already occur in main CI
run 41791456164: two C15 photo tests, plant-photo retry and signup-page absence.
Those modules are not changed by this PR. No frontend/mobile edits are included.
Database-only
actual-session mode is available via `npm run test:security:live -- --database-only`
in backend; it verifies Supabase without invoking the
not-yet-deployed role changes. Normal full mode waits until backend deployment.

Post-migration catalog checks confirm all old policies, table/column grants,
RLS settings and role helper are unchanged. SQL role/claims recheck: 71 PASS,
including five zero-row alert UPDATE probes, all rolled back. Initial six
grant-expectation failures are preserved: authenticated already held UPDATE on
alert_status before this change; RLS still limits actual updates to Officer.
Actual-session database acceptance subsequently completed at 21:49 MYT:
27 PASS / 0 FAIL / 0 BLOCKED, shared-readings-and-alerts contract, in
Steven-Sprint2-Security/backend/sec77-deployed-1793800119819-results.json.
Backend API routes were excluded from that database-only run; deploy the local
guard before running combined API/RLS acceptance.

Transport tests require the public firmware CA header. The runner checks the
repository firmware path and the existing local IoT checkout; on another machine
set SEC77_MQTT_CA_FILE to that public header if needed. No private firmware
secrets header is read by this test runner.
