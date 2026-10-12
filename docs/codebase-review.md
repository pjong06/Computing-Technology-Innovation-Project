# Niah Ground-Truth: Codebase Review

*After the Priority 0 fixes. Branch `fix/priority-0`, based on `main` @ `99f6ae3`. Reviewed 2026-10-12.*

Scope: the mobile app (`niah-biotrack/`) in detail. `backend/` and `frontend/` are unchanged since the last review; their status is summarised in section 5.

Legend: ✅ built and real · 🟡 partly built, or UI only · ❌ not built.

---

## 1. What changed in this round

| Commit | Change |
|---|---|
| `6f3ea84` fix: prevent crash when plant not found | `plant-detail`, `plant-tag` and `add-observation` no longer fall back to `records[0]`. They show a "Plant not found" screen with Back (`src/components/PlantNotFound.tsx`). |
| `d657f51` fix: restore AI species suggestions | New Record calls `identifyPlant()` again: suggestion cards, tap to fill, cancel when the photo changes. The static "Offline" AI banner is gone. A connection failure throws `IdentifyNetworkError` and only that shows the offline message. |
| `2210bb0` fix: use real GPS fix | Fake fallback coordinates and "Good fix" removed. `latitude`, `longitude` and `gpsAccuracyM` are stored as numbers. Shows a "GPS unavailable – tap to retry" state. Saving requires a fix. N/S/E/W formatting is in `src/utils/formatCoordinates.ts`. |
| `6861269` fix: validate new record | Made-up defaults removed. 1+ photo, scientific name, location name and GPS are required, with inline errors. Always-on "Offline" / "Draft saved" banners removed (also from Record saved). |
| `2b97f1a` fix: keep typed common name / family | Picking a suggestion only fills the fields it has values for. |
| `f854822` fix: re-arm QR scanner | The Scan tab resets `scanned` on focus. "Open settings" calls `Linking.openSettings()`. Permission is refreshed on focus and when the app returns from Settings. |
| `4337547` chore: remove leftover Rimba store | Deleted `Rimba/src/store/recordsStore.ts`. |

`npx tsc --noEmit` passes. No new libraries were added.

---

## 2. Faked or placeholder features

### Now real

| Feature | Where | Notes |
|---|---|---|
| AI species suggestions (online) | `app/new-record.tsx`, `src/services/identifyPlant.ts` | Real Pl@ntNet results via the backend. Needs `EXPO_PUBLIC_API_BASE_URL` (mobile) and `PLANTNET_API_KEY` (backend). |
| GPS on New Record | `app/new-record.tsx` | Real device fix with numeric lat/lng and accuracy. The quality label is derived from the reported accuracy. Unavailable state with reason and retry. |
| New Record fields | `app/new-record.tsx` | No invented values; required fields are enforced. |
| Plant not found | `src/components/PlantNotFound.tsx` | Replaces the crash / wrong-plant fallback. |
| QR scanner | `app/(tabs)/scan.tsx` | Camera, gallery image, torch and repeat scans all work; "Open settings" opens Settings. Lookup is local-only (see section 3). |
| Record not found | `app/manual-qr.tsx` | Real result of a local lookup. |
| Observations, local storage | `src/store/useRecordStore.ts` | Saved on device (but see the fake time and recorder below). |

### Still fake

