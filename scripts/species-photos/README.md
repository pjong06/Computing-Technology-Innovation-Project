# Species reference photos: licence check

Steps 1-2 of `docs/species-photo-import-plan.md`.
- Find which old website photos we may legally use.
- Suggest allowed alternatives for the rest.

This step **doesn't import anything**: the migration, import script and UI come later.

## What's here

| File | What it is |
|---|---|
| `matching-queries.sql` | Read-only SQL for the Supabase SQL Editor. Q1-Q4 give counts and unmatched names; Q5 exports the input list. |
| `lookup-licences.mjs` | One-off Node script that asks the public iNaturalist API for each photo's licence and credit. |
| `species-photo-list.csv` | **Input** you export from Q5. Ignored by git. |
| `species-photo-review.csv` | **Output** for an officer to review. Ignored by git. |
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

4. Open `species-photo-review.csv` in Excel or Google Sheets. An officer fills in `officer_choice` for every row (see below).

### How the script behaves
- **Rate:** at most **1 request per second**, one at a time, with the User-Agent `NiahBioTrack-species-photo-licence-check/1.0 (...)`. About 174 species is about 180 requests, roughly 3-4 minutes.
- **What it calls:** only `GET https://api.inaturalist.org/v1/taxa?q=<name>` (find the species) and `GET https://api.inaturalist.org/v1/taxa/<up to 30 ids>` (that species' photos with licence and credit). iNaturalist has no "one photo by id" endpoint.
- **Errors:**
  - HTTP 429, 5xx and network errors are retried up to 3 times, waiting 60 s, 120 s, 180 s or as long as `Retry-After` asks;
  - other errors are not retried, and the row is marked `lookup_failed`.
- **Resume:** every successful answer is saved in `.cache/`. If the run stops (Ctrl+C, no signal, rate limit), just run it again: finished requests aren't repeated.
- **Exit code:** 0 when everything was looked up, 2 when some lookups failed (run again).
- **Safety:** it reads only the input CSV and its own cache. No `.env`, no secrets, no login. It never touches our database or storage.

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
| `alt1_*` … `alt3_*` | Only when `allowed = no`: up to 3 **allowed** photos of the same species. Each has `id`, `licence`, `attribution`, `url` (image) and `page_url` (iNaturalist page) |
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
- **Check the photo:** open the `page_url` to confirm the photo really shows this species and the licence on the page matches.
- **Credits** will show the photographer, the licence (linked to the Creative Commons licence page) and "via iNaturalist" (linked to `page_url`).
