-- scripts/clean-species-text/clean.mjs (run locally with the service-role key, never in the
-- backend) removes leftover photo credits and links from species text. It may update only
-- these text columns. description and habitat are already granted in
-- 20261121180000_species_description_draft.sql; this adds distribution notes.
-- RLS and grants for every other role are unchanged.

GRANT UPDATE (description, habitat, distribution_notes) ON TABLE public.species TO service_role;
