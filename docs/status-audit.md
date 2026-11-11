# Niah BioTrack: status audit

Date: 2026-11-10. Branch `main` at `46e8fec`, level with `origin/main`, clean working tree.
Read-only audit. Nothing was changed apart from creating this file.

**How to read this.**
- **Done** means implemented *and* reachable in the UI.
- **Partial** means it works but something stated is missing.
- **Can't tell from code** means it depends on database settings made in the Supabase dashboard, which the repo doesn't contain.
- Paths are relative to the repo root: `app/` and `src/` mean `niah-biotrack/app/` and `niah-biotrack/src/`.

---

## A. Botanist (mobile)

| Item | Status | Evidence | What's missing |
|---|---|---|---|
| Register a plant on site | Done | `app/new-record.tsx:354-480` builds the record, saves it with `addRecord` (445-447), then goes to save-confirm (467). Reached from Home "Register plant" (`app/(tabs)/home.tsx:239`) and the My plants empty state (`app/(tabs)/records.tsx:120`) | — |
| Taxonomy + morphology (height, diameter, health, life stage) | Partial | new-record: species picker (`new-record.tsx:622`; family from the catalogue, 424), height (640), diameter (652), life stage (665-682), health (684-704). add-observation: height (`app/add-observation.tsx:513`), DBH (565), life stage (616), health (642) | Height is in **metres** in new-record but **cm** in add-observation. Genus/family come only from the chosen catalogue entry and can't be entered. |
| Photos: camera + gallery | Done | new-record "Take Photo / Choose from Gallery" (`new-record.tsx:275-279`); add-observation buttons (`add-observation.tsx:748, 759`), at least 1 photo (300) | — |
| Record GPS | Done (plant) / Partial (visit) | Plant GPS is automatic with Retry and required to save (`new-record.tsx:207-252, 386`). Visit GPS (`add-observation.tsx:182-238, 356-358`), sent in the sync payload (`src/services/offlineRecordRepository.ts:216-218`) | A visit can be saved without GPS. |
| Offline save | Done | SQLite `local_entities` + `sync_outbox` (`src/services/offlineDatabase.ts:109, 127, 153`); loaded at start (`app/_layout.tsx:~51-57`) | Species proposals are kept in AsyncStorage (`src/store/useProposalStore.ts:191`), not in the outbox. |
| Sync to central DB with retry | Partial | `src/services/syncEngine.ts` sends to `POST /api/sync/push` (`backend/src/routes/sync.js:251`). Auto-sync on start, reconnect, return to foreground and sign-in (`src/services/autoSync.ts:36-100`). Manual "Sync now" on Home (`home.tsx:76-80`) and Profile | No timed retry or backoff while staying online. A batch stops at the first failure or conflict. **Auto-sync doesn't send species proposals** (only Home "Sync now" does). |
| Generate / attach QR tag | Done | `app/attach-tag.tsx:214-371` calls `POST /api/plants/:id/attach-tag` (`backend/src/routes/plants.js:897`); offline, a pre-printed tag can be scanned or typed (378-431). Show QR at `app/plant-detail.tsx:180-217, 657` | Server tag + QR only work after the plant has synced. |
| Scan QR | Done | `app/(tabs)/scan.tsx:113-120` (camera), lookup at 61-74 | — |
| Enter tag code manually | Done | `app/manual-qr.tsx:29-71`, reached from Scan "Manual Tag Lookup" (`scan.tsx:165`) | — |
| Add observation to an existing plant (incl. not on this phone) | Partial | `src/services/tagLookup.ts:48-131` checks the phone, then `GET /api/plants/tag/:tagCode`, then saves the plant locally with `cacheServerRecord` (114). Reached from plant-detail, Scan or manual-qr | Needs signal the first time. The saved copy has no coordinates, photos or earlier visits (`tagLookup.ts:74-113`). |
| See review result + rejection reason | Done | `refreshReviewStatuses` (`src/store/useRecordStore.ts:2445-2499`) calls `GET /api/observations/review-status`; runs on Home focus and after sync. Reason shown in My plants (`records.tsx:156-165`) and plant-detail "Officer's comment" (`plant-detail.tsx:489-505`, with Resubmit) | — |
| Propose species | Done | `app/propose-species.tsx:60-129` → `POST /api/knowledge/species/proposals`; status and comment shown on the Species tab (`app/(tabs)/species.tsx:100-130`) | Not retried by auto-sync (see Sync). |
| Trace transect route | **Not done** (UI only) | `app/record-route.tsx` shows the live trail, distance and waypoints (125-267) | **"Save & Exit" only shows a toast and the route is thrown away** (`record-route.tsx:287-309`); `saveRoute` has no callers. "Log Tree" passes GPS to `/new-record`, which ignores it. `app/link-route.tsx` can't be reached and shows **hard-coded fallback values** (`link-route.tsx:19-21`: `640` m, `3.2251° N, 113.7644° E`). No backend route for routes. |
| Offline map | Partial | `app/offline-map.tsx` uses GPS + compass to give distance and bearing to one plant (45-104); reached from plant-detail "Navigate" (`plant-detail.tsx:646-650`) | There is **no map at all** (no map library, no cached tiles). It works offline only because it needs no network. |
| AI identification (Pl@ntNet) | Done (online) | new-record "Identify species with AI" (`new-record.tsx:288-339, 549-614`) → `src/services/identifyPlant.ts:153` → `POST /api/identify` (`backend/src/routes/identify.js:158`) → Pl@ntNet (`backend/src/services/plantAiService.js:171`) | Online only; not in add-observation. **The backend route has no login** (see D). |

