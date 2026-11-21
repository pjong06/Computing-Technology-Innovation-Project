# Draft species descriptions

`fill.mjs` finds approved species with an empty **description**, **habitat**, **common name**
or **family**, and fills only those empty fields with the short drafts in `drafts.mjs`.
Existing text is never overwritten. Drafted species are marked
`species.description_is_draft = true`. The officer's species editor then shows
"Draft description: please review" with a **Mark as reviewed** button. Visitors and the app
show the text as usual.

Plant records (height, diameter, health, life stage) are never read or changed.

## 1. Apply the migration (once)

`supabase/migrations/20261121180000_species_description_draft.sql` adds
`species.description_is_draft`. It also lets the service role update only the drafted species
columns, and read and add taxonomy rows. The dry run works without it; `--apply` and the
editor's "Mark as reviewed" need it.

## 2. Dry run: review the report

```powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$secureKey = Read-Host -Prompt 'Supabase service-role key' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
node scripts/species-descriptions/fill.mjs
```

`species-description-report.csv` has one row per empty field: species, field, old value,
new value and action.

- **will fill (dry run)**: the draft that `--apply` would write.
- **left empty: no confident draft (please fill in)**: there is no widely used common name,
  or the habitat or family isn't certain enough to draft. A botanist should fill it in.
- **left empty: no draft for this name**: a species name that `drafts.mjs` doesn't know. Add
  an entry there, or fill it in through the editor.

To change a draft, edit `drafts.mjs` and run the dry run again.

## 3. Apply

```powershell
node scripts/species-descriptions/fill.mjs --apply
Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY
```

Each write only happens if the field still has the value from the report, so text someone
typed in the meantime is kept. The report then says `filled`,
`skipped: changed since the report` or `failed: …` for each row.

For a family, the species is pointed at a taxonomy row with that family: an existing row with
the same classification, or a new row. A new row copies the species' current kingdom,
division, class, order and genus, adds the family, and takes the genus from the name when it
has none. Existing taxonomy rows are never edited.

## Drafts

- Each draft is general on purpose: no measurements, and only traits that are true of the
  species or its genus.
- Genus-level records start "Identified to genus level; …", and family-level records start
  "Identified to family level; …".
- Broad records (Plantae, Magnoliopsida, …) say a closer identification is needed. They get no
  family or habitat.
- Families follow APG IV (flowering plants) and PPG I (ferns).
