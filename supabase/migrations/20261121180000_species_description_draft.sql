-- Draft species text, for review.
--
-- scripts/species-descriptions/fill.mjs fills EMPTY description, habitat and common name
-- fields of approved species with short drafts, and sets description_is_draft = true on
-- every species it drafts for. The officer's species editor then shows "Draft description:
-- please review" with a "Mark as reviewed" button, which sets it back to false.
-- Visitors and the app show the text as usual.
--
-- Existing rows are not drafts. RLS and grants are unchanged: officers already manage
-- species ("officers manage species"); the public can read approved species as before.

ALTER TABLE public.species
    ADD COLUMN IF NOT EXISTS description_is_draft boolean NOT NULL DEFAULT false;

-- The fill script runs locally with the service-role key (never in the backend). It already
-- reads species (20261121130000_service_role_read_plants.sql). For --apply it may write only
-- the drafted columns, and find or add taxonomy rows; it cannot change existing taxonomy
-- rows or any other species column.
GRANT UPDATE (description, habitat, common_name, taxonomy_id, description_is_draft)
    ON TABLE public.species TO service_role;
GRANT SELECT, INSERT ON TABLE public.taxonomy TO service_role;

COMMENT ON COLUMN public.species.description_is_draft IS
    'True while description, habitat or common name text drafted by scripts/species-descriptions/fill.mjs has not been reviewed by an officer.';
