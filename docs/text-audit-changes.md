# User-facing text: changes (Part C)

Every change is listed as file — before → after. Line numbers are approximate.

## C.1 Species text without credit or source fragments

- **`backend/src/utils/speciesDescription.js`**: new `cleanSpeciesText` / `cleanSpeciesFields`. They remove "(photo by …)", "photo by …", "Photo: …", "Source: …", "Credit: …", "via …" at the start of a sentence, "via iNaturalist", "(c) …" / "© …", links, and doubled spaces and full stops.
  - Example: "Identified to family level only. (photo by Niah National Park)." → "Identified to family level only."
- **Shown cleaned everywhere**, for description, habitat, distribution notes, morphology and cultural significance:
  - `backend/src/routes/knowledge.js`: the species API used by the app, the web portal and the editor.
  - `backend/src/middleware/publicQrProtection.js`: the public QR API.
  - `backend/src/routes/publicPlants.js`: the visitor page.
- **`scripts/clean-species-text/clean.mjs`**: cleans the stored description, habitat and distribution notes. Dry run by default; `--apply` needs `supabase/migrations/20261121190000_service_role_clean_species_text.sql`.

## C.2 Plants tab header

- `niah-biotrack/app/(tabs)/records.tsx` — "Synced 2 min ago" / "Not synced yet" in the top-right → removed. "Sync now" still shows when something is waiting to upload; the sync status stays on Home and Profile.

## C.3 App (niah-biotrack)

**Placeholder tags ("plant:<id>") no longer shown**
- `app/(tabs)/records.tsx` row tag line and its screen-reader label — any tag → physical NIAH-PLT tags only.
- `app/navigate-plant.tsx` — "Tag plant:…" → shown only for a physical tag (3 places).
- `app/add-observation.tsx` — `tagCode ?? 'No tag attached'` → a physical tag, or "No tag attached".

**Raw values**
- `app/(tabs)/tasks.tsx`, `app/iot-task-detail.tsx` — "Station 1a2b3c4d" → "Unknown station".
- `app/iot-task-detail.tsx` — the raw alert message with sensor keys (soil_moisture …) → hidden. The "Reading ID" row → removed.
- `app/(tabs)/profile.tsx` — Designation "botanist" → "Botanist" / "Conservation officer" / "Researcher".
- `app/plant-detail.tsx` — sync state "draft"/"uploaded" → "Saved on this phone" / "Uploaded" / "Upload failed".

**"Draft" and "pending"**
- `src/utils/reviewStatus.ts`, `app/plant-detail.tsx` — "Draft" (plant-detail used green Approved colours) → "Not submitted yet" (amber).
- `app/(tabs)/home.tsx`, `records.tsx`, `profile.tsx` — "Upload complete; download pending" → "Uploaded, but couldn't download updates".
- `home.tsx` — "… pending sync" → "… waiting to upload"; "· local storage safe" → "· saved on this phone".
- `app/index.tsx` — "Signed in; download is pending" → "Signed in, but couldn't download your plants yet".
- `app/add-observation.tsx` — "Saved; submission is pending" → "Saved, not sent yet".
- `app/new-record.tsx` — "Upload pending: …" → "Not uploaded yet: …".
- `profile.tsx` — metric "Pending" → "Waiting".
- `src/services/syncSummary.ts`:
  - "N pending" → "N waiting to upload"
  - "Pending data is saved on this device and waiting for server upload." → "Data waiting to upload is saved on this device."
  - "Create a plant record to start the local sync queue." → "Nothing to upload yet."
  - "The application is processing local records and observations." → "Uploading your plants and observations…"
  - "All local records and observations have an uploaded status." → "Everything is uploaded."
- `profile.tsx` — "The local and server sync queues were checked successfully." → "Everything is up to date."
- `src/store/useRecordStore.ts` — "Some metadata operations are still waiting to upload." → "Some changes are still waiting to upload."

**Server errors**
- `src/api/client.ts`, `src/services/plantPhotoSync.ts`, `src/api/species.ts`:
  - "Could not reach the server at https://…" → "Couldn't reach the server. Check your connection and try again."
  - "Server returned 500" → "The server had a problem. Please try again."

**Names**
- `add-observation.tsx` — "from My Records" → "from Plants".
- `propose-species.tsx` — "New Record" → "Register plant" (2 places).
- `species-reference/index.tsx` — "Back to New Plant Record" → "Back to Register plant".
- `plant-detail.tsx`:
  - "Officer's comment" → "Officer's reason"
  - "No comment was given." → "No reason was given."
  - "Submitted to officer review" → "Sent for review"
