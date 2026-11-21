# Plant sighting photos for imported iNaturalist plants

`attach-photos.mjs` gives each imported plant (`plants.data_source = 'inaturalist'`) its own sighting photo as its main plant photo, instead of only the species photo.

- **Credits:** plant photos never show a credit, licence text or info icon in the app, on the web or on the visitor page.
- **Where credits appear:** only on the web **Photo credits** page (`frontend/credits.html`, "Plant photos" table).

## Before you start

1. Apply `supabase/migrations/20261121120000_plant_media_inaturalist_source.sql`. It adds the source and licence columns to `plant_media` and lets the service role insert. RLS is unchanged.
2. Copy `NiahNationalParkPlants.csv` (the iNaturalist export) to `scripts/species-photos/NiahNationalParkPlants.csv`, or pass `--sightings <file>`.
3. Install the backend dependencies (`npm ci --prefix backend`). The script uses the backend's `sharp` to resize; no new package.

## Run

Set the variables without echoing the key:

```powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$secureKey = Read-Host -Prompt 'Supabase service-role key' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
```

**Dry run (default).** It reads the plants and checks every licence on iNaturalist. It downloads, uploads and inserts nothing. Check the report first.

```powershell
node scripts/inat-plant-photos/attach-photos.mjs
```

**Apply.** This downloads, resizes, uploads and inserts. Try a few first:

```powershell
node scripts/inat-plant-photos/attach-photos.mjs --apply --limit 3
node scripts/inat-plant-photos/attach-photos.mjs --apply
```

**Options:**
- `--limit N`: attach (or plan) at most N photos.
- `--report FILE`: where the report goes (default `scripts/inat-plant-photos/inat-plant-photo-report.csv`).
- `--cache DIR`: where the cache goes (default `scripts/inat-plant-photos/.cache/`).
- `--sightings FILE`: the iNaturalist export to match against.

**Dry run without the key.** Export the plants in the SQL Editor, save the result as a CSV, and pass it with `--plants FILE`. Existing photos are not checked in this mode.

```sql
SELECT p.id, p.qr_code_value, s.scientific_name, p.source_url, m.latitude, m.longitude, p.registered_by
FROM public.plants p
LEFT JOIN public.species s ON s.id = p.species_id
LEFT JOIN public.plant_map_points m ON m.id = p.id
WHERE p.data_source = 'inaturalist' AND p.deleted_at IS NULL
ORDER BY p.qr_code_value;
```

Remove the variables afterwards:

```powershell
Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
Remove-Variable secureKey -ErrorAction SilentlyContinue
```

## What it does

1. **Match** each plant to one sighting:
   - first by `plants.source_url` (the observation URL or id). An id that isn't in the CSV is still used: the photo is read from iNaturalist by that id;
   - otherwise by the same species (scientific name, ignoring case) within **2 m**, using the public or private coordinates;
   - a tie (two sightings equally near) is skipped as ambiguous, and each sighting is used for one plant only.
2. **Photo and licence:** it reads the observation from the iNaturalist API (`GET /v1/observations?id=...`, 30 per request). It uses the CSV's photo if it is on the observation, otherwise the first photo.
   - The photo's **own** licence decides. The CSV `license` column is the observation's, and it can differ: some CC BY observations have "all rights reserved" photos.
   - Allowed: `cc0`, `cc-by`, `cc-by-sa`, `cc-by-nc`. Anything else, or no licence, is skipped and listed at the end of the run.
   - Hidden or flagged photos are skipped.
3. **Download** (apply only), from `inaturalist-open-data.s3.amazonaws.com` or `static.inaturalist.org` only. Redirects to any other host are refused. It takes the `large` size, falling back to `medium`.
4. **Resize and upload:** the photo is re-encoded as a JPEG of at most 1600 px, which also drops embedded GPS. It is uploaded to the `plant-media` bucket as `<registered_by>/<plant_id>/<uuid>.jpg`.
5. **Insert** a `plant_media` row with:
   - `photo_type = 'whole_plant'`;
   - `is_primary = true`, unless the plant already has a main photo;
   - `source = 'inaturalist'`, `source_photo_id`, `source_url` (the photo's page), `licence_code`, `attribution`, `photographer`, `imported_at`.

**Safety and resuming:**
- **Rate:** at most one iNaturalist request a second (API and images), with a generic User-Agent. 429/5xx answers are retried after 60, 120 or 180 s, or as long as `Retry-After` asks.
- **Resumable:** observations are cached in `.cache/`. Photos already attached are skipped, and the unique index stops duplicates. Re-running is safe.
- **Secrets:** the key is read from the environment only and never printed. No `.env` is read.

## Report

`inat-plant-photo-report.csv` has one row per plant, followed by `TOTAL` rows per action. The columns are:
- `plant_id`, `tag`, `species`;
- `matched_sighting`, `match_method`;
- `photo_id`, `licence`;
- `action`: `attached`, `would attach` (dry run), `skipped` or `failed`;
- `reason`.
