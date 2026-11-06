-- Keep observation sync aligned with the plants botanists can read: they may
-- add a visit to their own plant or to any approved plant, but not another
-- botanist's unapproved plant.
BEGIN;

DO $migration$
DECLARE
    function_definition text;
    old_parent_lookup text := $old$WHERE id = (p_payload ->> 'plant_id')::uuid
                      AND registered_by = current_user_id
                      AND deleted_at IS NULL;$old$;
    new_parent_lookup text := $new$WHERE id = (p_payload ->> 'plant_id')::uuid
                      AND (registered_by = current_user_id OR plant_status = 'approved')
                      AND deleted_at IS NULL;$new$;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.apply_botanist_sync_operation(uuid,text,text,uuid,integer,jsonb)'::regprocedure
    )
    INTO function_definition;

    IF function_definition IS NULL OR position(old_parent_lookup IN function_definition) = 0 THEN
        RAISE EXCEPTION 'Expected observation parent lookup was not found in apply_botanist_sync_operation';
    END IF;

    EXECUTE replace(function_definition, old_parent_lookup, new_parent_lookup);
END;
$migration$;

COMMIT;