- `index.tsx` — "Niah Ground-Truth" → "Niah BioTrack".
- `scan.tsx` — "Taxonomy Family:" → "Family:"; "Manual Tag Lookup" → "Type a tag". `manual-qr.tsx` — "Manual Tag Entry" → "Type a tag".

**Duplicates**
- `plant-detail.tsx` — the "Observations: N" row → removed (the Observations header shows the count).
- `forgot-password.tsx` — an alert and a toast for the same failure → the toast only.

**Typos and grammar**
- `save-confirm.tsx` "1 photos", `profile.tsx` "item(s)" / "server change(s)", `add-observation.tsx` "slot(s)" → correct singular or plural.
- `records.tsx` — "Observation 19 Nov · 10:30: …" → "Observation on 19 Nov · 10:30: …".
- `useRecordStore.ts` — "an identification-pending record" → "a plant whose species isn't confirmed yet". `attach-tag.tsx` — "this identification-pending plant" → "this plant (species not confirmed yet)".
- `forgot-password.tsx` — "your Gmail" → "your email".
- `add-observation.tsx` — "Tap Retry" → "Tap Retry GPS". Its permission alert names the camera or the photo library, depending on which was chosen.
- "synchronized" / "synchronizes" / "synchronization" → "synced" / "syncs" / "syncing" in `tasks.tsx`, `attach-tag.tsx`, `plant-detail.tsx` and `useRecordStore.ts` (3 places).

**Sentence case**
- `add-observation.tsx` — "Add Observation", "Life Stage", "Health Status", "Botanist Access Required" and its toast titles → sentence case. Step "Metrics" → "Measurements".
- `scan.tsx` — "Camera Access Required", "Enable Camera", "Scan Again", "Record Observation →" → sentence case. "Verifying Tag..." → "Checking tag…".
- `profile.tsx` — "N Queued", "All Synced", "Log Out" → sentence case. "Database Sync" → "Sync".
- `attach-tag.tsx` — "Attach Plant Tag" → "Attach plant tag"; "✓ Plaque Assigned" → "✓ Tag attached".
- `new-record.tsx` — "Life Stage", "Health Status" → sentence case.
- `species-reference/[id].tsx` — "Species Reference" → "Species reference".

**Empty sections hidden**
- `plant-detail.tsx` — "Morphological characteristics" and "Notes" headings with "Not recorded" → shown only when there is text. "About this species" with 7 "Not recorded" rows → hidden until the species is identified.
- `navigate-plant.tsx` — the "Live navigation map" heading and card with no plant chosen → hidden.

## C.3 Web portal and visitor page

**Raw values**
- `frontend/js/plant.js`:
  - Observation history "healthy" / "seedling_sapling" → "Healthy" / "Seedling sapling" (new `readableValue` in `shared.js`).
  - Conservation status "VU" → "Vulnerable".
  - Height and diameter cells "1.5 m" / "12 cm" → numbers only (the headers give the units).
- `frontend/js/map.js` — plant popup "Status: pending" → "Status: Waiting for review"; station "online" → "Online".
- `frontend/js/reports.js` — health and stage are shown as words; plant status shows as "Waiting for review" / "Approved".
- `backend/src/routes/publicPlants.js` — conservation status "DD" → "Data Deficient"; fallback "Not recorded" → "Not assessed".
- `frontend/js/shared.js` — unknown status "unknown" → "Status not recorded".

**Technical messages**
- `frontend/js/shared.js`:
  - "Request failed (500)" → "Something went wrong on the server. Please try again."
  - "Could not reach the backend. Is it running?" → the standard "can't reach the server" message
  - "Database error 500" → "Could not load the user list."
  - ".." in the database banner → fixed
  - "Field record count could not be loaded. The field records count was unavailable." → "Field record count could not be loaded." (also in `queue.js`)
- `plants.js`, `plant.js`, `species.js`, `map.js` — "The … response was invalid." → "The data could not be read. Please reload the page."
- `plant.js` — "A valid plant ID is required." → "This plant link is not valid. Open the plant from the Plants list."
- `editor.js` and `backend/src/routes/knowledge.js` — "…the database needs an update first" / "…until the … migration is applied" → "This can't be saved yet. Please contact the system administrator."
- `backend/src/routes/officerReviews.js`:
  - "Could not load pending observations" → "Could not load field records."
  - "Could not load rejected observations" → "Could not load field records that need changes."
  - "Photos are available only for pending or rejected observations" → "Photos are only available for field records waiting for review or needing changes."
  - "Approve it in the Species catalogue first, then approve this observation." → "Approve its species request first, then approve this field record."
  - "Reload the queue." → "Reload the page."
  - "Observation must be Pending; approval requires an approved species" → "This field record can't be approved until its species is approved."
  - "Reviewer identity mismatch" → "You must be signed in as an active officer."
