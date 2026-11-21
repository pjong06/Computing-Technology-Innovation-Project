# Clean species text

`clean.mjs` removes leftover photo credits, sources and links from species **description**,
**habitat** and **distribution notes** in the database. It uses the same rules the backend
applies whenever species text is shown (`backend/src/utils/speciesDescription.js`,
`cleanSpeciesText`). For example:

> "Identified to family level only. (photo by Niah National Park)."
> → "Identified to family level only."

It also tidies doubled spaces and full stops. Ordinary text, such as "spreads via seeds" or
"source of food", is left alone.

```powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$secureKey = Read-Host -Prompt 'Supabase service-role key' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
node scripts/clean-species-text/clean.mjs           # dry run: clean-species-text-report.csv
node scripts/clean-species-text/clean.mjs --apply
Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY
```

- **Before `--apply`:** apply `supabase/migrations/20261121190000_service_role_clean_species_text.sql`.
  It lets the service role update only these three columns.
- **Safe updates:** each update only happens if the field still has the value shown in the
  report.
- **Report:** the CSV report is git-ignored.
