# Plants without a physical NIAH-PLT tag

`assign-tags.mjs` lists every active plant whose tag isn't `NIAH-PLT-<5 digits>`, with the
reason a tag lookup fails for it, in `plant-tags-report.csv`. Columns: plant id, old tag,
new tag (empty for now), kind, status, source, registered at, why lookup fails, action.

```powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$secureKey = Read-Host -Prompt 'Supabase service-role key' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
node scripts/plant-tags/assign-tags.mjs
Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY
```

The script needs read access to `public.plants` for the service role
(`supabase/migrations/20261121130000_service_role_read_plants.sql`).

## Where the odd tags come from

- **`plant:<id>`**: a plant registered without a physical tag gets this placeholder, so
  `qr_code_value` is never empty. This happens in `POST /api/plants` and in the offline sync
  function. The botanist replaces it with "Attach tag" on the phone. No QR code carries it, and
  `GET /api/plants/tag/:tag` refuses it (400).
- **Other spellings** (for example lower case): tag lookups now normalise what is typed
  (`niahplt00015` becomes `NIAH-PLT-00015`), but a stored value that isn't in the standard form
  still doesn't match.

## Why there is no `--apply` yet

The existing functions keep tag numbers unique, but they only work for the signed-in botanist
who owns the plant (`supabase/migrations/20261031090000_tag_reservations.sql`):

- `reserve_plant_tags` and `attach_reserved_plant_tag` refuse callers without a botanist
  `auth.uid()`.
- The `plants_require_reserved_tag` trigger refuses any new physical tag set by anyone but the
  owning botanist.

The service-role key has no `auth.uid()`, so both refuse it. Options:

1. **Botanists attach tags themselves** (no change): each owner uses "Attach tag" in the app.
   This only works for plants that have a botanist owner, not imported ones.
2. **A narrow officer function** (a migration): an officer-only `SECURITY DEFINER` function
   that reserves the next free number and binds it to a plant that still has a placeholder.
   It needs a matching exception in the trigger for that function only. The script would then
   run as an officer, not with the service role.
3. **A service-role-only migration**: the same function, but callable by `service_role` only,
   used by this script.
