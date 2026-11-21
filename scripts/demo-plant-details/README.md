# Demo plant details

`fill.mjs` fills the **empty** plant detail fields of every active plant with plausible demo
values. `remove.mjs` takes exactly those values out again. Values a botanist entered are never
changed.

| Shown as | Stored in | Marked by |
|---|---|---|
| Location note, Morphological characteristics, Notes | `plants.location_description`, `morphology`, `description` | `plants.demo_values` (field → generated value) |
| Height (m), Diameter (cm), Health, Life stage | one **approved** observation per plant, dated before today | `observations.is_demo = true` |

The demo observation only carries fields that none of the plant's observations has. Because it
is approved, it never enters the Review queue. Values follow the species' growth form (trees
tall and thick; herbs, ferns, orchids and climbers small). Health is mostly Healthy and life
stage mostly Mature, with some variety. Values that a botanist already recorded (for example
"mature") are respected. The same plant always gets the same values, so the dry-run report
matches what `--apply` writes.

Apply `supabase/migrations/20261121200000_demo_plant_details.sql` first. It adds both flags and
lets the service role write only these columns.

```powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$secureKey = Read-Host -Prompt 'Supabase service-role key' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
node scripts/demo-plant-details/fill.mjs            # dry run: demo-plant-details-report.csv
node scripts/demo-plant-details/fill.mjs --apply
node scripts/demo-plant-details/remove.mjs          # dry run: demo-plant-details-removal-report.csv
node scripts/demo-plant-details/remove.mjs --apply
Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY
```

- **Plants with no registering botanist** (for example imported ones): there is nobody to
  record a demo observation under, so their height, diameter, health and life stage are listed
  as skipped. To fill them anyway, pass `--observer <profile id>` (for example an officer's id).
- **Removal is exact:** `remove.mjs` deletes only observations with `is_demo = true`. It empties
  a plant field only if it still holds the generated value; a value someone changed since is
  kept and listed.
- **Reports:** the CSV reports are git-ignored.