## B. Visitor (mobile)

| Item | Status | Evidence | What's missing |
|---|---|---|---|
| Guest mode | Done | "Explore without an account" (`app/index.tsx:206-216`) → `setVisitorMode` (`src/context/AuthRoleContext.tsx:107-113`); survives a restart (53-58) | The login screen still says "Accounts are created by Sarawak Forestry Corporation." (`index.tsx:220`) next to the Sign up link. |
| Sign up | Done | `app/sign-up.tsx:91-94` (`source: 'app'`); the database trigger makes an active visitor (`supabase/migrations/20261107090000_visitor_accounts.sql:33-49`) | Email confirmation depends on Supabase project settings. |
| Plants guide | Done | Plants tab, visitors only (`app/(tabs)/_layout.tsx:42-51`); `app/(tabs)/plants.tsx` → `/plant-info?speciesId=`; data from the public `GET /api/knowledge/species` (approved only) | Lists species, not individual plants. |
| Public plant page via QR | Done | Visitor scan → `lookupPublicTag` (`tagLookup.ts:188-215`) → `GET /api/public/plants/by-qr` (`backend/src/server.js:127-160`) → `app/plant-info.tsx`. Web fallback page `GET /p/:tag` (`backend/src/routes/publicPlants.js:67-96`) | — |
| Rare species location hidden | Done (by rule) | DB function returns location only for `conservation_status = 'LC'` (`supabase/migrations/20261016062147_officer_review_and_public_qr.sql:56-57`); repeated in `backend/src/middleware/publicQrProtection.js:78-80`; the app never shows location (`plant-info.tsx:19`) | For **LC** plants the public JSON includes exact latitude/longitude. Decide whether even LC coordinates should stay private. |
| Pending plants not public | Done | DB function requires approved plant + approved species + an approved, non-deleted visit (`…officer_review_and_public_qr.sql:~99-108`); both public routes return 404 otherwise | — |

## C. Officer (web)

The officer menu is at `frontend/js/shared.js:881-890`. Botanists may open only species, editor and map (`shared.js:832-845`).

