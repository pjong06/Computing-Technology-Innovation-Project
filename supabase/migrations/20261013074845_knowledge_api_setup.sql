-- Incremental setup for the Knowledge API.
-- Assumes the project already has species, taxonomy, species_media,
-- and public.current_app_role().

ALTER TABLE public.species ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.species_media ENABLE ROW LEVEL SECURITY;

-- Keep table permissions limited to what the API routes use.
REVOKE ALL PRIVILEGES ON TABLE public.species FROM anon, authenticated;
GRANT SELECT ON TABLE public.species TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.species TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.taxonomy FROM anon, authenticated;
GRANT SELECT ON TABLE public.taxonomy TO anon;
GRANT SELECT, INSERT ON TABLE public.taxonomy TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.species_media FROM anon, authenticated;
GRANT SELECT ON TABLE public.species_media TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.species_media TO authenticated;

-- Public readers see approved species; officers can manage every species row.
DROP POLICY IF EXISTS "officers manage species" ON public.species;
DROP POLICY IF EXISTS "officers read all species" ON public.species;
DROP POLICY IF EXISTS "read approved species" ON public.species;

CREATE POLICY "officers manage species"
    ON public.species
    FOR ALL
    TO authenticated
    USING (public.current_app_role() = 'officer')
    WITH CHECK (public.current_app_role() = 'officer');

CREATE POLICY "read approved species"
    ON public.species
    FOR SELECT
    TO anon, authenticated
    USING (verification_status = 'approved');

-- Taxonomy is public reference data; only officers can add or change it.
DROP POLICY IF EXISTS "authenticated read taxonomy" ON public.taxonomy;
DROP POLICY IF EXISTS "officers manage taxonomy" ON public.taxonomy;
DROP POLICY IF EXISTS "public read taxonomy" ON public.taxonomy;

CREATE POLICY "public read taxonomy"
    ON public.taxonomy
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "officers manage taxonomy"
    ON public.taxonomy
    FOR ALL
    TO authenticated
    USING (public.current_app_role() = 'officer')
    WITH CHECK (public.current_app_role() = 'officer');

-- Media follows the visibility of its species record.
DROP POLICY IF EXISTS "approved species media for staff" ON public.species_media;
DROP POLICY IF EXISTS "officers manage species photos" ON public.species_media;
DROP POLICY IF EXISTS "public read approved species photos" ON public.species_media;
DROP POLICY IF EXISTS "researchers read approved species media" ON public.species_media;

CREATE POLICY "officers manage species photos"
    ON public.species_media
    FOR ALL
    TO authenticated
    USING (public.current_app_role() = 'officer')
    WITH CHECK (public.current_app_role() = 'officer');

CREATE POLICY "public read approved species photos"
    ON public.species_media
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1
            FROM public.species AS s
            WHERE s.id = species_media.species_id
              AND s.verification_status = 'approved'
        )
    );

CREATE POLICY "researchers read approved species media"
    ON public.species_media
    FOR SELECT
    TO authenticated
    USING (
        public.current_app_role() = 'researcher'
        AND EXISTS (
            SELECT 1
            FROM public.species AS s
            WHERE s.id = species_media.species_id
              AND s.verification_status = 'approved'
        )
    );

CREATE POLICY "approved species media for staff"
    ON public.species_media
    FOR SELECT
    TO authenticated
    USING (
        public.current_app_role() IN ('botanist', 'admin')
        AND EXISTS (
            SELECT 1
            FROM public.species AS s
            WHERE s.id = species_media.species_id
              AND s.verification_status = 'approved'
        )
    );

-- Prevent duplicate taxonomy rows, including rows with matching null fields.
CREATE UNIQUE INDEX IF NOT EXISTS taxonomy_unique_classification
    ON public.taxonomy (
        kingdom,
        division,
        class_name,
        order_name,
        family,
        genus
    ) NULLS NOT DISTINCT;

-- Each species may have only one primary photo.
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_photo_per_species
    ON public.species_media (species_id)
    WHERE is_primary = true;

-- Switch the primary photo in one transaction so two photos cannot be primary.
CREATE OR REPLACE FUNCTION public.set_primary_species_photo(
    p_species_id uuid,
    p_photo_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
    IF public.current_app_role() IS DISTINCT FROM 'officer' THEN
        RAISE EXCEPTION 'Officer role required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.species_media AS sm
        JOIN public.species AS s ON s.id = sm.species_id
        WHERE sm.id = p_photo_id
          AND sm.species_id = p_species_id
          AND s.verification_status = 'approved'
    ) THEN
        RAISE EXCEPTION 'Photo not found on an approved species'
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.species_media
    SET is_primary = false
    WHERE species_id = p_species_id
      AND is_primary = true;

    UPDATE public.species_media
    SET is_primary = true
    WHERE id = p_photo_id
      AND species_id = p_species_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Could not set primary photo';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_primary_species_photo(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_primary_species_photo(uuid, uuid)
    TO authenticated;

-- Keep photos private and accept only the processed JPEGs saved by the API.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('species-media', 'species-media', false, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "officer species image cleanup" ON storage.objects;
DROP POLICY IF EXISTS "officer species image read" ON storage.objects;
DROP POLICY IF EXISTS "officer species image upload" ON storage.objects;
DROP POLICY IF EXISTS "public read approved species image files" ON storage.objects;

CREATE POLICY "officer species image cleanup"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'species-media'
        AND public.current_app_role() = 'officer'
    );

CREATE POLICY "officer species image read"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'species-media'
        AND public.current_app_role() = 'officer'
    );

CREATE POLICY "officer species image upload"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'species-media'
        AND public.current_app_role() = 'officer'
    );

CREATE POLICY "public read approved species image files"
    ON storage.objects
    FOR SELECT
    TO anon
    USING (
        bucket_id = 'species-media'
        AND EXISTS (
            SELECT 1
            FROM public.species_media AS sm
            JOIN public.species AS s ON s.id = sm.species_id
            WHERE sm.file_path = objects.name
              AND s.verification_status = 'approved'
        )
    );