- `backend/src/routes/knowledge.js`:
  - "scientific_name is required…" → "Scientific name is required…"; other field names in messages are now plain labels.
  - "taxonomy_id does not refer to an existing taxonomy row" → "The family could not be found."
  - "decision must be 'approved' or 'rejected'" → "Choose approve or don't add."
  - "Only pending proposals can be reviewed" → "Only species requests waiting for review can be reviewed."
  - "Could not review species proposal" → "Could not review the species request."
  - "…or is already proposed" → "…or is already requested"
  - "A comment is required when rejecting a proposal" → "A reason is required when not adding a species request."

**Names**
- `frontend/editor.html`, `editor.js`, `species.js`, `species.html`:
  - "Propose a species" → "Request a species"; "Send proposal" → "Send species request"; "Proposal sent." → "Species request sent."
  - "propose new ones" → "request new ones"
  - "…approves or rejects it on the Species catalogue page" → "…reviews it on the Species requests page"
- `proposals.js` / `proposals.html`:
  - "N pending species requests" → "N species requests waiting for review"
  - "Reject" / "Reject species request" / "Reason for rejection" → "Don't add" / "Don't add this species" / "Reason"
  - "Species request rejected." → "Species request not added."
  - The badge tooltip says "waiting for review"; its plurals ("waiting for reviews") are fixed too.
- `reports.html` — "Observations awaiting approval" → "Field records waiting for review"; "Plant records" → "Plants".
- `plants.html` / `plant.html` / `plants.js` — "Plant catalogue" → "Plants".
- `map.js`, `reportService.js` — "Landmark" → "Location note".
- `map.js` — "Common name: Unknown species" → "Common name: Not recorded"; "IoT Sensor Station" → "IoT sensor station".
- `rejected.js` / `rejected.html` (page content only; the tab and title are unchanged):
  - "Reason for rejection" → "Reason"; "Rejected on" → "Sent back on"
  - "N rejected field records" → "N field records that need changes"
  - The empty-state text no longer says "rejects … by mistake".

**Duplicates and empty sections**
- `publicPlants.js` — the tag shown twice ("Tag: …" under "This plant") → once at the top. "This plant" is shown only when there is a photo.
- `plants.js`, `plant.js` — an error shown in the page box and again as a toast → the page box only.
- `plant.js` — the observation table header with no rows → hidden. `users.js` — the empty user table → hidden.
- `proposals.js` — "No reference photo provided." on every card → removed.

**Typos**
- `species.html` — "All conservation status" → "All conservation statuses".
- `plants.html` / `plants.js` — "All registered by" → "All botanists".
- `forgot-password` — "6 digit" → "6-digit". Titles "Forgot Password" / "Reset Password" → sentence case.
- `login.html` — "sign in with" → "log in with".
- Toasts "Species saved", "Role updated", "User deleted" → end with a full stop.
- Page descriptions for `map.html` and `editor.html` are rewritten; they keep "for conservation officers" for the page-description rule.
- Visitor page:
  - "Invalid plant tag / Use a valid Niah plant QR tag." → "Plant tag not recognised / This QR code isn't a Niah plant tag."
  - "This tag has no approved public record yet." → "Information about this plant isn't available yet."

## Not changed (needs your decision)

- **Rejected history (web tab and title):** the field records it lists are "Needs changes"; renaming it changes the menu you set up earlier.
- **Review page heading and description (queue.html):** you set these earlier.
- **Register plant filler note:** the first observation gets the note "Initial registration record." when the botanist leaves notes empty. Removing it may affect the backend's required fields.
- **"Identification pending":** used as the name of a plant whose species isn't confirmed.
- **Visitor Plants tab:** the tab is "Plants" but the screen heading is "Plant guide".
- **Conservation status words differ:** the app's species reference shows "Least Concern (LC)"; other screens show "Not at risk".
- **Account state "Pending approval"** on the Users page.
- **Mismatched password-rule texts:** reset page vs. server.
- **Not audited:** `alerts.html` / `alerts.js` are not in the menu, and the new overview page is from other work.
