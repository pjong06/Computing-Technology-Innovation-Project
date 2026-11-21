-- No coordinates in the public QR function, for any plant.
--
-- public_plant_by_qr_v2 is called by anonymous visitors (the public QR API
-- GET /api/public/plants/by-qr and the visitor page /p/:tag). It used to return latitude and
-- longitude for plants of Least Concern (LC) species. It now returns no latitude, longitude or
-- accuracy for any conservation status. Staff see coordinates of approved plants through the
-- signed-in staff API instead (backend/src/services/plantDetails.js).
--
-- A function's result columns can't be changed in place, so it is dropped and created again
-- with the same visibility rule as 20261121170000_public_imported_plants.sql (approved,
-- active, approved species; imported or with an approved observation) and the same grants.
-- The location note stays as it was: only for LC species (text, not coordinates).

BEGIN;

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

COMMIT;
