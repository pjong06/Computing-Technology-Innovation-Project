# Species reference photos: licence check

Steps 1-2 of `docs/species-photo-import-plan.md`.
- Find which old website photos we may legally use.
- Suggest allowed alternatives for the rest.

This guide covers the photo licence review and optional import workflow. It does not change the app UI.

## What's here

| File | What it is |
|---|---|
| `matching-queries.sql` | Read-only SQL for the Supabase SQL Editor. Q1-Q4 give counts and unmatched names; Q5 exports the input list. |
| `lookup-licences.mjs` | One-off Node script that asks the public iNaturalist API for each photo's licence and credit. |
| `species-photo-list.csv` | **Input** you export from Q5. Ignored by git. |
| `species-photo-review.csv` | **Output** of the licence check: one row per species + old photo. Ignored by git. |
| `csv.mjs` | Small CSV reader/writer shared by the scripts. |
| `make-by-species.mjs` | Turns `species-photo-review.csv` into `species-photo-review-by-species.csv`: one row per species with its best candidates. Offline. |
| `species-photo-review-by-species.csv` | One row per species, for `review.html`. Ignored by git. |
| `review.html` | Local review page: open it in a browser, load the by-species CSV, choose which photos to keep for each species and which is the main one, download the reviewed CSV. |
| `species-photo-review-by-species-REVIEWED.csv` | What `review.html` downloads, with the officer's choices. Ignored by git. |
| `import-photos.mjs` | Dry-run-first importer for the officer-reviewed photos. |
| `species-photo-import-results.csv` | Per-photo outcome report from an applied import. Ignored by git. |
| `.cache/` | Saved API answers, so a stopped run can resume. Ignored by git; delete it to start fresh. |

## How to run

1. In the Supabase SQL Editor, run Q1-Q4 from `matching-queries.sql` **one at a time** and note the numbers.
2. Run **Q5**, then **Export → Download CSV**, and save it as `scripts/species-photos/species-photo-list.csv`.
3. From the repo root, with Node 18 or newer (no `npm install` needed):

   ```bash
   node scripts/species-photos/lookup-licences.mjs
   ```

   Options, all optional:
   - `--input <file>`: input CSV (default `scripts/species-photos/species-photo-list.csv`)
   - `--output <file>`: review CSV (default `scripts/species-photos/species-photo-review.csv`)
   - `--cache <dir>`: cache folder (default `scripts/species-photos/.cache`)

4. Make the per-species file (offline, instant):

   ```bash
   node scripts/species-photos/make-by-species.mjs
   ```

5. An officer reviews it in `review.html` (next section).

### How the script behaves
- **Rate:** at most **1 request per second**, one at a time, with the User-Agent `NiahBioTrack-species-photo-licence-check/1.0 (...)`. About 174 species is about 180 requests, roughly 3-4 minutes.
- **What it calls:** only these public endpoints. iNaturalist has no "one photo by id" endpoint.
  - `GET https://api.inaturalist.org/v1/taxa?q=<name>` finds the species.
  - `GET https://api.inaturalist.org/v1/taxa/<up to 30 ids>` gives that species' own photos with licence and credit.
  - `GET https://api.inaturalist.org/v1/observations?taxon_id=<id>&quality_grade=research&photo_license=cc0,cc-by,cc-by-sa&photos=true&per_page=10[&place_id=...]` is used only when the original isn't allowed **and** the species has fewer than 3 allowed photos of its own. It looks in **Borneo** (`place_id=6876`) first, then **Malaysia** (`7155`), then anywhere, and stops once it has 3. That's at most 3 extra requests per species.
- **Observation photo rules:**
  - Each photo's **own** `license_code` decides whether it's allowed. An observation's licence can differ from its photos', so the observation's licence is never used.
  - Photos that iNaturalist has hidden or flagged are skipped.
- **Errors:**
  - HTTP 429, 5xx and network errors are retried up to 3 times, waiting 60 s, 120 s, 180 s or as long as `Retry-After` asks;
  - other errors are not retried, and the row is marked `lookup_failed`.
- **Resume:** every successful answer is saved in `.cache/`. If the run stops (Ctrl+C, no signal, rate limit), just run it again: finished requests aren't repeated.
- **Exit code:** 0 when everything was looked up, 2 when some lookups failed (run again).
- **Safety:** it reads only the input CSV and its own cache. No `.env`, no secrets, no login. It never touches our database or storage.

## Reviewing in review.html

