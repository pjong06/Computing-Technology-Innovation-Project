# Plan: species reference photos from the old website backup

Status: plan only. Nothing has been changed in code or the database.
Date: 2026-11-12.

## Goal

About 174 species were copied from the old website table into `public.species`, but their photos were not.

The read-only backup `public.website_species_backup_20261106` (279 rows) has an iNaturalist image URL in `photo` for every row.

We want to bring those photos back **only where the photographer's licence allows it**:
- **Allowed:** CC0, CC BY, CC BY-SA, always shown with attribution.
- **Excluded:** CC BY-NC, CC BY-NC-SA, CC BY-NC-ND, CC BY-ND, all rights reserved, and anything whose licence we cannot confirm.

---

## 1. How species photos work today

### Table `public.species_media`

- **Schema:** the base table was made in the Supabase dashboard, so its `CREATE TABLE` isn't in the repo. The columns the code uses are `id`, `species_id`, `uploaded_by`, `file_path`, `media_type`, `is_primary` (see `backend/src/routes/knowledge.js`, `POST /species/:id/photos`).
- **`file_path`** is a path inside the private Storage bucket `species-media`, such as `<species_id>/<uuid>.jpg`. It is not a URL.
- **Bucket `species-media`:**
  - `public = false`, 10 MB per file, JPEG only (`supabase/migrations/20261013074845_knowledge_api_setup.sql:177-182`).
  - Files are readable by anon only when a `species_media` row with that `file_path` belongs to an approved species (same migration, ~lines 215-230).
- **One primary photo per species:**
  - Enforced by the unique index `one_primary_photo_per_species` (`… WHERE is_primary = true`).
  - Switched with the RPC `set_primary_species_photo(species_id, photo_id)`.
- **Row-level security:** officers manage photos; anon, botanists and researchers can read photos of approved species (same migration, ~lines 59-120).

### How photos are added

- **Route:** officer only, `POST /api/knowledge/species/:id/photos`.
- **Approved species only:** it refuses unapproved species (409).
- **Processing:** it re-encodes the upload with `sharp` (rotate, fit inside 2000×2000, JPEG quality 85, metadata stripped). It then stores the file and inserts a row with `is_primary = false`.
- **Primary:** making a photo primary is a separate call, `PATCH …/photos/:photoId/primary`.

### How photos are shown

- **Web** (`frontend/js/species.js`, `editor.js`):
  - The catalogue list includes `species_media(id, is_primary)`.
  - For each card, `speciesPhotoUrl()` in `frontend/js/shared.js` picks the primary photo (or the first one). It then calls `GET /api/knowledge/species/:id/photos/:photoId`, which returns a signed URL that lasts 60 seconds.
  - The portal (`/portal`) sends no Content-Security-Policy header today, so images from any HTTPS host would load.
- **App** (`niah-biotrack/src/services/speciesImageCache.ts`):
  - `cachePrimarySpeciesImage()` picks the primary photo (or the first one), asks for the signed URL (`src/api/species.ts:153`), downloads the file and saves it under `species-reference-images/` so it also works offline.
  - It is shown on Home, the Plants guide, Species reference `[id]` and `plant-info` (`useSpeciesStore().imageUrisBySpeciesId`).
- **Public QR page** (`/p/:tag`, `backend/src/routes/publicPlants.js`): shows no images. Its CSP is `default-src 'none'`.

### Can `species_media` hold an external photo with a licence?

No:
- There is nowhere to record source, licence or attribution.
- Every row is assumed to be a file in our bucket.

New columns are needed. The SQL below is a proposal only; don't run it until the plan is agreed.

```sql
-- Proposed: supabase/migrations/<timestamp>_species_media_reference_sources.sql
BEGIN;

ALTER TABLE public.species_media
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'sfc',     -- 'sfc' = our own photo
    ADD COLUMN IF NOT EXISTS source_photo_id bigint,                  -- iNaturalist photo id
    ADD COLUMN IF NOT EXISTS source_url text,                         -- https://www.inaturalist.org/photos/<id>
    ADD COLUMN IF NOT EXISTS licence_code text,                       -- 'cc0' | 'cc-by' | 'cc-by-sa'
    ADD COLUMN IF NOT EXISTS attribution text,                        -- iNaturalist's attribution text, as given
    ADD COLUMN IF NOT EXISTS imported_at timestamptz;

ALTER TABLE public.species_media
    ADD CONSTRAINT species_media_source_check
        CHECK (source IN ('sfc', 'inaturalist')),
    -- A reference photo must carry an allowed licence and a credit; our own photos carry none.
    ADD CONSTRAINT species_media_reference_licence_check
        CHECK (
            (source = 'sfc' AND licence_code IS NULL)
            OR (source = 'inaturalist'
                AND licence_code IN ('cc0', 'cc-by', 'cc-by-sa')
                AND attribution IS NOT NULL AND btrim(attribution) <> ''
                AND source_photo_id IS NOT NULL
                AND source_url IS NOT NULL)
        );

-- Running the import twice must not add the same photo twice.
CREATE UNIQUE INDEX IF NOT EXISTS species_media_source_photo_key
    ON public.species_media (species_id, source, source_photo_id)
    WHERE source_photo_id IS NOT NULL;

COMMIT;
```