| Item | Status | Evidence | What's missing |
|---|---|---|---|
| Add / edit / archive species | Done | `frontend/js/editor.js:216-218` → `POST`/`PATCH /api/knowledge/species` (`backend/src/routes/knowledge.js:550, 631`); archive `species.js:184` → `DELETE` (`knowledge.js:730`) | No "unarchive". |
| Upload species photos | Done | `editor.js:169-176` → `POST /species/:id/photos` + `PATCH …/primary` (`knowledge.js:755, 850`) | One photo per save; no remove-photo UI (the route exists at `knowledge.js:888`); only for approved species. |
| Approval queue approve/reject with reason | Done | `queue.js:158, 187` → `POST /api/officer/reviews/:id/decision` (`officerReviews.js:319`); rejected list on its own page (`rejected.js:74`) | Reason typed in a browser `prompt()`. |
| Species proposals review | Done | `species.js:340` → `/species/proposals/pending` (`knowledge.js:306`); review with required reason → `knowledge.js:345` | — |
| Search + filter by scientific/common name | Done | `species.html:142-144`, matched in the browser on scientific, common and local name (`species.js:147-160`); map filters (`map.js:100-110`) | No search on queue, rejected or users pages. |
| Distribution map | Done (officer) / broken (botanist) | Leaflet (`frontend/map.html:8, 46`) → `GET /api/officer/map/plants` (`backend/src/routes/officerMap.js:6-8`) | **Botanists see the menu item but get a 403** (`shared.js:832-836` vs `officerMap.js:6`). Leaflet loads from a CDN. |
| Reports + CSV + PDF | Done | `reports.js:37, 47` → `/api/reports/:type` and `/summary` (officer-only); CSV in the browser (`reports.js:153-168`), PDF via `frontend/js/pdf.js` (`reports.js:174-195`) | The backend's own CSV/PDF output (`backend/src/routes/reports.js:23-52`) is unused duplicate code. |
| User admin (activate pending accounts) | Partial / Can't tell from code | Activate/Suspend/Reactivate (`users.js:104-112, 211-223`); status from `profiles` (14-29); saved through `/api/web-data/users` (officer check `webData.js:11`); trigger copies to `profiles` (`20261105090000_signup_pending_approval.sql:62-84`) | Both risks below come from the repo's migrations (the live database may differ). |
| IoT dashboard + alerts | Done (officer) | `alerts.js:4313-4332` → `/api/iot/summary`, `/readings/history`, `/alerts`; acknowledge/resolve/delete (`alerts.js:2324, 2404-2415` → `iotAlertActions.js:199-221`) | Officer-only in the menu, although the backend lets botanists and researchers read it. |

The two User admin risks:
- **"Delete" doesn't lock the account out.** The profile-sync trigger fires only on INSERT/UPDATE (`20261101085959_…sql:113`), so deleting a row leaves the profile active.
- **The only `website_users` rule allows role 'admin'** (`20261101085959_…sql:83-85`), but 'admin' is no longer an allowed role (`20261107090000_visitor_accounts.sql:24-26`). If the live database matches the repo, officers can't read or change users. Check in Supabase.

## D. Security

