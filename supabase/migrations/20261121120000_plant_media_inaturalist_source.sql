-- Plant photos taken from an iNaturalist sighting (scripts/inat-plant-photos/attach-photos.mjs)
-- keep where they came from and their licence, like species_media. Existing rows are the
-- botanists' and officers' own field photos. RLS is unchanged.
ALTER TABLE public.plant_media
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'field',
    ADD COLUMN IF NOT EXISTS source_photo_id bigint,
    ADD COLUMN IF NOT EXISTS source_url text,
    ADD COLUMN IF NOT EXISTS licence_code text,
    ADD COLUMN IF NOT EXISTS attribution text,
    ADD COLUMN IF NOT EXISTS photographer text,
    ADD COLUMN IF NOT EXISTS imported_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'plant_media_source_check'
          AND conrelid = 'public.plant_media'::regclass
    ) THEN
        ALTER TABLE public.plant_media
            ADD CONSTRAINT plant_media_source_check
                CHECK (source IN ('field', 'inaturalist'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'plant_media_inaturalist_metadata_check'
          AND conrelid = 'public.plant_media'::regclass
    ) THEN
        ALTER TABLE public.plant_media
            ADD CONSTRAINT plant_media_inaturalist_metadata_check
                CHECK (
                    source <> 'inaturalist'
                    OR (
                        source_photo_id IS NOT NULL
                        AND licence_code IN ('cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc')
                        AND nullif(btrim(attribution), '') IS NOT NULL
                        AND nullif(btrim(source_url), '') IS NOT NULL
                    )
                );
    END IF;
END;
$$;

-- One copy of an iNaturalist photo per plant (the script skips photos already attached).
CREATE UNIQUE INDEX IF NOT EXISTS plant_media_source_photo_key
    ON public.plant_media (plant_id, source, source_photo_id)
    WHERE source_photo_id IS NOT NULL;

-- So the local script (service_role key) can check and insert plant photos, as for
-- species_media. RLS for other roles is unchanged.
GRANT SELECT, INSERT ON TABLE public.plant_media TO service_role;
