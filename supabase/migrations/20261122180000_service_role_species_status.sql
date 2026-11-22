-- scripts/species-status/check.mjs runs locally with the service-role key (never in the
-- backend). It already reads species (20261121130000_service_role_read_plants.sql). With
-- --apply it fills species.conservation_status (IUCN Red List through GBIF) and with
-- --fix-rank it writes species.taxon_rank; it may update only those two columns.
--
-- Write-only here: apply after review (supabase db push), as with the other migrations.

BEGIN;

GRANT UPDATE (conservation_status, taxon_rank) ON TABLE public.species TO service_role;

COMMIT;