| Item | Status | Evidence | What's missing |
|---|---|---|---|
| Login for all roles | Done | Mobile: one email/password login for every role (`app/index.tsx:79`); a staff ID is turned into an email by an **unauthenticated** `profiles` lookup (`index.tsx:66-72`). Web: `frontend/js/login.js:39-75` refuses non-staff. Backend: `requireAuth` = active staff, `requireAccount` = staff + visitor (`backend/src/middleware/auth.js:7-83`) | The staff-ID lookup only works if anonymous users can read `profiles` by `staff_id`, which would let anyone turn staff IDs into emails. Can't tell from code. Admin can log in but has no admin-only route. |
| RBAC on every route | Partial | Every route checked (mounts in `backend/src/server.js`). Staff routes all use `requireAuth` + `requireRole`. Intended public routes: `/api/public/plants/by-qr`, `/p/:tag`, the public knowledge reads, health checks, `/portal` static files, password recovery (`backend/src/routes/auth.js:87, 119`, rate-limited), and IoT ingestion (device token, `iotIngestion.js:12-37`) | **`POST /api/identify` has no login or role check** (`server.js:48`, `identify.js:158`). Anyone can use up the Pl@ntNet quota; only a global cap of 2 at a time (`identify.js:13-38`). `/api/web-data/users` checks for officer inside the handler instead of in middleware (OK, but inconsistent). |
| RLS on every table | Can't tell from code (mostly) | RLS is enabled in migrations for: `species`, `taxonomy`, `species_media`, `tag_reservation_batches`, `tag_reservations`, `sync_events`, `alert_camera_evidence`; the view `plant_map_points` is `security_invoker` | Never enabled in migrations (made in the dashboard): `profiles`, `plants`, `observations`, `plant_media`, `observation_media`, `audit_logs`, `sensor_readings`, `sensor_stations`, `alerts`, `alert_rules`, `website_*`, `web_data`, **`observation_reviews`** (not in any migration). Policies exist for most, which suggests RLS is on, but the repo can't prove it. |
| Encryption in transit | Done | Supabase and Render over HTTPS; MQTT `mqtts://8883` with certificate check (`backend/src/services/mqttIngestionService.js:23`) and a pinned CA in the firmware; Pl@ntNet over HTTPS; `http://` only for localhost | No HSTS/helmet; relies on Render/Cloudflare TLS. |
| Encryption at rest (server) | Can't tell from code | Supabase's disk encryption isn't visible in the repo. Buckets `species-media` and `camera-evidence` are private with 60 s signed links (`knowledge_api_setup.sql:177-182`); `observation-media` and `plant-media` were made in the dashboard | — |
| Encryption at rest (phone) | **Not done** | Login session in plain **AsyncStorage** (`src/lib/supabase.ts:18`); SQLite **not encrypted** (`offlineDatabase.ts:109`); photos are plain files (`src/utils/photoStorage.ts:7`) | No `expo-secure-store`, no SQLCipher. |
| Rate limiting | Partial | QR JSON route 60/min per IP (`publicQrProtection.js:39-70`); `/p/:tag` per IP; password recovery 20/IP + 3/email per 10 min (`auth.js:17-31`); `app.set('trust proxy', 3)` (`server.js:12`) | Nothing on `/api/identify` per IP. Limits live in memory (reset when Render restarts). Login relies on Supabase's own limits. |
| Secrets not in code | Done | Only `.env.example` files are tracked; no service-role key, JWT, Pl@ntNet key or MQTT password in tracked files. `frontend/js/shared.js:7` holds the **publishable** Supabase key (meant to be public) | `niah-biotrack/.gitignore` covers `.env*.local` but **not a plain `.env`**. |
| SSDLC evidence | Partial | CI: `.github/workflows/backend-tests.yml` (tests only); `.github/CODEOWNERS`; security notes `backend/SECURITY_REMEDIATION.md`, `backend/SECURITY_AUTH_HANDOVER.md`, `docs/codebase-review.md`; security tests (`backend/test/auth.security.test.js`, `identifyUploadSecurity.test.js`) and result files (`backend/security-results/verification.json`) | **No `sonar-project.properties` or Sonar workflow, no ZAP reports, no CodeQL/Dependabot, no `SECURITY.md` or threat model**, no saved `npm audit` output. |

## E. IoT

| Item | Status | Evidence | What's missing |
|---|---|---|---|
| Readings ingested + stored | Partial | MQTT starts only if `MQTT_URL` is set (`mqttIngestionService.js:10-14`). Saving needs `IOT_PERSISTENCE_ENABLED=true` (`backend/src/services/telemetryPersistence.js:6`) **and** `IOT_INGESTION_SERVER_ENABLED=true` on `/api/ingestion/telemetry` (`iotIngestion.js:15, 29`), which inserts into `sensor_readings` (43-61) | Off by default (memory only); three env settings needed; one station code only. |
| Thresholds | Partial | In memory: `backend/src/config/iotThreatConfig.js:1-6` (35 °C, soil 20 %, proximity 50 cm, rain 70 %; can be changed with env variables). Database: `alert_rules` + trigger (`20261104165102_camera_movement_proximity_alert.sql:4-31`) | Two sets that don't agree; only one database rule is seeded (movement for one test station); no UI to edit. |
| Automated alerts | Partial | Trigger on `sensor_readings` inserts into `alerts` (`…camera_movement_proximity_alert.sql:11`); live alerts in memory from `threatDetectionService.js:24-90` (`/api/iot/alerts/live`) | Saved alerts only when storage is on and a rule matches; temperature, soil and rain alerts are never saved. |
| Dashboard | Partial | Web `frontend/alerts.html` + `alerts.js` (officer) | No mobile view. |
| Sensor location | Not done | `/api/iot/summary` selects only `id, station_code, station_status, last_seen_at` (`backend/src/routes/iot.js:290-300`) | No coordinates stored, selected or shown; sensors aren't on the map. |
| Ecological data history | Partial | `GET /api/iot/readings/history` (`iot.js:235-254`) returns the latest 100 rows (`backend/src/services/recentIotQuery.js:5-6`); charted in `alerts.js:4359-4380` | No date range, station filter or paging; empty when storage is off. |

## F. Planned redesign: current state

