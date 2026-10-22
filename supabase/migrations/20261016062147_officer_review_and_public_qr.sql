-- Allow only an active officer to assign an approved species
-- to an unidentified plant with a pending observation.
CREATE OR REPLACE FUNCTION public.officer_assign_plant_species(
    p_plant_id uuid,
    p_species_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.uid() IS NULL
       OR public.current_app_role() IS DISTINCT FROM 'officer' THEN
        RAISE EXCEPTION 'Only an active officer can assign a species';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.species
        WHERE id = p_species_id
          AND verification_status = 'approved'
    ) THEN
        RAISE EXCEPTION 'Species must be approved';
    END IF;

    UPDATE public.plants
    SET species_id = p_species_id
    WHERE id = p_plant_id
      AND plant_status = 'pending'
      AND species_id IS NULL
      AND EXISTS (
          SELECT 1
          FROM public.observations
          WHERE plant_id = p_plant_id
            AND review_status = 'pending'
            AND deleted_at IS NULL
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Plant must be unassigned and have a pending observation';
    END IF;

    RETURN p_plant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.officer_assign_plant_species(uuid, uuid)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.officer_assign_plant_species(uuid, uuid)
    TO authenticated;

-- Return public details only for an approved plant and species.
-- Exact location is shown only when conservation status is LC.
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
    latitude double precision,
    longitude double precision
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
            ELSE NULL END
    FROM public.plants AS p
    JOIN public.species AS s ON s.id = p.species_id
    WHERE p.qr_code_value = p_qr
      AND p.plant_status = 'approved'
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