- **Option B (recommended):** keeps `file_path` as it is; reference photos are files in our bucket too.
- **Option A only:** would also need `ADD COLUMN external_url text` and `file_path` made nullable, plus a check that exactly one of `file_path` / `external_url` is set.
- **Existing rows** become `source = 'sfc'` by default. No row-level security change is needed: the new columns follow the existing row rules, and attribution is meant to be public.

---

## 2. Matching backup rows to `public.species`

Match on the scientific name with case, surrounding spaces and repeated spaces ignored. The backup has more rows than there are species (279 vs about 174) because the old website kept one row per species *and location*. So duplicates are expected, and the question is how many *different photos* each species has.

Read-only SQL to run in the Supabase SQL Editor:

```sql
-- Normalised names on both sides
WITH b AS (
    SELECT id AS backup_id,
           lower(regexp_replace(btrim(scientific_name), '\s+', ' ', 'g')) AS name_key,
           photo,
           substring(photo FROM '/photos/([0-9]+)/')::bigint AS inat_photo_id,
           CASE
               WHEN photo ILIKE 'https://inaturalist-open-data.s3.amazonaws.com/%' THEN 'open-data'
               WHEN photo ILIKE 'https://static.inaturalist.org/%'               THEN 'static'
               ELSE 'other'
           END AS host
    FROM public.website_species_backup_20261106
),
s AS (
    SELECT id AS species_id, verification_status,
           lower(regexp_replace(btrim(scientific_name), '\s+', ' ', 'g')) AS name_key
    FROM public.species
)
-- A) Overall numbers
SELECT
    (SELECT count(*) FROM b)                                              AS backup_rows,
    (SELECT count(DISTINCT name_key) FROM b)                              AS backup_distinct_names,
    (SELECT count(*) FROM b WHERE inat_photo_id IS NULL)                  AS rows_without_photo_id,
    (SELECT count(DISTINCT b.name_key) FROM b JOIN s USING (name_key))    AS names_matched,
    (SELECT count(DISTINCT b.name_key) FROM b LEFT JOIN s USING (name_key)
        WHERE s.species_id IS NULL)                                       AS names_not_matched,
    (SELECT count(*) FROM (SELECT name_key FROM s GROUP BY name_key HAVING count(*) > 1) d)
                                                                          AS species_names_duplicated_in_species,
    (SELECT count(*) FROM (SELECT name_key FROM b GROUP BY name_key HAVING count(DISTINCT inat_photo_id) > 1) d)
                                                                          AS names_with_several_different_photos;
```

```sql
-- B) Backup names with no species (to fix by hand: typos, synonyms, subspecies)
SELECT DISTINCT b.scientific_name
FROM public.website_species_backup_20261106 b
LEFT JOIN public.species s
  ON lower(regexp_replace(btrim(s.scientific_name), '\s+', ' ', 'g'))
   = lower(regexp_replace(btrim(b.scientific_name), '\s+', ' ', 'g'))
WHERE s.id IS NULL
ORDER BY 1;

-- C) Per species: how many backup rows and different photos, and where they are hosted
SELECT s.scientific_name, s.verification_status,
       count(*)                                                       AS backup_rows,
       count(DISTINCT substring(b.photo FROM '/photos/([0-9]+)/'))    AS different_photos,
       count(*) FILTER (WHERE b.photo ILIKE 'https://inaturalist-open-data.s3.amazonaws.com/%') AS open_data_rows,
       count(*) FILTER (WHERE b.photo ILIKE 'https://static.inaturalist.org/%')                 AS static_rows,
       (SELECT count(*) FROM public.species_media m WHERE m.species_id = s.id)                  AS photos_we_have
FROM public.species s
JOIN public.website_species_backup_20261106 b
  ON lower(regexp_replace(btrim(s.scientific_name), '\s+', ' ', 'g'))
   = lower(regexp_replace(btrim(b.scientific_name), '\s+', ' ', 'g'))
GROUP BY s.id, s.scientific_name, s.verification_status
ORDER BY different_photos DESC, s.scientific_name;

-- D) The list the licence script needs: one line per (species, iNaturalist photo id)
SELECT DISTINCT s.id AS species_id, s.scientific_name,
       substring(b.photo FROM '/photos/([0-9]+)/')::bigint AS inat_photo_id,
       b.photo AS backup_url
FROM public.species s
JOIN public.website_species_backup_20261106 b
  ON lower(regexp_replace(btrim(s.scientific_name), '\s+', ' ', 'g'))
   = lower(regexp_replace(btrim(b.scientific_name), '\s+', ' ', 'g'))
WHERE s.verification_status = 'approved'
ORDER BY s.scientific_name;
```

