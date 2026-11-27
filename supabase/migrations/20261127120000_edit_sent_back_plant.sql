-- "Edit and resend" a plant registration the officer sent back ("Needs changes").
--
-- When an officer sends back a NEW PLANT record, its registration observation becomes
-- 'rejected' while the plant itself stays 'pending'. The botanist fixes it in the app and
-- sends it again: the observation update and its resubmission were already allowed
-- (observations.js and the sync function accept 'draft' and 'rejected'), but the PLANT
-- update (species, location, notes) was hidden by the review lock (RLS "botanists edit own
-- pending plants": pending and no submitted observation), so it came back "plant_locked".
--
-- Narrow exception, in the same way as attach_reserved_plant_tag (20261122140000):
--   1. update_sent_back_plant (SECURITY DEFINER) states its rules explicitly: the
--      signed-in botanist's own plant, not deleted, not approved/archived, whose
--      registration record (its earliest live observation) is 'rejected', i.e. sent back
--      and not yet resubmitted. While it waits for review again ('pending') or once it is
--      approved, it is refused as before. Only the editable fields change (species, which
--      must be an approved species; location; GPS accuracy; location note; morphology;
--      notes) and row_version; never the tag, the owner or the review status.
--   2. apply_botanist_sync_operation: when the review lock hides the botanist's own plant
--      from a plant update and the plant is sent back, the update goes through
--      update_sent_back_plant instead of answering not_found (plant_locked).
-- RLS policies, role checks and officers' review data are unchanged.
--
-- Write-only here: apply after review (supabase db push), as with the other migrations.

BEGIN;

-- Sent back and not yet resubmitted: the plant's registration record is 'rejected'.
CREATE OR REPLACE FUNCTION public.plant_is_sent_back(p_plant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT COALESCE((
    SELECT o.review_status = 'rejected'
    FROM public.observations o
    WHERE o.plant_id = p_plant_id
      AND o.deleted_at IS NULL
    ORDER BY o.observed_at ASC, o.id ASC
    LIMIT 1
  ), false);
$fn$;
REVOKE ALL ON FUNCTION public.plant_is_sent_back(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plant_is_sent_back(uuid) TO authenticated;

-- Returns the updated plant, or NULL when the phone's copy is out of date (row_version).
CREATE OR REPLACE FUNCTION public.update_sent_back_plant(
  p_plant_id uuid,
  p_base_version integer,
  p_payload jsonb
)
RETURNS public.plants LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE plant public.plants%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_app_role() IS DISTINCT FROM 'botanist' THEN
    RAISE EXCEPTION 'Botanist access required' USING ERRCODE = '42501';
  END IF;
  IF p_plant_id IS NULL OR p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid plant update' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO plant FROM public.plants WHERE id = p_plant_id FOR UPDATE;
  IF NOT FOUND OR plant.registered_by IS DISTINCT FROM auth.uid() OR plant.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Plant is unavailable' USING ERRCODE = '42501';
  END IF;
  -- Waiting for review or approved: still locked.
  IF plant.plant_status IN ('approved', 'archived') OR NOT public.plant_is_sent_back(p_plant_id) THEN
    RAISE EXCEPTION 'Only a plant sent back for changes can be edited' USING ERRCODE = '42501';
  END IF;
  IF p_base_version IS NOT NULL AND plant.row_version IS DISTINCT FROM p_base_version THEN
    RETURN NULL;
  END IF;
  IF p_payload ? 'species_id' AND p_payload ->> 'species_id' IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.species
       WHERE id = (p_payload ->> 'species_id')::uuid AND verification_status = 'approved') THEN
    RAISE EXCEPTION 'Selected species is not approved' USING ERRCODE = '22023';
  END IF;

  UPDATE public.plants
  SET species_id = CASE WHEN p_payload ? 'species_id'
                        THEN NULLIF(p_payload ->> 'species_id', '')::uuid ELSE species_id END,
      location = CASE WHEN p_payload ? 'latitude' AND p_payload ? 'longitude'
                      THEN extensions.st_setsrid(
                             extensions.st_makepoint(
                               (p_payload ->> 'longitude')::double precision,
                               (p_payload ->> 'latitude')::double precision),
                             4326)::extensions.geography
                      ELSE location END,
      gps_accuracy_m = CASE WHEN p_payload ? 'gps_accuracy_m'
                            THEN NULLIF(p_payload ->> 'gps_accuracy_m', '')::numeric ELSE gps_accuracy_m END,
      location_description = CASE WHEN p_payload ? 'location_description'
                                  THEN NULLIF(pg_catalog.btrim(p_payload ->> 'location_description'), '')
                                  ELSE location_description END,
      morphology = CASE WHEN p_payload ? 'morphology'
                        THEN NULLIF(pg_catalog.btrim(p_payload ->> 'morphology'), '') ELSE morphology END,
      description = CASE WHEN p_payload ? 'description'
                         THEN NULLIF(pg_catalog.btrim(p_payload ->> 'description'), '') ELSE description END,
      row_version = row_version + 1
  WHERE id = p_plant_id
  RETURNING * INTO plant;
  RETURN plant;
END;
$fn$;
REVOKE ALL ON FUNCTION public.update_sent_back_plant(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_sent_back_plant(uuid, integer, jsonb) TO authenticated;

DO $migration$
DECLARE
    function_definition text;
    -- The end of the tag-after-submission branch (20261122140000): what a hidden plant
    -- update answers when it isn't a tag-only change.
    old_locked text := $old$                        'record', to_jsonb(plant_row) - 'location'
                    );
                ELSE
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'failed',
                        'code', 'not_found',
                        'message', 'Plant record not found'
                    );
                END IF;$old$;
    new_locked text := $new$                        'record', to_jsonb(plant_row) - 'location'
                    );
                ELSIF FOUND
                   AND public.plant_is_sent_back(plant_row.id) THEN
                    -- Sent back for changes (20261127120000): the botanist's edit goes
                    -- through update_sent_back_plant (own plant, registration rejected and
                    -- not resubmitted, editable fields only).
                    edited_row := public.update_sent_back_plant(plant_row.id, p_base_version, p_payload);
                    IF edited_row.id IS NULL THEN
                        entity_server_id := plant_row.id;
                        result := jsonb_build_object(
                            'operation_id', p_operation_id,
                            'status', 'conflict',
                            'code', 'version_conflict',
                            'message', 'Plant changed on the server',
                            'client_record_id', p_client_record_id,
                            'server_id', plant_row.id,
                            'row_version', plant_row.row_version,
                            'server_record', to_jsonb(plant_row) - 'location'
                        );
                    ELSE
                        plant_row := edited_row;
                        entity_server_id := plant_row.id;
                        result := jsonb_build_object(
                            'operation_id', p_operation_id,
                            'status', 'success',
                            'entity_type', 'plant',
                            'operation_type', 'update',
                            'client_record_id', p_client_record_id,
                            'server_id', plant_row.id,
                            'row_version', plant_row.row_version,
                            'record', to_jsonb(plant_row) - 'location'
                        );
                    END IF;
                ELSE
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'failed',
                        'code', 'not_found',
                        'message', 'Plant record not found'
                    );
                END IF;$new$;
    old_declare text := $old$DECLARE$old$;
    new_declare text := $new$DECLARE
    edited_row public.plants%ROWTYPE;$new$;
    occurrences integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.apply_botanist_sync_operation(uuid,text,text,uuid,integer,jsonb)'::regprocedure
    )
    INTO function_definition;

    -- The stored body may have Windows line endings; compare with plain ones.
    function_definition := replace(function_definition, E'\r\n', E'\n');
    old_locked := replace(old_locked, E'\r\n', E'\n');
    new_locked := replace(new_locked, E'\r\n', E'\n');

    IF function_definition IS NULL THEN
        RAISE EXCEPTION 'apply_botanist_sync_operation not found';
    END IF;
    occurrences := (length(function_definition) - length(replace(function_definition, old_locked, '')))
        / length(old_locked);
    IF occurrences <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one locked plant update answer in apply_botanist_sync_operation (run 20261122140000 first), found %', occurrences;
    END IF;
    IF position('edited_row' IN function_definition) > 0 THEN
        RAISE EXCEPTION 'apply_botanist_sync_operation already has the sent-back plant edit';
    END IF;

    function_definition := replace(function_definition, old_locked, new_locked);
    -- One local variable for the edited row, in the function's own DECLARE block.
    function_definition := regexp_replace(function_definition, '\mDECLARE\M', new_declare);
    EXECUTE function_definition;
END;
$migration$;

COMMIT;