| Feature | Where | What happens |
|---|---|---|
| Login | `app/index.tsx:13-20` | Any non-empty email and password logs in. An empty field shows "Incorrect password". |
| Forgot / change password | `app/forgot-password.tsx`, `app/change-password.tsx` | No email is sent. Change password can't be reached from any screen. |
| Sync | `app/(tabs)/home.tsx:30-42`, `app/(tabs)/profile.tsx:18-26`, store `syncPending` | A `setTimeout`, then every record (including Failed ones) is marked Synced. Nothing is uploaded. Hard-coded text: "1 of N" and the progress bar, "41 of 42 records on server", "Last sync 2 h ago", "Automatic while online". |
| Profile user | `profile.tsx:34-37` | Hard-coded name, initials and organisation. The "Use mobile data" switch isn't saved or used. |
| Logout warning | `profile.tsx:69-94` | Shown even with 0 unsynced records. Says records will be deleted, but `clearAllData()` is never called. "Sync first" uses the fake sync. |
| Failed / Retry | `home.tsx:192-198` | Nothing ever sets a record to Failed, so Retry never appears. The error text is hard-coded. |
| Species catalog | `app/(tabs)/species.tsx:6-13, 42-48` | 6 hard-coded species. The "48 species available offline" text is fixed. The filter buttons do nothing. |
| QR tag | `app/plant-tag.tsx:22-34` | 🏁 emoji instead of a QR code. Print and Share are fake alerts. |
| Record ID | `app/new-record.tsx` (`NP-2026-xxxx`) | Random 4 digits, so collisions are likely. "2026" is hard-coded. |
| Plant detail content | `app/plant-detail.tsx` | Every plant shows: an "Endangered" badge, a Rafflesia description when empty, a default morphology text when empty, "1 / 4 photos", and a 🌺 emoji. **The recorded photos are not shown.** |
| Add observation | `app/add-observation.tsx:22-29` | The time is always "8:10 AM", the recorder name is hard-coded, and height defaults to 0.62. |
| Record route | `app/record-route.tsx` | Simulated at 2 m/s with a fixed end GPS and fixed accuracy (±5 / ±6 m). No real location is used. |
| Link route | `app/link-route.tsx` | The route is never linked (`linkedPlantId` is never set). Falls back to a fixed 640 m / fixed GPS text. "GPS already filled in" is not true. |
| Navigate to plant | `app/offline-map.tsx` | Static screen: 140 m, Rafflesia, NP-2026-0417, for every plant. |
| Record saved fallback | `app/save-confirm.tsx:11` | Still falls back to `records[0]`. This doesn't crash in the normal flow because the record was just saved, but it could show the wrong plant if the ID were missing. |

---

## 3. Gap list against the design

| # | Design item | Status | Notes / what's left |
|---|---|---|---|
| 1 | Login | 🟡 | UI only; needs an auth API and token storage |
| 2 | Reset password | 🟡 | UI only; change password can't be reached |
| 3 | Home with sync banner | 🟡 | Banner UI built; the sync behind it is fake |
| 4 | Species reference | 🟡 | Hard-coded list; filters do nothing |
| 5 | Scan QR | 🟡 | Scanner works (camera, gallery, torch, rescan). Looks up local records only; QR format doesn't match the backend |
| 6 | Enter code | ✅ | Local lookup |
| 7 | Record not found | ✅ | Local lookup |
| 8 | My Records with filters | ✅ | |
| 9 | Retry | 🟡 | Button exists; Failed is never set |
| 10 | Profile with sync | 🟡 | Fake sync, hard-coded user |
| 11 | Logout warning | 🟡 | Always shown; doesn't clear data |
| 12 | New Record: multiple photos | 🟡 | 4 slots and at least 1 required. Not shown on plant detail. Still temporary cache paths |
| 13 | Scientific name autocomplete | ❌ | Plain text input |
| 14 | Common name, family | ✅ | Filled from an AI pick or typed |
| 15 | Height, morphology | ✅ | Height is a free-text string (metres implied) |
| 16 | Location name | ✅ | Required |
| 17 | GPS with accuracy | ✅ | Real fix, numeric, required. See section 4 for the timeout limitation |
| 18 | AI species suggestions (online) | ✅ | |
| 19 | AI offline fallback | 🟡 | Honest "can't reach server" message and manual entry. No offline species list or "identify later" queue |
| 20 | Record saved (synced / on device) | 🟡 | Always "Saved on device". That's accurate today, but a "Synced" state can't happen until sync is real |
| 21 | Plant QR tag (real QR) | ❌ | Emoji placeholder |
| 22 | Plant detail + observation history | 🟡 | History timeline is real; lots of fake content (section 2); no photos |
| 23 | Add observation | 🟡 | Saves locally; fake time and recorder |
| 24 | Navigate to plant | 🟡 | Static mock screen only |
| 25 | Record route | 🟡 | Simulated; no GPS |
| 26 | Offline-first save and sync later | 🟡 | Saving locally is real; sync isn't |

**Totals:** 9 ✅ · 15 🟡 · 2 ❌ (last review: 3 ✅ · 12 🟡 · 11 ❌, before the 1.1 changes).

---

## 4. New bugs, regressions and limitations from these fixes

No crashes or type errors found. Things to know:

