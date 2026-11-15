ALTER TABLE public.plants
    ADD COLUMN IF NOT EXISTS data_source text NOT NULL DEFAULT 'field',
    ADD COLUMN IF NOT EXISTS source_url text,
    ADD COLUMN IF NOT EXISTS source_observer text,
    ADD COLUMN IF NOT EXISTS source_licence text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'plants_data_source_check'
          AND conrelid = 'public.plants'::regclass
    ) THEN
        ALTER TABLE public.plants
            ADD CONSTRAINT plants_data_source_check
            CHECK (data_source IN ('field', 'inaturalist'));
    END IF;
END;
$$;

CREATE OR REPLACE VIEW public.plant_map_points
WITH (security_invoker = true) AS
SELECT
    p.id,
    p.species_id,
    p.qr_code_value,
    p.plant_status,
    p.location_description,
    st_y(p.location::geometry) AS latitude,
    st_x(p.location::geometry) AS longitude,
    p.data_source,
    p.source_observer,
    p.source_licence
FROM public.plants AS p
WHERE p.location IS NOT NULL
  AND p.deleted_at IS NULL;

GRANT SELECT ON public.plant_map_points TO authenticated;
REVOKE ALL ON public.plant_map_points FROM anon;

DROP FUNCTION IF EXISTS public.public_plant_by_qr_v2(text);

CREATE FUNCTION public.public_plant_by_qr_v2(p_qr text)
RETURNS TABLE (
    plant_id uuid,
    qr_code_value text,
    scientific_name text,
    common_name text,
    local_name text,
    description text,
    morphology text,
    habitat text,
    conservation_status text,
    cultural_significance text,
    location_description text,
    latitude double precision,
    longitude double precision,
    data_source text,
    source_observer text,
    source_licence text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        p.id,
        p.qr_code_value,
        s.scientific_name,
        s.common_name,
        s.local_name,
        s.description,
        s.morphology,
        s.habitat,
        s.conservation_status,
        s.cultural_significance,
        CASE WHEN s.conservation_status = 'LC'
            THEN p.location_description ELSE NULL END,
        CASE WHEN s.conservation_status = 'LC'
            THEN extensions.st_y(p.location::extensions.geometry)
            ELSE NULL END,
        CASE WHEN s.conservation_status = 'LC'
            THEN extensions.st_x(p.location::extensions.geometry)
            ELSE NULL END,
        p.data_source,
        p.source_observer,
        p.source_licence
    FROM public.plants AS p
    JOIN public.species AS s ON s.id = p.species_id
    WHERE p.qr_code_value = p_qr
      AND p.plant_status = 'approved'
      AND p.deleted_at IS NULL
      AND s.verification_status = 'approved'
      AND EXISTS (
          SELECT 1
          FROM public.observations AS o
          WHERE o.plant_id = p.id
            AND o.review_status = 'approved'
            AND o.deleted_at IS NULL
      );
$function$;

REVOKE ALL ON FUNCTION public.public_plant_by_qr_v2(text)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.public_plant_by_qr_v2(text)
    TO anon, authenticated;
