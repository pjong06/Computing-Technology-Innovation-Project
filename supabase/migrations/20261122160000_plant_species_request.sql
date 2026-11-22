-- A plant registered for a species that isn't in the catalogue yet waits for the species
-- request the botanist sent for it.
--
--   plants.species_request_id: the species request (a pending species row the botanist
--   proposed) the plant waits for. species_id stays NULL meanwhile, so the plant's field
--   record can't be approved ("Add the species first").
--
--   link_plant_species_request(plant, request client id): called by the app after the plant
--   reached the server. Only the botanist's own plant (any review status: this sets the link
--   and nothing else), still without a species, and only the botanist's own request (found
--   by its client_record_id). If the officer already added that species, the plant gets the
--   species straight away.
--
-- When an officer adds the species (PATCH /api/knowledge/species/proposals/:id/review), the
-- backend sets species_id on every plant waiting for it. When it isn't added, the plants keep
-- waiting and the botanist sees the officer's reason on the request.
--
-- Write-only here: apply after review (supabase db push), as with the other migrations.

BEGIN;

ALTER TABLE public.plants
    ADD COLUMN IF NOT EXISTS species_request_id uuid REFERENCES public.species(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS plants_species_request_id_idx
    ON public.plants (species_request_id)
    WHERE species_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.link_plant_species_request(p_plant_id uuid, p_request_client_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
    plant public.plants%ROWTYPE;
    request public.species%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR public.current_app_role() IS DISTINCT FROM 'botanist' THEN
        RAISE EXCEPTION 'Botanist access required' USING ERRCODE = '42501';
    END IF;
    IF p_plant_id IS NULL OR p_request_client_id IS NULL THEN
        RAISE EXCEPTION 'Invalid plant or species request' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO plant FROM public.plants WHERE id = p_plant_id FOR UPDATE;
    IF NOT FOUND OR plant.registered_by IS DISTINCT FROM auth.uid() OR plant.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Plant is unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO request FROM public.species
     WHERE client_record_id = p_request_client_id
       AND proposed_by = auth.uid();
    IF NOT FOUND THEN
        -- Not uploaded yet: the app sends the request first and tries again.
        RAISE EXCEPTION 'Species request not found' USING ERRCODE = 'P0002';
    END IF;

    -- Already linked (a retried call), or the plant already has a species: nothing to do.
    IF plant.species_request_id = request.id OR plant.species_id IS NOT NULL THEN
        RETURN request.id;
    END IF;

    UPDATE public.plants
       SET species_request_id = request.id,
           -- The officer already added the species: the plant gets it now.
           species_id = CASE WHEN request.verification_status = 'approved' THEN request.id ELSE species_id END
     WHERE id = p_plant_id;
    RETURN request.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.link_plant_species_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_plant_species_request(uuid, uuid) TO authenticated;

COMMIT;