1. **No GPS timeout.** `getCurrentPositionAsync` has no timeout, and there's no retry button while it shows "Acquiring GPS fix...". Under dense canopy this can take a long time, and the user can't save until it finishes. To retry they have to leave and reopen New Record. *Suggested:* add a timeout (e.g. 30 s) that switches to "GPS unavailable – tap to retry", plus a "Retry" link while acquiring.
2. **`Accuracy.High` replaced `Balanced`.** Fixes are more accurate, but slower and use more battery.
3. **The offline message covers two cases.** "Can't reach the server – you may be offline" appears both with no connection and when `EXPO_PUBLIC_API_BASE_URL` points to the wrong IP or the backend is down. Telling them apart would need `expo-network`, which is not added.
4. **AI uses one photo.** The backend accepts a single image, so the first filled slot (Whole plant → Leaf → Flower → Bark) is sent. The screen shows which slot is used.
5. **Older records have no numeric GPS.** Records saved with 1.1 have no `latitude`/`longitude`/`gpsAccuracyM`; they only have the old display string (which may be the fake fallback). The fields are optional, so nothing breaks, but those records can't be trusted for location.
6. **Height units are inconsistent.** New records store height as typed (e.g. `"0.4"`); 1.1 records stored `"0.5 m"`. Agree on a numeric `heightM` before sync.
7. **Camera permission changes on Android.** After the user denies it once, the app no longer re-prompts automatically; the fallback screen sends them to Settings. This is intentional, so testers should expect it.
8. **Photos are still in the cache.** Photo paths are still image-picker cache paths, which the OS may delete before the record is synced.
9. **Testing so far.** Only `tsc --noEmit` was run. No ESLint is configured, and the fixes haven't been run on a device yet.

---

## 5. Integration check: mobile ↔ backend

### Connected

| Mobile feature | Backend endpoint | Status |
|---|---|---|
| AI species suggestions | `POST /api/identify` (multipart `image`) | ✅ Connected again. Field name and response shape match |

Everything else on the mobile app is local-only: login, sync, photos, QR, species and observations.

### Mismatches that remain

| Topic | Mobile | Backend |
|---|---|---|
| Field naming | camelCase (`scientificName`, `gpsAccuracyM`) | snake_case in `/api/plants` (`scientific_name`, `gps_accuracy_m`) |
| Coordinates | ✅ Now numeric `latitude` / `longitude` (+ display string) | Numeric `latitude` / `longitude`. **Only the naming of accuracy differs now** |
| IDs | `id` (`rec-<timestamp>`) + `recordId` (`NP-2026-xxxx`, random) | `plant_id`, an integer from `length + 1` (duplicates after a delete) |
| QR content | Scanner expects `NP-2026-xxxx` | QR encodes `plant:1` |
| Photos | `photoUris[]`, up to 4 | One `photo` per plant, field `photo`, never served back; `uploads/` directory missing |
| Fields missing on backend | `family`, `height`, `morphology`, `description`, `locationName`, `conservationStatus`, `status`, `createdAt`, `observations[]`, routes | – |
| Auth | None | None |
| Response envelope | Expects `{ success, message }` (identify) | `/api/plants` has no `success` field |
| Other backend gaps | – | In-memory data, no CORS, no `start` script, no `.env.example`, weak validation |

### Web portal (`frontend/`)

The HTML pages (`species.html`, `map.html`, `queue.html`, `editor.html`, `reports.html`, `users.html`) reference `css/style.css` and `js/*.js`, but **those folders aren't in the repo**, so the pages render without styles or behaviour. The Vite template in `frontend/src/` is still there and unused.

---

## 6. Next priorities (Sprint 1)

1. **Agree the API contract and give the backend a real database.**
   - Write the contract as a shared doc or OpenAPI file.
   - Add Supabase/Postgres plants with all New Record fields, a phone-generated `clientId` (so re-sending is safe), numeric `heightM` and `gpsAccuracyM`, and multiple photos.
2. **Build a real sync engine** (`src/sync/`).
   - Upload pending records, then their photos.
   - Mark each record Synced or Failed with the real error, so Retry works.
   - Remove the `setTimeout` and all hard-coded sync text.
3. **Persist photos.** Copy picked photos into app document storage before saving, and show them on plant detail.
4. **Real QR tags.**
   - Generate them on the phone (`react-native-qrcode-svg`, which works in Expo Go).
   - Agree one QR format with the backend.
   - Scan lookup: local first, then the API.
5. **Auth.** Login endpoint, token in `expo-secure-store`, profile from `/auth/me`, and logout that actually clears data (and only warns when there are unsynced records).
6. **Remove the remaining fake content** on plant detail (badge, description, photo count), profile and species ("48 species", filters).
7. **Species reference API with an offline cache.** This also gives you scientific-name autocomplete and a proper offline fallback for AI.
8. **GPS timeout and retry while acquiring** (section 4, item 1).
9. **Record IDs.** Use a UUID `clientId` on the phone and a server-assigned tag code, instead of random 4-digit IDs.
10. **Web portal.** Commit the missing `frontend/css` and `frontend/js` assets (web team).

*Sprint 2 (not touched here):* route recording with real GPS, route linking, navigate-to-plant, and observation time and recorder.