| Item | Current state | Evidence |
|---|---|---|
| Tabs Home / Plants / Scan / My submissions / Profile | Different today. Staff: Home / Species / Scan / **My plants** / Profile. Visitors: Home / Plants (guide) / Scan / Profile | `app/(tabs)/_layout.tsx:23-79` |
| Plants grouped by species with count | Not done | `records.tsx:33-104` counts by sync status only |
| Upload QR from gallery | Not done | `scan.tsx:60` camera only; no `scanFromURLAsync` |
| Logout warning when unsynced records | Done (Profile) | `app/(tabs)/profile.tsx:320-372` "Log out with unsynced data?". **Bug:** `logout()` doesn't wait for the async `clearAllData()` (`AuthRoleContext.tsx:120`) |
| "Last synced" + waiting count | Done | Profile "Last successful sync" + "N Queued" (`profile.tsx:757-758, 895-909`); Home pending banner (`home.tsx:180-190`) |
| Nearby-duplicate warning | Not done | Only `client_record_id` de-duplication (`backend/src/routes/plants.js:330-343`); `src/utils/geo.ts:10` `distanceMeters` exists but is only used by offline-map |
| Similar-species check when proposing | Done | `propose-species.tsx:31-41, 89-104`; server rejects duplicates in any letter case (`knowledge.js:250-265`) |
| "Being verified" public page for pending plants | Not done | Pending looks the same as unknown: "isn't available yet" (`tagLookup.ts:224-228`, `publicPlants.js:90`) |
| Optional location note per plant | Partial | The note exists but is **required** (`new-record.tsx:385`, "Enter a location landmark."); sent as `location_description` (`offlineRecordRepository.ts`, `plantPayload`) |

## G. Quality

| Item | Result |
|---|---|
| Backend tests | `npm test`: 399 tests in 34 files, **399 pass, 0 fail** (Node 26.8.1). |
| Coverage, no new packages | Yes, with Node's built-in `node --test --experimental-test-coverage test/*.test.js`. **Lines 78.35 %, branches 77.71 %, functions 91.88 %**, counting only files the tests load. Lowest: `routes/reports.js` 50 %, `middleware/auth.js` 47.7 %, `routes/officerReviews.js` 55.8 %, `routes/iotAlertActions.js` 58.1 %, `routes/iot.js` 65.8 %, `routes/identify.js` 68.4 %. `server.js`, `services/mqttIngestionService.js` and `services/plantAiService.js` are never loaded by tests, so they aren't in the figure. |
| `npx tsc --noEmit` (niah-biotrack) | **No errors.** |
| TODO / FIXME | `src/utils/tagCode.ts:4-12`: four stale "TODO 1-4" step comments (the code is finished). `src/store/useProposalStore.ts:28`: real TODO, proposals have no photos. |
| console.log of sensitive data | None found. `backend/src/middleware/publicQrProtection.js:5-36` logs only salted hashes of IPs, and only when `QR_IP_DEBUG=true`; it is temporary diagnostic code that should be removed. |
| Hard-coded test data | `app/link-route.tsx:19-21` (made-up distance and GPS fallback). `frontend/js/shared.js:189` hard-codes a personal Gmail address as the officer contact. No sample plants or species anywhere else. |

## H. Repo hygiene

**Remote branches not merged into `origin/main`:**