1. Open `scripts/species-photos/review.html` in Chrome, Edge or Firefox by double-clicking it. No server or install is needed.
2. Type your name at the top, and choose `species-photo-review-by-species.csv` with **CSV file**.
3. For each species, keep a small gallery with one main photo:
   - **Keep:** tick it on every photo to use. Kept photos get a green frame.
   - **Main:** choose the main photo among the kept ones; it gets a thick frame. Only kept photos can be main. The first photo you keep becomes main automatically, and if you un-keep the main photo, the next kept one takes over.
   - **Keep all:** ticks every candidate and makes candidate 1 main. It only acts on the species you click it for, never on others, so every species is still looked at.
   - **None of these:** clears every kept photo for that species (for example when none shows the plant well, or there are no candidates).
   - **Reviewed** means at least one kept photo with a main, or "None of these".
   - **Add a note** if you like.
   - **Check before choosing:** use **Photo on iNaturalist** and **Observation** to confirm the plant really is this species and the licence matches.
   - **Order:** candidates are shown best first. Borneo observations come first, then the old website's photo if its licence is allowed, the species' own iNaturalist photos, then elsewhere in Malaysia, then anywhere.
4. **Progress and filter:** progress shows as e.g. `37/162 reviewed`. Tick **Show only not yet reviewed** to hide the species you've done.
5. **Saving:**
   - Choices are saved in this browser as you go, so a refresh doesn't lose them. After a refresh, pick the CSV file again.
   - Clearing the browser's site data deletes them, so download regularly.
   - Choices saved by the earlier one-photo version of the page are converted automatically: that photo becomes kept and main.
6. **Download reviewed CSV** saves `species-photo-review-by-species-REVIEWED.csv` to your Downloads. If you load a reviewed CSV again later, all its choices (kept photos, main photo and notes) are restored.

**Privacy and safety:**
- The page loads no scripts from the internet, and its security policy blocks every request except loading the candidate images.
- Images come only from iNaturalist's image hosts (`inaturalist-open-data.s3.amazonaws.com`, `static.inaturalist.org`), and links only go to `www.inaturalist.org`. Anything else in the CSV is not shown.
- Nothing you type or choose is sent anywhere.

### By-species CSV columns