**Notes:**
- **Hosts:** photos on `inaturalist-open-data.s3.amazonaws.com` are in iNaturalist's open-data bucket, which only holds Creative Commons-licensed photos (some of them NC). Photos on `static.inaturalist.org` are usually all rights reserved. The host is only a hint; the script below checks every photo's licence.
- **Unapproved species:** only approved species can have photos (the upload route refuses others), so query D is limited to approved species.
- **Exporting:** export query D as CSV from the SQL Editor. It contains no secrets.

---

## 3. Getting each photo's licence and attribution from iNaturalist

### What works

I checked this on 2026-11-12.
- **No single-photo endpoint:** iNaturalist has no public endpoint for one photo by id. `GET https://api.inaturalist.org/v1/photos/<id>` and `https://www.inaturalist.org/photos/<id>.json` both return 404, and `/v1/observations?photo_id=…` ignores the filter.
- **The taxa API has what we need.** The backup URLs are taxon "default photos", and the public taxa endpoints return them with licence and credit:
  - `GET https://api.inaturalist.org/v1/taxa?q=<scientific name>&rank=species&per_page=5` gives the taxon id and `default_photo` (`id`, `license_code`, `attribution`, `medium_url`).
  - `GET https://api.inaturalist.org/v1/taxa/<id1>,<id2>,…` (up to 30 ids per call) gives `taxon_photos[]`, where each `photo` has `id`, `license_code`, `attribution`, `medium_url` and `original_dimensions`.
  - **Example:** for *Nepenthes ampullaria* (taxon 346348), the default photo 258612549 is `cc-by-nc` ("(c) Tomáš Hovorka, some rights reserved (CC BY-NC)") and therefore **excluded**. Photo 139694725 of the same taxon is `cc-by` ("(c) Bernard DUPONT, some rights reserved (CC BY)") and **allowed**. Photo 94121407 has `license_code: null` ("all rights reserved") and is **excluded**.
- **`license_code` values** are lower case: `cc0`, `cc-by`, `cc-by-sa`, `cc-by-nc`, `cc-by-nd`, `cc-by-nc-sa`, `cc-by-nc-nd`, or `null` (all rights reserved).

### Rate limits

iNaturalist asks API users to stay at or below about **60 requests per minute (1 per second)** and about 10,000 a day. Media downloads should stay well under 5 GB an hour or 24 GB a day, or the client may be blocked. Their "API Recommended Practices" page refused automated access (403) when I checked, so confirm these figures in a browser before running anything.
- **Our load:** about 174 species means about 174 name searches plus about 6 batched taxon calls, so about 180 requests in total. At 1 per second that takes about 3-4 minutes.
- **Downloads (option B):** about 174 "medium" images of about 50-150 KB each, so about 25 MB.

### Proposed one-off script

Describe now; write later on request. It would be `scripts/inat-licence-check.mjs`, outside `backend/` and the app.
- **Runs:** locally by Phoebe with Node 18 or newer, which has built-in `fetch`. No npm packages.
- **Input:** the CSV from query D (`species_id, scientific_name, inat_photo_id, backup_url`), passed as a file path. It reads no `.env` files and no secrets, and needs no login (these are public API calls).
- **Steps:**
  1. For each distinct scientific name: `GET /v1/taxa?q=<name>&rank=species,subspecies,variety&per_page=5`. Keep the result whose `name` matches exactly (ignoring case). If nothing matches, mark the row `no_taxon_match`.
  2. Batch the taxon ids, 30 per call: `GET /v1/taxa/<ids>`. Collect every taxon photo.
  3. For each backup row, find the photo whose `id` equals `inat_photo_id` (in `default_photo` or `taxon_photos`).
     - **Found:** record `license_code` and `attribution` from iNaturalist.
     - **Not found:** set the licence to `unknown`, which is excluded.
  4. Set `allowed = yes` only when `license_code` is `cc0`, `cc-by` or `cc-by-sa`.
  5. **Optional replacement:** when the backup photo isn't allowed, list the first allowed photo of the same taxon as a *suggestion* (`suggested_photo_id`, licence, credit). An officer decides whether to use it; it is never imported automatically.
