# Plan: trace route (transect) — minimum version

**Status: Planned (future work). Not implemented as of 18 Nov 2026.**

Nothing has been changed in code or the database. Decisions were recorded on 18 Nov 2026 (see "Decisions" at the end).

## Goal

A botanist walks a transect with the phone, with or without signal. The route is kept safely on the phone, uploads when there is a connection, and the conservation officer sees it as a line on the Distribution map.

**Minimum version:** record offline → save on the phone → sync → officer sees route lines on the map.

**Ground rules:**
- The existing plant/visit sync is not changed. Routes get their own sync path.
- No row-level security (RLS) or role check is loosened.
- No new npm packages. One approved exception: `expo-keep-awake` (decision 6), added with `npx expo install expo-keep-awake` when this is implemented.
- No migration is run by the developer. Phoebe runs the SQL.

---

## 1. What `main` does today

`origin/fix/trace-route` was merged into `main` as PR #105 (16 Nov 2026). Its last commit `fabb006` is already in `main`, and `main` is now 55 commits ahead, so the branch has nothing left to merge.

| Step | On `main` today | Where |
|---|---|---|
| **Recording** | Works only while the app is open on screen. GPS reading every 2 s or 2 m (`BestForNavigation`). Points worse than ±50 m are dropped. Live distance, duration, waypoints and a path preview are shown. No background tracking. | `niah-biotrack/app/record-route.tsx` |
| **Saving on the phone** | On **Finish**, `saveRoute()` stores the route in the store's persisted state (AsyncStorage key `niah-ground-truth-store`, store version 9), not in SQLite. The route holds its GPS points, waypoints, distance, duration and end point. | `niah-biotrack/src/store/useRecordStore.ts` (`saveRoute`, `RecordedRoute`) |
| **Crash safety** | **None.** Until Finish, the points live only in the screen's memory (`useState`). Closing the app, the phone killing it, or a crash mid-walk loses the whole route. | `record-route.tsx` |
| **Linking to a plant** | After Finish the botanist links the route to a new or existing plant (`link-route.tsx`). `linkRouteToPlant()` sets the route's `linkedPlantId` and copies `routeLength` / `walkingTime` text onto the plant record on this phone. | `link-route.tsx`, `new-record.tsx`, `useRecordStore.ts` |
| **Sync to the server** | **None.** Nothing uploads routes. The plant's `routeLength` / `walkingTime` text is not uploaded with the plant either. | — |
| **Database** | **None.** No route table in `supabase/migrations`. The database has no PostGIS, so points will be stored as JSON. | — |
| **Backend** | **None.** No route endpoint in `backend/src/routes`. | — |
| **Officer map** | **None.** `frontend/js/map.js` loads plant markers (`/officer/map/plants`) and IoT stations (`/officer/map/stations`) only. | `frontend/js/map.js` |

**Note on how the backend reaches the database:** the backend queries Supabase **as the signed-in user** (`backend/src/config/supabase.js`, `forUser(token)`), with the publishable key. So RLS decides what each request can read or write. The new table needs proper policies, the same pattern as `sync_events` and `tag_reservations`.

---

## 2. Minimum version design

### 2.1 Crash-safe recording (phone)

**Problem:** a route that is not finished exists only in screen memory.

**Design:**
- While recording, save the route in progress (points, waypoints, start time, paused state) to phone storage:
  - every 10 points or every 15 seconds, whichever comes first;
  - again on pause, on Finish, and when the app goes to the background (`AppState` change).
- **Where to store it:**
  - Use a separate AsyncStorage key, `niah-route-in-progress`, not the main store.
  - Each save stays small and never rewrites plant records.
- **When the record-route screen opens and an unfinished route exists**, ask:
  - "Resume route", which continues adding points;
  - "Finish and save", which saves what was recorded;
  - "Discard".