| Column | Meaning |
|---|---|
| `species_id`, `scientific_name`, `inat_taxon_id` | The species (ours and iNaturalist's) |
| `old_photo_ids` | The old website's photo ids for this species, separated by `;` |
| `old_photo_reasons` | Why those couldn't be used, e.g. `unknown;cc-by-nc` |
| `candidate_count` | How many candidates (0 means "needs an SFC photo") |
| `candN_id`, `candN_licence`, `candN_attribution`, `candN_photographer`, `candN_url`, `candN_page_url`, `candN_source`, `candN_observation_url` | Candidate N (N = 1-6). These have the same meanings as the `altN_*` columns below, plus `original (old website)` as a possible `source` |
| `officer_choice` | Filled by review.html: the kept candidates, e.g. `cand1;cand2;cand3`, or `none`. Blank = not reviewed yet |
| `main_choice` | The main candidate, e.g. `cand1` (blank for `none`) |
| `chosen_photo_ids` | iNaturalist photo ids of the kept photos, separated by `;`, **main first** |
| `main_photo_id` | iNaturalist photo id of the main photo |
| `officer_name` | Who reviewed it |
| `officer_notes` | Optional note |

The single-photo column `chosen_photo_id` from the first version is replaced by `chosen_photo_ids` and `main_photo_id`.

**For the later import:**
- **Every kept photo** (each id in `chosen_photo_ids`) becomes its own `species_media` row, with its licence and credit.
- **The main one** (`main_photo_id`) is marked primary.
- **SFC's own photos still take priority as main:** if a species already has (or later gets) an SFC photo, that photo is primary and the iNaturalist photos stay in the gallery as secondary reference photos.

## Review CSV columns

| Column | Meaning |
|---|---|
| `species_id` | Our `public.species.id` |
| `scientific_name` | Our scientific name |
| `inat_taxon_id` | iNaturalist taxon that matched the name exactly (blank = no exact match) |
| `original_photo_id` | iNaturalist photo id from the old website's URL |
| `original_licence` | That photo's licence: `cc0`, `cc-by`, `cc-by-sa`, `cc-by-nc`, `cc-by-nd`, `cc-by-nc-sa`, `cc-by-nc-nd` or `all-rights-reserved` (blank if unknown) |
| `original_attribution` | iNaturalist's credit text, e.g. "(c) Bernard DUPONT, some rights reserved (CC BY)" |
| `original_image_url` | The old website's image URL |
| `original_page_url` | The photo's page on iNaturalist (link to it in the credit) |
| `allowed` | `yes` only for CC0, CC BY or CC BY-SA. Everything else is `no` |
| `reason` | Why: see below |
| `alt1_*` … `alt3_*` | Only when `allowed = no`: up to 3 **allowed** photos of the same species. The species' own photos come first, then observation photos. Each has the 8 columns below |
| `altN_id` | iNaturalist photo id |
| `altN_licence` | That photo's own licence: `cc0`, `cc-by` or `cc-by-sa` |
| `altN_attribution` | iNaturalist's credit text for the photo. For CC0 photos this is just "no rights reserved" |
| `altN_photographer` | The observer's name (or user name) for observation photos, used in the credit because CC0 credit text has no name. Blank for the species' own photos, whose credit text already names the photographer |
| `altN_url` | The image (medium size) |
| `altN_page_url` | The photo's page on iNaturalist (link to it in the credit) |
| `altN_source` | Where it came from: `taxon_photo` (the species' own photos on iNaturalist), or `observation, Borneo` / `observation, Malaysia` / `observation, anywhere` (a research-grade observation found in that area) |
| `altN_observation_url` | For observation photos: the observation's page, to check it really is this species. Blank for the species' own photos |
| `officer_choice` | Filled in by an officer: `original` (only when `allowed = yes`), `alt1`, `alt2`, `alt3` or `none` |
| `officer_name` | Who made the choice |
| `officer_notes` | Optional, e.g. "alt1 shows the pitcher clearly" |

**`reason` values:**
- **`allowed`:** CC0, CC BY or CC BY-SA.
- **A licence code:** `cc-by-nc`, `cc-by-nd`, `cc-by-nc-sa` or `cc-by-nc-nd` means not allowed (non-commercial or no-derivatives).
- **`all_rights_reserved`:** the photographer gave no Creative Commons licence.
- **`unknown`:** the photo isn't one of the species' photos on iNaturalist, so its licence can't be confirmed. Excluded.
- **`no_taxon_match`:** no iNaturalist taxon has exactly this name (typo, synonym or subspecies). Check by hand.
- **`no_photo_id`:** the old URL had no photo id.
- **`lookup_failed`:** the API couldn't be reached. Run the script again.

**Rules for the officer:**
- **Alternatives:** an alternative is only used if an officer chooses it in `officer_choice`. Nothing is picked automatically.
- **Check the photo:** open the `page_url` (and `observation_url` for observation photos) to confirm the photo really shows this species and the licence on the page matches.
  - Research-grade observations of a species can include its subspecies or varieties, so check the name on the observation page.
- **Credits** will show the photographer, the licence (linked to the Creative Commons licence page) and "via iNaturalist" (linked to `page_url`).

## Import reviewed photos

Apply the `supabase/migrations/*_species_media_reference_sources.sql` migration in Supabase before running the importer. It adds source and attribution metadata to `species_media`, preserves existing rows as SFC photos, and adds a unique key for iNaturalist photo IDs. It does not change RLS.

The importer reads `species-photo-review-by-species-REVIEWED.csv` by default. It considers only IDs in `chosen_photo_ids`, verifies that each selected candidate has an allowed licence and attribution, and uses `main_photo_id` as the main choice.

### Dry run (default)

From the repository root:

```powershell
node scripts/species-photos/import-photos.mjs
```

Dry run reads the reviewed CSV and prints a plan. It does not make network requests, contact Supabase, download images, or write files. It cannot check existing imports or SFC primary photos; those are checked during apply.

Optional paths:

```powershell
node scripts/species-photos/import-photos.mjs --input path\to\reviewed.csv
node scripts/species-photos/import-photos.mjs --help
```

Use `--limit N` to cap a dry run or apply to N photos. When the limit excludes
photos, each chosen species' main photo is prioritized before additional photos:

```powershell
node scripts/species-photos/import-photos.mjs --limit 3
```

### Apply

The script uses Node's built-in `fetch` for Supabase REST and Storage APIs, plus the existing `sharp` dependency in `backend/package.json` to re-encode JPEG/PNG/WebP input as a JPEG like the photo-upload route. No package is added. If backend dependencies are not installed yet, run `npm ci --prefix backend` first.

Set the project URL and read the service-role key without echoing it:

```powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$secureKey = Read-Host -Prompt 'Supabase service-role key' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
```

Then apply:

```powershell
node scripts/species-photos/import-photos.mjs --apply
node scripts/species-photos/import-photos.mjs --apply --limit 3
```

Only `--apply` writes to Storage or `species_media`; it also writes the ignored `species-photo-import-results.csv` report. The service-role key is read only from the process environment and is never printed. The importer downloads only from `inaturalist-open-data.s3.amazonaws.com` or `static.inaturalist.org`, validates redirects and image contents, enforces a 5 MB limit, prefers the `large` URL variant with a `medium` fallback, and waits at least one second between download requests. All stored files use the existing `<species_id>/<uuid>.jpg` path pattern and JPEG content type.

If a species has an SFC primary photo, imported photos are kept secondary. Otherwise, the reviewed main photo is made primary. Existing iNaturalist rows are skipped, and unique-index conflicts are treated as already imported.

Remove the variables when finished:

```powershell
Remove-Item Env:SUPABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
Remove-Variable secureKey -ErrorAction SilentlyContinue
```