| Branch | Ahead / behind | What it would change |
|---|---|---|
| `george/web-redesign-v2` | 13 / 0 | 57 files, +2,928 / −4,978. **It undoes a lot of recent work:**<br>• brings back `website_species` / `website_observations` and `/api/web-data` for the catalogue and queue;<br>• deletes `officerMap.js`, two migrations (`20261111090000_plant_map_points_view.sql`, "allow visits on approved readable plants") and the `officerMap`, `publicQrProtection`, `reports`, `identifyUploadSecurity` and `plantTagUpdate` tests;<br>• rewrites `new-record.tsx`, `add-observation.tsx` and the record store.<br>**Don't merge as is**; pick the design changes by hand. |
| `fix/website-database-access` | 4 / 214 | Adds `docs/WEBSITE_DATABASE_SECURITY.md` and `supabase/tests/website_access_smoke.sql`. Its two migrations already exist on main. The doc and smoke test could be copied; otherwise close it. |
| `feat/self-service-password-recovery` | 1 / 228 | Older password recovery (`backend/src/routes/auth.js`, `forgot-password.tsx`, `change-password.tsx`). Main already has OTP recovery. Close it. |
| `chore/remove-rimba` | 2 / 354 | Untracks `node_modules` and the old app; main already did this. Close it. |
| `feat/tag-reservation-workflow` (remote) | merged (#41) | Can be deleted. |

**Files that look unused:**
- `backend/src/middleware/errorHandler.js` and `backend/src/services/plantService.js`: empty files, never required.
- `backend/src/middleware/authenticate.js`: 2-line alias, never required.
- `niah-biotrack/src/config/api.ts`: never imported (`client.ts` and `identifyPlant.ts` read `EXPO_PUBLIC_API_BASE_URL` themselves).
- `niah-biotrack/src/services/recordMapper.ts`: never imported.
- Screens nothing navigates to:
  - `app/link-route.tsx`;
  - `app/change-password.tsx` (no link from Profile);
  - `app/species-reference/index.tsx` (the Species tab goes straight to `[id]`).
- Backend reports duplicate the browser's CSV/PDF export (`backend/src/routes/reports.js:23-52`).
- Run outputs committed at `backend/` root:
  - `*-results.json` files;
  - `qr-results/`, `security-results/`, `benchmark-results/`;
  - `test-*.cjs` scripts.

  Fine as evidence, but better kept in one `evidence/` folder.

---

## Priorities

### 1. Breaks the demo
(Demo: botanist registers a plant offline → officer approves on the web → botanist sees Approved → visitor scans the QR.)
1. **Don't merge `george/web-redesign-v2`.** It would bring back the old website tables, remove the officer map and drop security tests.
2. **Check `website_users` in Supabase.** The repo's only rule allows the 'admin' role, which no account can have now. If the live database matches, User admin can't load or activate accounts (a newly signed-up botanist couldn't be activated).
3. **Run the latest migrations on Supabase** (`20261111090000_plant_map_points_view.sql` and the "allow visits on approved readable plants" one) if they haven't been: the officer map and new visits on approved plants need them.
4. **Transect route** (`record-route.tsx` "Save & Exit") tells the user it was saved when it was thrown away. Don't show it in the demo until it's fixed.
5. **`logout()` doesn't wait for `clearAllData()`** (`AuthRoleContext.tsx:120`). If you switch accounts on one phone during the demo, records could briefly leak to the next user.
6. **The botanist web menu shows "Distribution map"** and then a 403.

### 2. Required by the project scope but missing
1. **Phone data is unencrypted:** move the session to `expo-secure-store` and decide on SQLCipher for the SQLite outbox.
2. **`POST /api/identify` has no login:** require auth (and a per-IP limit).
3. **Transect routes:** keep (`saveRoute`), link to plants, and upload.
4. **Offline map:** today it's a compass and distance only, with no map tiles.
5. **IoT:**
   - storage and saved alerts are off by default;
   - the two threshold sets disagree;
   - no sensor location;
   - history is the last 100 readings only.
6. **User admin "Delete"** doesn't suspend the profile (no DELETE trigger).
7. **SSDLC evidence:**
   - add `sonar-project.properties` or a Sonar CI step;
   - commit ZAP scan reports;
   - add `SECURITY.md` / a threat model and an `npm audit` record.
8. **RLS proof:** add `ENABLE ROW LEVEL SECURITY` migrations (or an export of the live policies) for the tables made in the dashboard, including `observation_reviews`.
9. **Auto-sync doesn't send species proposals.**
10. **Height units differ:** metres when registering a plant, cm when adding a visit.

### 3. Nice to have
1. Remove the `QR_IP_DEBUG` logging.
2. Delete the stale TODO comments.
3. Delete the unused files and screens listed in H.
4. Fix the "Accounts are created by Sarawak Forestry Corporation." wording.
5. Use the backend's `q` search, and add search to the queue and users pages.
6. Species: unarchive, plus remove-photo UI.
7. Redesign items:
   - My submissions tab;
   - species grouping with counts;
   - QR from a gallery image;
   - nearby-duplicate warning;
   - "being verified" page;
   - optional location note.
8. Decide whether LC plants' coordinates should be public.
9. Add `.env` to `niah-biotrack/.gitignore`.
10. Close the stale branches.
