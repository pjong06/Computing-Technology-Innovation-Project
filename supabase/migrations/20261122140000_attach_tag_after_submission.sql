-- Attach a physical QR tag to a plant AFTER it was submitted.
--
-- A botanist may register a plant with "No physical tag yet" and attach one of their own
-- printed (reserved) tags later. Until now that only worked while the plant was still
-- editable: the phone sends the tag as a plant update through apply_botanist_sync_operation
-- (SECURITY INVOKER), and the review lock (RLS "botanists edit own pending plants": pending
-- and no submitted observation) hides a submitted, approved or sent-back plant from that
-- update, so the tag was refused ("plant_locked").
--
-- Narrow exception, for the tag only:
--   1. attach_reserved_plant_tag (SECURITY DEFINER, the existing tag path) states its rules
--      explicitly: the signed-in botanist's own plant, not deleted, in ANY review status,
--      that still has a placeholder tag ("plant:<uuid>" or none); the tag must be one of the
--      botanist's own unused reserved tags (checked by the plants_require_reserved_tag
--      trigger, unchanged). It changes qr_code_value (and row_version) only.
--   2. apply_botanist_sync_operation: when the review lock hides the botanist's own plant
--      from a plant update whose payload is ONLY {"qr_code_value": "NIAH-PLT-#####"}, the tag
--      is attached through attach_reserved_plant_tag instead of answering not_found. Any
--      other change to a locked plant is still refused exactly as before.
-- RLS policies, officers' review data and every other column are unchanged.
--
-- Write-only here: apply after review (supabase db push), as with the other migrations.

BEGIN;

CREATE OR REPLACE FUNCTION public.attach_reserved_plant_tag(p_plant_id uuid, p_tag text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE plant public.plants%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_app_role() IS DISTINCT FROM 'botanist' THEN
    RAISE EXCEPTION 'Botanist access required' USING ERRCODE = '42501';
  END IF;
  IF p_tag IS NULL OR p_tag !~ '^NIAH-PLT-[0-9]{5}$' OR p_plant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid plant or tag' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO plant FROM public.plants WHERE id = p_plant_id FOR UPDATE;
  IF NOT FOUND OR plant.registered_by IS DISTINCT FROM auth.uid() OR plant.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Plant is unavailable' USING ERRCODE = '42501';
  END IF;
  -- The same tag again (a retried upload): nothing to do.
  IF plant.qr_code_value = p_tag THEN RETURN plant.id; END IF;
  -- Only a plant that still has a placeholder ("plant:<uuid>") or no tag.
  IF plant.qr_code_value IS NOT NULL AND btrim(plant.qr_code_value) <> ''
     AND plant.qr_code_value !~ '^plant:' THEN
    RAISE EXCEPTION 'Plant already has a physical tag' USING ERRCODE = '42501';
  END IF;
  -- The tag itself (own, reserved, unused) is checked by plants_require_reserved_tag.
  -- Any review status: this definer function is the one place a submitted plant's tag
  -- may be set, and it changes nothing else.
  UPDATE public.plants SET qr_code_value = p_tag, row_version = row_version + 1
    WHERE id = p_plant_id;
  RETURN p_plant_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.attach_reserved_plant_tag(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_reserved_plant_tag(uuid, text) TO authenticated;

DO $migration$
DECLARE
    function_definition text;
    old_not_found text := $old$        ELSIF p_operation_type = 'update' THEN
            SELECT *
            INTO plant_row
            FROM public.plants
            WHERE client_record_id = p_client_record_id
              AND registered_by = current_user_id
            FOR UPDATE;

            IF NOT FOUND THEN
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'failed',
                    'code', 'not_found',
                    'message', 'Plant record not found'
                );$old$;
    new_not_found text := $new$        ELSIF p_operation_type = 'update' THEN
            SELECT *
            INTO plant_row
            FROM public.plants
            WHERE client_record_id = p_client_record_id
              AND registered_by = current_user_id
            FOR UPDATE;

            IF NOT FOUND THEN
                -- Tag attached after submission (20261122140000): the review lock hides
                -- the botanist's own plant from updates, but a payload that is only a
                -- physical tag goes through attach_reserved_plant_tag (own unused reserved
                -- tag, placeholder tag on the plant, nothing else changes).
                SELECT *
                INTO plant_row
                FROM public.plants
                WHERE client_record_id = p_client_record_id
                  AND registered_by = current_user_id
                  AND deleted_at IS NULL;

                IF FOUND
                   AND (SELECT pg_catalog.array_agg(payload_key)
                        FROM pg_catalog.jsonb_object_keys(p_payload) AS payload_key) = ARRAY['qr_code_value']
                   AND pg_catalog.btrim(p_payload ->> 'qr_code_value') ~ '^NIAH-PLT-[0-9]{5}$' THEN
                    PERFORM public.attach_reserved_plant_tag(
                        plant_row.id,
                        pg_catalog.btrim(p_payload ->> 'qr_code_value')
                    );

                    SELECT *
                    INTO plant_row
                    FROM public.plants
                    WHERE id = plant_row.id;

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
                ELSE
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'failed',
                        'code', 'not_found',
                        'message', 'Plant record not found'
                    );
                END IF;$new$;
    occurrences integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.apply_botanist_sync_operation(uuid,text,text,uuid,integer,jsonb)'::regprocedure
    )
    INTO function_definition;

    -- The stored body may have Windows line endings; compare with plain ones.
    function_definition := replace(function_definition, E'\r\n', E'\n');
    old_not_found := replace(old_not_found, E'\r\n', E'\n');
    new_not_found := replace(new_not_found, E'\r\n', E'\n');

    occurrences := (length(function_definition) - length(replace(function_definition, old_not_found, '')))
        / length(old_not_found);
    IF function_definition IS NULL OR occurrences <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one plant update lookup in apply_botanist_sync_operation, found %', occurrences;
    END IF;

    EXECUTE replace(function_definition, old_not_found, new_not_found);
END;
$migration$;

COMMIT;
