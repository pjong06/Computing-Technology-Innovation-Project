# Demo plant details

`fill.mjs` fills the **empty** plant detail fields of every active plant with plausible demo
values. `remove.mjs` takes exactly those values out again. Values a botanist entered are never
changed.

| Shown as | Stored in | Marked by |
|---|---|---|
| Location note, Morphological characteristics, Notes | `plants.location_description`, `morphology`, `description` | `plants.demo_values` (field → generated value) |
| Height (m), Diameter (cm), Health, Life stage | one **approved** observation per plant, dated before today | `observations.is_demo = true` |
| Coordinates (map, plant details) | `plants.location` and `gps_accuracy_m`, only for plants with **no** location | `plants.demo_values.coordinates` |

The demo observation only carries fields that none of the plant's observations has. Because it
is approved, it never enters the Review queue. Values follow the species' growth form (trees
tall and thick; herbs, ferns, orchids and climbers small). Health is mostly Healthy and life
stage mostly Mature, with some variety. Values that a botanist already recorded (for example
"mature") are respected. The same plant always gets the same values, so the dry-run report
matches what `--apply` writes.

**Coordinates** are placed inside Niah National Park, around the plank walk and Great Cave
(latitude 3.80-3.83, longitude 113.76-113.80), with a GPS accuracy of 8-15 m. The area is split
into six parts, Zones A-C in the north row and D-F in the south row (west to east), and a plant
whose location note names a zone is placed in that zone's part. Each demo point is at least 20 m
from every other plant, so map markers don't overlap. Real coordinates are never moved.

**The check:** the report also lists, for every active plant, each detail it would still be
missing after the fill (coordinates, location note, height, diameter, health, life stage,
morphology, notes), with the reason. Height, diameter, health and life stage count only from an
approved observation. Typical reasons: the plant has no botanist (see below), or the value is
only on an observation that isn't approved yet.

**Mosses and liverworts** have no stem, so their diameter is the width of the clump or cushion
(2-5 cm when young, up to 15 cm when established). A plant that already has a demo observation
from an earlier run gets the missing fields added to that observation (still `is_demo = true`),
so `remove.mjs` takes them out with it.

Apply `supabase/migrations/20261121200000_demo_plant_details.sql` and
`20261121220000_demo_plant_coordinates.sql` first. They add both flags and let the service role
write only these columns.

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
  a plant field only if it still holds the generated value, and the location only while the plant
  is still at the generated point; a value someone changed since is kept and listed.
- **Reports:** the CSV reports are git-ignored.