- **Politeness:**
  - one request at a time, at least 1.1 seconds apart;
  - a clear `User-Agent` such as `NiahBioTrack-licence-check/1.0 (Swinburne capstone)`, with no personal email;
  - on HTTP 429 or 5xx, wait 60 seconds and retry up to 3 times;
  - responses saved under `.cache/`, so a re-run doesn't call the API again.
- **Output:** `inat-licences.csv` and `.json` with these columns:
  - `species_id, scientific_name, inat_photo_id, backup_url`
  - `taxon_id, license_code, attribution, photo_page_url (https://www.inaturalist.org/photos/<id>), medium_url`
  - `allowed (yes/no), reason (allowed | cc-by-nc | cc-by-nd | all_rights_reserved | unknown | no_taxon_match)`
  - `suggested_photo_id, suggested_license_code, suggested_attribution`
- **Summary at the end:** totals for allowed, excluded by licence type, unknown, and no match.

The CSV is then reviewed by a person before anything is imported.

---

## 4. Two ways to store allowed photos

| | **A. Store the external URL (hotlink)** | **B. Download and upload to our bucket (recommended)** |
|---|---|---|
| What's stored | A `species_media` row with `external_url`, licence and attribution; no file | A JPEG in `species-media` via the existing upload code path, plus a row with `source = 'inaturalist'`, licence and attribution |
| Code changes | Larger: `file_path` becomes nullable; web, app and backend must handle two kinds of rows (signed URL vs plain URL) | Smaller: same storage, signed URLs and offline cache as today; only new columns and captions |
| Availability | Breaks if the photographer deletes the photo, iNaturalist moves files, or AWS/iNaturalist is slow or blocked (for example a school or park network) | Under our control; works offline in the app once cached |
| Licence | CC licences can't be withdrawn for copies already obtained, but with a hotlink we always show *their current file*. If the owner changes it, we show something we never checked | We keep the exact copy we checked, with its licence and credit recorded at import time. CC0/BY/BY-SA all allow copying and redistribution with credit |
| Changes to the image | None | Our upload route resizes and re-encodes (`sharp`). Resizing or changing the format is not an "adaptation" under CC 4.0, so CC BY-SA "share alike" isn't triggered. Never crop, filter or add watermarks. Say "resized" in the credit to be safe |
| Privacy / security | Every page view sends the viewer's IP address to iNaturalist/AWS. The portal has no CSP today; if one is added later, `img-src` must allow those hosts. The app would need network access to show them, with no offline view unless the cache code changes | No third-party requests when viewing. Fits the private-bucket model and a future strict CSP |
| iNaturalist's preferences | They discourage heavy hotlinking of `static.inaturalist.org` | One small download of about 25 MB, well within their limits |
| Storage cost | None | About 25 MB in Supabase Storage |

**Recommendation: option B.** It keeps one way of showing photos (private bucket, signed URL, app cache), works offline in the field, keeps a fixed record of the licence we checked, and sends nothing about our users to third parties.

**How B would run:** a second one-off script, or an officer-only "Import reference photos" admin action. Either way it takes the reviewed CSV (`allowed = yes` only) and, for each row:
1. downloads `medium_url`;
2. uploads it through the **existing** officer route `POST /api/knowledge/species/:id/photos` with the source fields added;
3. never makes it primary if the species already has an SFC photo.

The officer's login token would be typed or pasted when the script runs, never stored in the repo.

---

## 5. UI changes

- **Credit line** shown wherever a reference photo is shown at a readable size:
  - Wording: **"Photo: <name>, <licence>, via iNaturalist"**, for example "Photo: Bernard DUPONT, CC BY 4.0, via iNaturalist".
  - Links: the name/"iNaturalist" links to `source_url` (the photo page), and the licence links to the licence page (`https://creativecommons.org/licenses/by/4.0/` etc.). Add ", resized" if we keep the re-encode.
  - Text source: take the photographer's name from iNaturalist's `attribution` text (the part after "(c) " and before the first comma), and keep the full original text in `attribution` too.
  - CC0: show "Photo: <name>, CC0 (public domain), via iNaturalist". Not legally required, but polite and consistent.
