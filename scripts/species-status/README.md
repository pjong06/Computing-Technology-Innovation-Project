# Species conservation status from the IUCN Red List (via GBIF)

`check.mjs` looks up every species that isn't archived on GBIF (no API key needed) and reports
its IUCN Red List category, its GBIF rank and any name written with the wrong capitals.
Dry run by default: it only writes the report.

```
node scripts/species-status/check.mjs                         # dry run: report only
node scripts/species-status/check.mjs --apply                 # fill empty conservation_status
node scripts/species-status/check.mjs --apply --overwrite-conflicts
node scripts/species-status/check.mjs --fix-rank              # write species.taxon_rank from GBIF
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are read from the environment only (never from a
file). `--apply` and `--fix-rank` need
`supabase/migrations/20261122180000_service_role_species_status.sql` applied first: it lets the
service role update only `species.conservation_status` and `species.taxon_rank`.

## Rules

- **Match:** `GET /v1/species/match?name=<name>&kingdom=Plantae`. Accepted only when the match
  type is EXACT, or FUZZY with confidence 95 or more. Everything else is "not matched", with
  the reason.
- **Species level only:** a status is looked up (`/v1/species/<key>/iucnRedListCategory`, the
  accepted name's key for a synonym) only at rank SPECIES or below. Genus, family and higher
  entries are "not species level" and never get a status.
- **Codes:** stored as LC, NT, VU, EN, CR, DD (what the portal and app show). NE, NA or no
  result keeps "Not assessed" (empty). EX and EW are reported but not stored, because the portal
  can't show them yet.
- **Conflicts:** when we already have a status and IUCN says something else, the row is a
  "conflict". It is listed, but `--apply` never overwrites it unless `--overwrite-conflicts`.
- **Rank:** GBIF species/subspecies/variety/form → `species`, GENUS → `genus`, FAMILY →
  `family`, anything else → `other`. `--fix-rank` writes it where it differs.

## Report

`species-status-report.csv` (git-ignored): species, matched GBIF name and rank, current
status, IUCN status, action (set / unchanged / conflict / not matched / not species level),
whether `--apply` writes it, current and GBIF rank, capitalisation problems, and the source URL
`https://www.gbif.org/species/<usageKey>`.

At most one GBIF request per second; answers are cached in `.cache/` (git-ignored), so running
it again is quick and asks GBIF nothing new. Only a generic client name is sent to GBIF.