- Clear the in-progress key only after `saveRoute()` has stored the finished route.
- **Keep the screen awake while recording** (decision 6):
  - Use `expo-keep-awake`, active only while the route is recording, and released on pause, Finish, Discard and leaving the screen.
  - It is added with `npx expo install expo-keep-awake` when implemented. The module is already installed as part of `expo` (~58.0.3), so it needs no new app build.
  - The screen still tells the botanist to keep the app open: a locked phone or another app in front still stops the GPS readings until background tracking (phase 2).

### 2.2 Separate route sync path (phone)

The plant/visit outbox (SQLite), `syncAll()` and `backend/src/routes/sync.js` are **not changed**.

**Each saved route gets these fields:**

| Field | Meaning |
|---|---|
| `clientRouteId` | A UUID made on the phone when the route is saved. It never changes and makes the upload safe to repeat. |
| `syncStatus` | `not_uploaded`, `uploading`, `uploaded` or `failed`. Uses the same words as plants. |
| `serverId` | Set from the server's answer. |
| `syncError` | Plain-language reason when an upload failed. |

**New store action `syncRoutes()`:**
- It uploads each route that is not uploaded yet with `POST /api/routes`, one at a time.
- If an upload fails, that route is marked `failed` with the reason, and the next route is still tried.

**When it runs:**
- **Sync now** (Home, My submissions, Profile) calls `syncRoutes()` **after** the existing `syncAll()` finishes. It's one extra call; `syncAll()` itself is untouched.
- It also runs where plant sync already runs automatically.

**How the botanist sees it:**
- The Sync now message adds "N routes uploaded".
- A "Routes" line on Profile shows the queued and failed counts.
- Each saved route shows Not uploaded / Uploaded / Upload failed + Retry.

**Store migration:**
- Old routes on phones have no `clientRouteId` or `syncStatus`.
- A persist migration (version 9 → 10) gives each one a new UUID and `syncStatus: not_uploaded`.

**Size:**
- A 2-hour walk at one point every 2 s is about 3,600 points, roughly 200 KB as JSON.
- That fits well within the backend's 25 MB JSON limit.

### 2.3 Table `public.field_routes` (migration, run by Phoebe)

