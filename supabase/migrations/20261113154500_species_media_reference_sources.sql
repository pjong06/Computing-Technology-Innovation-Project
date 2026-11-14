-- Existing species_media rows are SFC photos.
ALTER TABLE public.species_media
    ADD COLUMN source text NOT NULL DEFAULT 'sfc',
    ADD COLUMN source_photo_id bigint,
    ADD COLUMN source_url text,
    ADD COLUMN licence_code text,
    ADD COLUMN attribution text,
    ADD COLUMN photographer text,
    ADD COLUMN reviewed_by text,
    ADD COLUMN imported_at timestamptz;

ALTER TABLE public.species_media
    ADD CONSTRAINT species_media_source_check
        CHECK (source IN ('sfc', 'inaturalist')),
    ADD CONSTRAINT species_media_inaturalist_metadata_check
        CHECK (
            source <> 'inaturalist'
            OR (
                source_photo_id IS NOT NULL
                AND licence_code IS NOT NULL
                AND licence_code IN ('cc0', 'cc-by', 'cc-by-sa')
                AND nullif(btrim(attribution), '') IS NOT NULL
                AND nullif(btrim(source_url), '') IS NOT NULL
            )
        );

CREATE UNIQUE INDEX species_media_source_photo_key
    ON public.species_media (species_id, source, source_photo_id);

-- Needed so the local import script (service_role key) can insert reference photos; RLS for other roles is unchanged.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.species_media TO service_role;
