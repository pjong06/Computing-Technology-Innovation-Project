-- Exclude endangered, threatened, extinct, and protected species from public visitor RPCs.
--
-- Updates:
--   1. public.public_plant_by_qr_v2(text) — used by GET /api/public/plants/by-qr,
--      the visitor web page /p/:tag, and refreshPublicPlantPhoto (so public photo copies
--      for restricted plants are also removed when refreshed).
--   2. public.public_species_photo_tags(uuid[]) — used for visitor species cards.
--
-- Keeps the exact return columns from 20261121210000_public_qr_no_coordinates.sql
-- (no coordinates) and the same role grants.

BEGIN;

CREATE OR REPLACE FUNCTION public.public_plant_by_qr_v2(p_qr text)
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
        p.data_source,
        p.source_observer,
        p.source_licence
    FROM public.plants AS p
    JOIN public.species AS s ON s.id = p.species_id
    WHERE p.qr_code_value = p_qr
      AND p.plant_status = 'approved'
      AND p.deleted_at IS NULL
      AND s.verification_status = 'approved'
      AND COALESCE(UPPER(BTRIM(s.conservation_status)), '') NOT IN ('CR', 'EN', 'VU', 'EW', 'EX')
      AND COALESCE(LOWER(s.conservation_status), '') !~ '(critically endangered|endangered|vulnerable|extinct|totally protected|high[- ]risk|sensitive|restricted)'
      AND (
          p.data_source = 'inaturalist'
          OR EXISTS (
              SELECT 1
              FROM public.observations AS o
              WHERE o.plant_id = p.id
                AND o.review_status = 'approved'
                AND o.deleted_at IS NULL
          )
      );
$function$;

REVOKE ALL ON FUNCTION public.public_plant_by_qr_v2(text)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.public_plant_by_qr_v2(text)
    TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_species_photo_tags(p_species_ids uuid[])
RETURNS TABLE (species_id uuid, qr_code_value text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT DISTINCT ON (p.species_id)
        p.species_id,
        p.qr_code_value
    FROM public.plants AS p
    JOIN public.species AS s ON s.id = p.species_id
    WHERE p.species_id = ANY (p_species_ids)
      AND p.plant_status = 'approved'
      AND p.deleted_at IS NULL
      AND p.qr_code_value ~ '^NIAH-PLT-[0-9]{5}$'
      AND s.verification_status = 'approved'
      AND COALESCE(UPPER(BTRIM(s.conservation_status)), '') NOT IN ('CR', 'EN', 'VU', 'EW', 'EX')
      AND COALESCE(LOWER(s.conservation_status), '') !~ '(critically endangered|endangered|vulnerable|extinct|totally protected|high[- ]risk|sensitive|restricted)'
      AND (
          p.data_source = 'inaturalist'
          OR EXISTS (
              SELECT 1
              FROM public.observations AS o
              WHERE o.plant_id = p.id
                AND o.review_status = 'approved'
                AND o.deleted_at IS NULL
          )
      )
      AND EXISTS (
          SELECT 1
          FROM storage.objects AS f
          WHERE f.bucket_id = 'public-plant-photos'
            AND f.name = p.qr_code_value || '.jpg'
      )
    ORDER BY p.species_id, p.registered_at DESC, p.id;
$function$;

REVOKE ALL ON FUNCTION public.public_species_photo_tags(uuid[])
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.public_species_photo_tags(uuid[])
    TO anon, authenticated;

COMMIT;