**Columns:**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` primary key, default `gen_random_uuid()` | Server ID. |
| `client_route_id` | `uuid` not null | From the phone. Unique together with `recorded_by`, so the same route can't be stored twice. |
| `recorded_by` | `uuid` not null, references `auth.users(id)` | Must equal `auth.uid()` on insert. |
| `plant_id` | `uuid` null, references `public.plants(id)` `on delete set null` | Optional link (see section 3). |
| `started_at`, `ended_at` | `timestamptz` not null | `ended_at >= started_at`. |
| `distance_m` | `numeric` not null | `>= 0`, `<= 100000`. |
| `duration_s` | `integer` not null | `>= 0`, `<= 86400`. |
| `points` | `jsonb` not null | An array of `[lat, lng, recorded_at_ms, accuracy_m]`, with between 1 and 20,000 points. |
| `waypoints` | `jsonb` not null, default `'[]'` | An array of `{ number, label, lat, lng, time }`, at most 200. |
| `point_count` | `integer` not null | Kept for quick reads and checks. |
| `created_at` | `timestamptz` not null, default `now()` | |

**Indexes:**
- unique `(recorded_by, client_route_id)`;
- `(ended_at desc)` for the map's date filter.

**RLS** follows the pattern of `sync_events` and `tag_reservations`, and matches decision 2:

| Who | Can do | Policy |
|---|---|---|
| **Botanist** | Insert and read **only their own** routes (the ones they recorded). Reading their own lets a retried upload find the existing row. | Insert `WITH CHECK (recorded_by = auth.uid() AND public.current_app_role() = 'botanist')`; select `USING (recorded_by = auth.uid() AND public.current_app_role() = 'botanist')` |
| **Officer** | Read **all** routes. | Select `USING (public.current_app_role() = 'officer')` |
| **Researcher** | Nothing for now. | No policy. Added later by a new migration **only if SFC requests it**. |
| **Visitor account** (signed in, role `visitor`) | Nothing. | No policy matches their role, so they get no rows. |
| **Signed-out user** (`anon`) | Nothing. | All table rights revoked from `anon`; no policy. |

**Table rights:**
- `ALTER TABLE public.field_routes ENABLE ROW LEVEL SECURITY;`
- `REVOKE ALL ON public.field_routes FROM PUBLIC, anon, authenticated;`
- `GRANT SELECT, INSERT ON public.field_routes TO authenticated;` The policies above then limit each role.
- **No UPDATE or DELETE policy** in the minimum version. Routes can't be edited or deleted through the API.
- Nothing about routes is shown on the public visitor pages or the public plant API.

**Where each role sees routes:**
- Botanists see their own routes **on the phone**. The minimum version has no web page or list endpoint for botanists.
- Officers see all routes on the Distribution map.

The exact SQL is written with the migration, checked against the live schema first (is `plants.id` a `uuid`? are the role words `botanist` / `officer` the same?), and handed to Phoebe to run.

### 2.4 Backend endpoints

**`POST /api/routes`** (new file `backend/src/routes/fieldRoutes.js`):
- **Access:** `requireAuth`, `requireRole("botanist")`.
- **Validation** (plain-language 400 errors):
  - `client_route_id` is a UUID;
  - between 1 and 20,000 points, each with a latitude of −90..90 and a longitude of −180..180;
  - the times are numbers;
  - the duration and distance are within the limits above;
  - at most 200 waypoints.
- **Handling a repeat upload:**
  - The route is inserted with the user's own Supabase client, so RLS applies.
  - If `(recorded_by, client_route_id)` already exists, it returns **200** with the existing `id` instead of an error.
  - A new route returns **201** with its `id`.
- **`plant_id`:** if given, it must be an existing plant the botanist may see. Otherwise the request gets a 400 error with a plain message.
- **Rate limit:** a per-user limit, like the other write routes.

**`GET /api/officer/map/routes`** (added to `backend/src/routes/officerMap.js`):
- **Access:** officer only, like `/officer/map/plants`. Botanists, researchers, visitors and signed-out users get 401/403.
- **Dates:** the last 90 days by default (decision 4).
  - The endpoint also accepts optional `from` / `to` dates.
  - The map page has no date filter in the minimum version; that comes in phase 2.
- **Returns per route:**
  - `id`, `recorded_by` name, `started_at`, `ended_at`, `distance_m`, `duration_s`;
  - `plant_id` and the plant's tag or species name, when linked;
  - waypoints;
  - points.
- **Point thinning:** when a route has more than 2,000 points, the response keeps every n-th point plus the first and last. Stored data is unchanged.

### 2.5 Officer map (web)

In `frontend/js/map.js` and `map.html`:
- **A "Show routes" checkbox** in the map's filter bar. It is on by default and remembered per browser.
- **Routes from the last 90 days** are shown, with a short note saying so (decision 4).
- **Each route is drawn as a line** (Leaflet `L.polyline`, already loaded on the page). Start and end are small circle markers.
- **Clicking a line opens a popup with:**
  - the botanist and date;
  - the distance and walking time;
  - the linked plant (tag and scientific name), or "Not linked to a plant".
  - The popup text goes through the existing `escapePopupText`.
- **Routes load in parallel with plants.** If routes fail to load, the plants still show, and a short note reads "Routes could not be loaded".
- **No new element IDs replace existing ones.**

---

## 3. The plant link — decided: option A

A route can be linked to a plant on the phone. On the server, `plant_id` must be the plant's **server** ID. A plant registered on this walk may not have synced yet.

**Decision (18 Nov 2026): option A.** Send the plant link only if the plant has already synced. Otherwise upload the route without it.

| Option | What happens | Effort |
|---|---|---|
| **A (chosen)** | Send `plant_id` only when the linked plant already has a `serverId` at upload time. Otherwise upload the route without a link. The link stays visible on the phone, and the map shows "Not linked to a plant". | About 1 hour |
| B (not chosen) | Wait to upload a linked route until its plant has synced, then send the link. | +½ day. Routes can sit unsent behind a plant that's stuck (e.g. a photo over 5 MB). |
| C (not chosen; candidate for phase 2) | Upload without a link, then attach it later with a new `PATCH` once the plant syncs. | +1 day. Needs an UPDATE policy limited to `plant_id` by the route's own botanist. |

With option A, the route always uploads and nothing waits on plant sync. A route uploaded without its link stays unlinked on the server until phase 2.

---

## 4. Phase 2 (after the minimum version)

1. **Link routes to plants and visits on the server:**
   - option C above, plus an optional `observation_id` for "route walked on this visit";
   - show the route on the officer's plant page.
2. **Background tracking**, so recording continues with the screen locked:
   - `expo-location` background updates with `expo-task-manager` (a new native module, so a new development build is needed);
   - "Allow all the time" location permission and its explanation text;
   - an Android foreground-service notification;
   - battery testing.
   - **About 2 days**, plus store-review wording for the permission.
3. **Officer filters:** a date-range filter on the map (replacing the fixed 90 days), a botanist filter, and route length in the reports and export.
4. **Researcher access, only if SFC requests it:** a new migration adds a researcher read policy, and the officer map endpoint is opened to researchers. Researchers get nothing until then.
5. **Botanist route list** in the app: past routes, their upload status, and delete for routes that haven't been uploaded yet.
6. **Point simplification** before upload, to send fewer points over weak signal.

---

## 5. Time estimates (one developer, done safely)

| Work | Time |
|---|---|
| Migration + RLS policies, checked against the live schema, SQL handed to Phoebe | ½ day |
| Backend: `POST /api/routes`, `GET /api/officer/map/routes`, tests | 1 day |
| Phone: crash-safe recording + resume prompt + keep the screen awake while recording | ½ day |
| Phone: separate route sync, store migration v10, status in Sync now / Profile, plant-link option A | 1 day |
| Web: route lines, toggle, popup, guard tests | ½–1 day |
| Testing on a real phone outdoors: offline walk, closing the app, retry, officer sees the line | ½–1 day |
| **Total** | **about 4–5 working days** |

Phase 2 is not included. Background tracking alone is about 2 more days plus a new app build.

---

## 6. Risks

| Risk | Effect | How it's handled |
|---|---|---|
| App closed or killed mid-walk | Route lost (today) | Crash-safe saving every 10 points / 15 s and on going to the background, plus the resume prompt. |
| Screen locks during the walk | Points stop until the app is opened again, which leaves a straight gap in the line | Minimum version: the screen stays awake while recording (`expo-keep-awake`, approved in decision 6), and the screen tells the botanist to keep the app open. Pressing the power button or switching apps still stops the GPS readings. Phase 2: background tracking (decision 5). |
| Screen kept awake | Uses more battery | Only while a route is recording; released on pause, Finish, Discard and leaving the screen. |
| Duplicate uploads after a timeout | The same route twice on the map | Unique `(recorded_by, client_route_id)`; a repeat upload returns the existing row. |
| Changing plant/visit sync by accident | Breaks the main workflow | Routes use their own action, outbox and endpoint; `syncAll()` is only followed by one extra call. Existing sync tests must still pass. |
| Store migration v9 → v10 | Old routes on phones become unreadable if it goes wrong | Only adds fields; a test covers a v9 state with routes; plant records aren't touched. |
| Bad GPS under canopy | Zig-zag lines | Points worse than ±50 m are already dropped. The map shows the line as recorded, with no smoothing in the minimum version. |
| Large routes | Slow upload or map | 20,000-point cap on upload; thinning to about 2,000 points on the map response. |
| RLS mistakes | A botanist sees other botanists' routes, or a researcher, visitor or signed-out user sees routes | Policies follow decision 2 and the existing pattern; checked by the tests in 7.1 and the database checks in 7.2. |
| Location privacy | Routes show where staff walked | Officers see all; botanists see only their own; researchers, visitors and signed-out users see none; never on public pages. |

---

## 7. Test plan

### 7.1 Automated (run before handing over)

**Backend (`cd backend && npm test`, must pass with 0 failures). New tests in `backend/test/fieldRoutes.test.js`:**
- **Upload validation:**
  - a botanist upload is accepted (201);
  - the same `client_route_id` again returns 200 with the same id;
  - 400 for a missing or invalid `client_route_id`, 0 points, more than 20,000 points, an out-of-range latitude/longitude, a negative duration, or an unknown `plant_id`.
- **Upload access:** an officer, researcher, visitor or anonymous user gets 401/403 on upload.
- **Map read access:** an officer gets all routes from `GET /api/officer/map/routes`; a botanist, researcher, visitor and signed-out user get 403/401.
- **Own routes only:** with the botanist's token, reading routes returns only rows with `recorded_by` = that botanist. This is the repeat-upload lookup.
- **Map read content:**
  - point thinning keeps the first and last point and returns at most about 2,000 points;
  - without dates, only routes from the last 90 days are returned.
- **Guard tests in `webPortalGuards.test.js`:**
  - the map loads routes from the officer-only endpoint;
  - popup text goes through `escapePopupText`;
  - the "Show routes" toggle exists;
  - existing element IDs are unchanged.
- **Sync untouched:** existing sync tests still pass, and `sync.js` is not modified.

**App (`cd niah-biotrack && npx tsc --noEmit` and `npm test`). Pure helper tests:**
- the upload request built from a saved route;
- choosing which routes to upload;
- the plant-link option A rule (only a plant that has a server ID);
- the store migration v9 → v10 adds `clientRouteId` and `syncStatus` and leaves plant records unchanged.

### 7.2 Database checks (Phoebe runs these after the migration, read-only)

**Check that the table is protected:**
- RLS is on:
  - `select relrowsecurity from pg_class where oid = 'public.field_routes'::regclass;` should return `true`.
- Exactly three policies exist: botanist insert own, botanist read own, officer read all. There is none for researchers, visitors or anon, and none for UPDATE or DELETE:
  - `select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'field_routes';`
- anon has no table rights, and `authenticated` has only SELECT and INSERT:
  - `select grantee, privilege_type from information_schema.role_table_grants where table_name = 'field_routes';`

### 7.3 On a real phone (outdoors)

1. **Airplane mode:** record a 10-minute walk with 2 waypoints, then Finish. The route is saved and shows "Not uploaded".
2. **Closing the app:** start a route, walk 2 minutes, then swipe the app closed. Reopen it, go to record route, and choose "Resume" or "Finish and save". The points recorded before closing are there.
3. **Sync:** back online, press Sync now. Plants and visits sync exactly as before, then "1 route uploaded" appears.
4. **Retry:** turn off the connection during upload. The route shows Upload failed + Retry, and retrying uploads it once. The server has a single row.
5. **Linking (option A):** a route linked to an already-synced plant shows that plant in the map popup. A route linked to an unsynced plant uploads without a link.
6. **Officer map:** the route appears as a line with start and end markers. The popup is correct, and "Show routes" hides and shows the lines. At 400 px width the map and popup fit the window.
7. **Access:** signed in as a botanist on the web, the map page is not available (as today). The routes endpoint returns 403 for a botanist token.
8. **Screen awake:** while recording, the screen doesn't dim or lock. After pause or Finish it locks normally again.

---

## Decisions (recorded 18 Nov 2026 by Phoebe)

1. **Plant link: option A.** Send the plant link only if the plant has already synced; otherwise upload the route without it. (Section 3.)
2. **Access:**
   - botanists see only their own routes (they record them);
   - officers see all routes;
   - researchers are added later, only if SFC requests it;
   - visitors and signed-out users see none.

   (Section 2.3 RLS policies, section 2.4 endpoint access.)
3. **Point cap:** keep 20,000 points per route. (Sections 2.3 and 2.4.)
4. **Officer map:** keep the 90-day default; the date filter comes in phase 2. (Sections 2.4, 2.5 and 4.)
5. **Background tracking:** phase 2. (Section 4.)
6. **Keep the screen awake while recording:** yes, added with `npx expo install expo-keep-awake` when implemented. (Sections 2.1 and 6.)