- **SFC's own photos come first:**
  - The API sorts SFC photos before reference photos, and only an SFC photo can be primary when one exists.
  - When an officer uploads the first SFC photo, it becomes primary (replacing a reference primary). The reference photo stays as a secondary photo, still credited.
  - This needs a small change in the upload/primary logic. Today a new upload becomes primary only when the species has no photo at all (`frontend/js/editor.js`).
- **Backend:** `GET /api/knowledge/species`, `/species/:id` and `/species/manage` add `source, licence_code, attribution, source_url` to the `species_media` they return. These are public facts and fine for anon.
- **Web portal:**
  - `species.js`: a small credit line under the card photo.
  - `editor.js`: a credit line under the preview, plus a "Reference photo" badge, so officers can tell it isn't an SFC photo.
- **App:**
  - `species-reference/[id].tsx` and `plant-info.tsx`: a credit line under the photo, with tappable links.
  - Home and Plants guide thumbnails are too small for a caption. Add a "Photo credits" line on the species detail screen and a "Photo credits" screen under Profile listing every reference photo used.
  - `useSpeciesStore` must keep the credit fields together with the cached image, so credits also show offline.

---

## 6. Risks and test plan

### Risks
- **Wrong species:** synonyms, subspecies or typos could match the wrong taxon. *Mitigation:* exact name match only; anything unclear is `no_taxon_match`; a person reviews the CSV.
- **The backup photo isn't the taxon's photo** (for example an observation photo): its licence can't be confirmed. *Mitigation:* mark it `unknown` and exclude it. Never guess.
- **Licence or credit changes later on iNaturalist.** *Mitigation (B):* store the licence and credit as they were at import and keep the CSV as a record. Re-checking periodically is optional.
- **Fewer photos than hoped:** many iNaturalist photos are NC or all rights reserved. *Mitigation:* offer the "suggested allowed photo" for officer approval, and encourage SFC field photos.
- **Rate limiting or blocking.** *Mitigation:* 1 request per second, cache, retry with back-off, about 180 calls in total.
- **Credit missing somewhere in the UI** (a licence breach). *Mitigation:* a guard test that every place showing a species photo also shows the credit, plus a database constraint that a reference row always has a licence and credit.
- **Running the import twice.** *Mitigation:* the unique index on `(species_id, source, source_photo_id)`.
- **Rollback:** `DELETE FROM species_media WHERE source = 'inaturalist'`, remove those files from Storage, and drop the columns if needed. SFC photos are untouched.

### Test plan
1. **SQL dry run:** run section 2's queries, write down the matched / unmatched / duplicate counts, and fix the unmatched names by hand where it's safe.
2. **Licence script dry run** on 5 known species, including *Nepenthes ampullaria*. Expected: 258612549 is excluded (NC), 139694725 is allowed (CC BY), 94121407 is excluded (all rights reserved), and an unknown id is excluded.
3. **Human review** of the CSV. Spot-check 10 rows by opening `https://www.inaturalist.org/photos/<id>` and comparing the licence shown there.
4. **Migration on a branch database**, if available, then on production:
   - an `inaturalist` row without a licence must fail;
   - an `sfc` row with a licence must fail;
   - re-importing the same photo must fail on the unique index.
5. **Backend tests** (`backend/test/`):
   - the species list and detail return the credit fields;
   - SFC photos sort first;
   - an SFC upload becomes primary over a reference photo;
   - only officers can import.
6. **Guard tests:** `species.js`, `editor.js`, `species-reference/[id].tsx` and `plant-info.tsx` render the credit text whenever `source = 'inaturalist'`.
7. **Manual check:**
   - web catalogue and editor show the photo and credit, and the links open the right iNaturalist and licence pages;
   - the app shows the credit online and in airplane mode after caching;
   - the "Photo credits" screen lists every reference photo;
   - a species with an SFC photo shows the SFC photo first.
8. **Rollback rehearsal:** delete the imported rows and files on the test database, and confirm SFC photos and the catalogue are unaffected.

---

## Decisions needed from Phoebe

1. Option B (recommended) or A.
2. Whether officers may use "suggested allowed photo" replacements when the backup photo isn't allowed.
3. Whether to add ", resized" to every credit.
4. Whether the import runs as a local script (with an officer token typed at run time) or as an officer-only admin action in the portal.
