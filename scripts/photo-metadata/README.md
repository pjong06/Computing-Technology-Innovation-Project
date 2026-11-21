# Plant photo metadata and visitor photos

Photos from phones carry metadata, including the GPS position in EXIF. Everything stored or
shown to visitors must be free of it.

- **New uploads:** the backend re-encodes every plant and observation photo as a JPEG
  without metadata before storing it (`backend/src/services/photoSanitizer.js`).
- **Photos already stored:** `strip-plant-photos.mjs` cleans them in place.
- **Visitors:** they never read the originals. They get a stripped public copy (at most 1200 px)
  through `GET /p/:tag/photo`, and only while the plant is on the public QR page.

## Rollout, in this order

1. **Deploy the backend.** New uploads are stripped from then on.
2. **Clean the stored plant photos.** This runs locally with the service role key, from the
   environment only. It needs `20261121120000_plant_media_inaturalist_source.sql` (SELECT on
   `plant_media` for the service role) applied.

   ```powershell
   $env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
   $secureKey = Read-Host -Prompt 'Supabase service-role key' -AsSecureString
   $env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
   node scripts/photo-metadata/strip-plant-photos.mjs              # dry run: report only
   node scripts/photo-metadata/strip-plant-photos.mjs --apply      # re-encode in place
   Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY
   ```

   - **Dry run:** downloads each file and writes `strip-plant-photos-report.csv` (one row per
     photo: format, metadata found, action), changing nothing.
   - **`--apply`:** overwrites only files that have metadata (or aren't JPEG), at the same path,
     so `plant_media` rows stay valid.
   - **`--limit N`:** tries a few first.
   - **Safe to run again:** clean files are skipped.
3. **Apply `supabase/migrations/20261121150000_public_plant_photos.sql`.** It creates the
   `public-plant-photos` bucket (anyone may read it, only officers may write it, files named
   `NIAH-PLT-00000.jpg`) and `public_species_photo_tags()` for the visitor species cards. The
   private `plant-media` bucket and its policies are unchanged.
4. **Publish copies for the plants that are already public.** As an officer, signed in to the
   web portal, open the browser console on any portal page and run:

   ```js
   await api('/officer/plants/public-photos/refresh', { method: 'POST' })
   ```

   It writes a copy for every plant on the public QR page and removes copies of plants that
   aren't public any more. It answers `{ published, removed, skipped }`. It works through the
   plants one at a time, so give it time when there are many.

After that, copies are kept up to date when an officer approves or rejects a visit, hides or
restores one, or deletes a plant. Run step 4 again after changes made elsewhere, for example
archiving a species, changing a public plant's tag, or attaching iNaturalist photos with the
import script.
