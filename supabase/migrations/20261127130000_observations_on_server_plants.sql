-- Observations on any approved plant the server returned (TC-APP-06).
--
-- A botanist may record an observation on a plant they did not register on this phone:
-- one found by scanning its tag or in the Plants list. The phone links such an observation
-- to the plant's server id (plant_id). The sync function's parent lookup must then accept
-- the botanist's own plant OR any approved plant (20261112090000). Two gaps remained:
--   1. If 20261112090000 is not applied on a database, the plant_id lookup still accepts
--      only the botanist's own plants ("Parent plant has not been synced"). This migration
--      makes sure it accepts approved plants, whether or not 20261112090000 ran.
--   2. A plant cached from the server keeps its server client_record_id as its id on the
--      phone, so an observation queued as plant_client_record_id (before the phone knew
--      the plant's server id) was looked up among the botanist's OWN plants only. It now
--      accepts the same plants as plant_id: own, or approved.
-- An observation on another botanist's plant that is not approved is still refused.
-- RLS policies and role checks are unchanged.
--
-- Write-only here: apply after review (supabase db push), as with the other migrations.

BEGIN;

DO $migration$
DECLARE
    function_definition text;
    -- plant_id: own only (before 20261112090000) or own-or-approved (after).
    old_id_lookup text := $old$WHERE id = (p_payload ->> 'plant_id')::uuid
                      AND registered_by = current_user_id
                      AND deleted_at IS NULL;$old$;
    new_id_lookup text := $new$WHERE id = (p_payload ->> 'plant_id')::uuid
                      AND (registered_by = current_user_id OR plant_status = 'approved')
                      AND deleted_at IS NULL;$new$;
    old_client_lookup text := $old$WHERE client_record_id = (p_payload ->> 'plant_client_record_id')::uuid
                      AND registered_by = current_user_id
                      AND deleted_at IS NULL;$old$;
    new_client_lookup text := $new$WHERE client_record_id = (p_payload ->> 'plant_client_record_id')::uuid
                      AND (registered_by = current_user_id OR plant_status = 'approved')
                      AND deleted_at IS NULL;$new$;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.apply_botanist_sync_operation(uuid,text,text,uuid,integer,jsonb)'::regprocedure
    )
    INTO function_definition;

    IF function_definition IS NULL THEN
        RAISE EXCEPTION 'apply_botanist_sync_operation not found';
    END IF;

    -- The stored body may have Windows line endings; compare with plain ones.
    function_definition := replace(function_definition, E'\r\n', E'\n');

    IF position(old_id_lookup IN function_definition) > 0 THEN
        function_definition := replace(function_definition, old_id_lookup, new_id_lookup);
    ELSIF position(new_id_lookup IN function_definition) = 0 THEN
        RAISE EXCEPTION 'Expected observation parent lookup (plant_id) was not found in apply_botanist_sync_operation';
    END IF;

    IF position(old_client_lookup IN function_definition) > 0 THEN
        function_definition := replace(function_definition, old_client_lookup, new_client_lookup);
    ELSIF position(new_client_lookup IN function_definition) = 0 THEN
        RAISE EXCEPTION 'Expected observation parent lookup (plant_client_record_id) was not found in apply_botanist_sync_operation';
    END IF;

    EXECUTE function_definition;
END;
$migration$;

COMMIT;
