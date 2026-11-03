-- Atomically apply one mobile outbox operation and record its result.
-- The authenticated botanist's JWT is used by the backend Supabase client, so
-- this SECURITY INVOKER function continues to enforce the existing RLS rules.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_botanist_sync_operation(
    p_operation_id uuid,
    p_entity_type text,
    p_operation_type text,
    p_client_record_id uuid,
    p_base_version integer DEFAULT NULL,
    p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    current_user_id uuid := auth.uid();
    existing_event public.sync_events%ROWTYPE;
    plant_row public.plants%ROWTYPE;
    observation_row public.observations%ROWTYPE;
    plant_server_id uuid;
    entity_server_id uuid;
    latest_cursor bigint;
    result jsonb;
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF public.current_app_role() IS DISTINCT FROM 'botanist' THEN
        RAISE EXCEPTION 'Botanist role required' USING ERRCODE = '42501';
    END IF;

    IF p_entity_type NOT IN ('plant', 'observation')
       OR p_operation_type NOT IN ('create', 'update', 'delete') THEN
        RAISE EXCEPTION 'Unsupported sync operation' USING ERRCODE = '22023';
    END IF;

    -- Serialize retries of the same operation, including concurrent requests.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(current_user_id::text || ':' || p_operation_id::text, 0)
    );

    SELECT *
    INTO existing_event
    FROM public.sync_events
    WHERE user_id = current_user_id
      AND operation_id = p_operation_id
    LIMIT 1;

    IF FOUND THEN
        RETURN COALESCE(
            existing_event.result_payload,
            jsonb_build_object(
                'operation_id', p_operation_id,
                'status', existing_event.sync_status,
                'entity_type', p_entity_type,
                'operation_type', p_operation_type,
                'client_record_id', p_client_record_id,
                'server_cursor', existing_event.server_cursor
            )
        );
    END IF;

    IF p_entity_type = 'plant' THEN
        IF p_operation_type = 'create' THEN
            IF p_payload ? 'species_id'
               AND p_payload ->> 'species_id' IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1
                   FROM public.species
                   WHERE id = (p_payload ->> 'species_id')::uuid
                     AND verification_status = 'approved'
               ) THEN
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'failed',
                    'code', 'invalid_species',
                    'message', 'Selected species is not approved'
                );
            ELSE
                SELECT *
                INTO plant_row
                FROM public.plants
                WHERE client_record_id = p_client_record_id
                LIMIT 1;

                IF NOT FOUND THEN
                    INSERT INTO public.plants (
                        client_record_id,
                        species_id,
                        qr_code_value,
                        location,
                        gps_accuracy_m,
                        location_description,
                        morphology,
                        description,
                        plant_status,
                        registered_by
                    )
                    VALUES (
                        p_client_record_id,
                        NULLIF(p_payload ->> 'species_id', '')::uuid,
                        COALESCE(
                            NULLIF(btrim(p_payload ->> 'qr_code_value'), ''),
                            'plant:' || p_client_record_id::text
                        ),
                        extensions.st_setsrid(
                            extensions.st_makepoint(
                                (p_payload ->> 'longitude')::double precision,
                                (p_payload ->> 'latitude')::double precision
                            ),
                            4326
                        )::extensions.geography,
                        NULLIF(p_payload ->> 'gps_accuracy_m', '')::numeric,
                        NULLIF(btrim(p_payload ->> 'location_description'), ''),
                        NULLIF(btrim(p_payload ->> 'morphology'), ''),
                        NULLIF(btrim(p_payload ->> 'description'), ''),
                        'pending',
                        current_user_id
                    )
                    RETURNING * INTO plant_row;
                END IF;

                IF plant_row.registered_by IS DISTINCT FROM current_user_id THEN
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'failed',
                        'code', 'client_id_in_use',
                        'message', 'Client record ID belongs to another user'
                    );
                ELSE
                    entity_server_id := plant_row.id;
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'success',
                        'entity_type', 'plant',
                        'operation_type', 'create',
                        'client_record_id', p_client_record_id,
                        'server_id', plant_row.id,
                        'row_version', plant_row.row_version,
                        'record', to_jsonb(plant_row) - 'location'
                    );
                END IF;
            END IF;

        ELSIF p_operation_type = 'update' THEN
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
                );
            ELSIF plant_row.deleted_at IS NOT NULL
                  OR plant_row.row_version IS DISTINCT FROM p_base_version THEN
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
            ELSIF p_payload ? 'species_id'
                  AND p_payload ->> 'species_id' IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM public.species
                      WHERE id = (p_payload ->> 'species_id')::uuid
                        AND verification_status = 'approved'
                  ) THEN
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'failed',
                    'code', 'invalid_species',
                    'message', 'Selected species is not approved'
                );
            ELSE
                UPDATE public.plants
                SET species_id = CASE
                        WHEN p_payload ? 'species_id'
                            THEN NULLIF(p_payload ->> 'species_id', '')::uuid
                        ELSE species_id
                    END,
                    qr_code_value = CASE
                        WHEN p_payload ? 'qr_code_value'
                            THEN NULLIF(btrim(p_payload ->> 'qr_code_value'), '')
                        ELSE qr_code_value
                    END,
                    location = CASE
                        WHEN p_payload ? 'latitude' AND p_payload ? 'longitude'
                            THEN extensions.st_setsrid(
                                extensions.st_makepoint(
                                    (p_payload ->> 'longitude')::double precision,
                                    (p_payload ->> 'latitude')::double precision
                                ),
                                4326
                            )::extensions.geography
                        ELSE location
                    END,
                    gps_accuracy_m = CASE
                        WHEN p_payload ? 'gps_accuracy_m'
                            THEN NULLIF(p_payload ->> 'gps_accuracy_m', '')::numeric
                        ELSE gps_accuracy_m
                    END,
                    location_description = CASE
                        WHEN p_payload ? 'location_description'
                            THEN NULLIF(btrim(p_payload ->> 'location_description'), '')
                        ELSE location_description
                    END,
                    morphology = CASE
                        WHEN p_payload ? 'morphology'
                            THEN NULLIF(btrim(p_payload ->> 'morphology'), '')
                        ELSE morphology
                    END,
                    description = CASE
                        WHEN p_payload ? 'description'
                            THEN NULLIF(btrim(p_payload ->> 'description'), '')
                        ELSE description
                    END
                WHERE id = plant_row.id
                  AND row_version = p_base_version
                  AND deleted_at IS NULL
                RETURNING * INTO plant_row;

                IF NOT FOUND THEN
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'conflict',
                        'code', 'version_conflict',
                        'message', 'Plant changed while it was being synced'
                    );
                ELSE
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
            END IF;

        ELSE
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
                );
            ELSIF plant_row.deleted_at IS NOT NULL THEN
                entity_server_id := plant_row.id;
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'success',
                    'entity_type', 'plant',
                    'operation_type', 'delete',
                    'client_record_id', p_client_record_id,
                    'server_id', plant_row.id,
                    'row_version', plant_row.row_version
                );
            ELSIF plant_row.row_version IS DISTINCT FROM p_base_version THEN
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
                UPDATE public.plants
                SET deleted_at = clock_timestamp(),
                    deleted_by = current_user_id
                WHERE id = plant_row.id
                  AND row_version = p_base_version
                  AND deleted_at IS NULL
                RETURNING * INTO plant_row;

                entity_server_id := plant_row.id;
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'success',
                    'entity_type', 'plant',
                    'operation_type', 'delete',
                    'client_record_id', p_client_record_id,
                    'server_id', plant_row.id,
                    'row_version', plant_row.row_version
                );
            END IF;
        END IF;

    ELSE
        IF p_operation_type = 'create' THEN
            SELECT *
            INTO observation_row
            FROM public.observations
            WHERE client_record_id = p_client_record_id
            LIMIT 1;

            IF NOT FOUND THEN
                IF p_payload ? 'plant_client_record_id' THEN
                    SELECT id
                    INTO plant_server_id
                    FROM public.plants
                    WHERE client_record_id = (p_payload ->> 'plant_client_record_id')::uuid
                      AND registered_by = current_user_id
                      AND deleted_at IS NULL;
                ELSIF p_payload ? 'plant_id' THEN
                    SELECT id
                    INTO plant_server_id
                    FROM public.plants
                    WHERE id = (p_payload ->> 'plant_id')::uuid
                      AND registered_by = current_user_id
                      AND deleted_at IS NULL;
                END IF;

                IF plant_server_id IS NULL THEN
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'failed',
                        'code', 'plant_not_found',
                        'message', 'Parent plant has not been synced'
                    );
                ELSE
                    INSERT INTO public.observations (
                        client_record_id,
                        plant_id,
                        observer_id,
                        observed_at,
                        notes,
                        height_cm,
                        diameter_cm,
                        life_stage,
                        health_status,
                        location,
                        gps_accuracy_m,
                        review_status
                    )
                    VALUES (
                        p_client_record_id,
                        plant_server_id,
                        current_user_id,
                        COALESCE(
                            NULLIF(p_payload ->> 'observed_at', '')::timestamptz,
                            now()
                        ),
                        NULLIF(btrim(p_payload ->> 'notes'), ''),
                        NULLIF(p_payload ->> 'height_cm', '')::numeric,
                        NULLIF(p_payload ->> 'diameter_cm', '')::numeric,
                        NULLIF(btrim(p_payload ->> 'life_stage'), ''),
                        NULLIF(btrim(p_payload ->> 'health_status'), ''),
                        CASE
                            WHEN p_payload ? 'latitude' AND p_payload ? 'longitude'
                                THEN extensions.st_setsrid(
                                    extensions.st_makepoint(
                                        (p_payload ->> 'longitude')::double precision,
                                        (p_payload ->> 'latitude')::double precision
                                    ),
                                    4326
                                )::extensions.geography
                            ELSE NULL
                        END,
                        NULLIF(p_payload ->> 'gps_accuracy_m', '')::numeric,
                        'draft'
                    )
                    RETURNING * INTO observation_row;
                END IF;
            END IF;

            IF result IS NULL THEN
                IF observation_row.observer_id IS DISTINCT FROM current_user_id THEN
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'failed',
                        'code', 'client_id_in_use',
                        'message', 'Client record ID belongs to another user'
                    );
                ELSE
                    entity_server_id := observation_row.id;
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'success',
                        'entity_type', 'observation',
                        'operation_type', 'create',
                        'client_record_id', p_client_record_id,
                        'server_id', observation_row.id,
                        'row_version', observation_row.row_version,
                        'record', to_jsonb(observation_row) - 'location'
                    );
                END IF;
            END IF;

        ELSIF p_operation_type = 'update' THEN
            SELECT *
            INTO observation_row
            FROM public.observations
            WHERE client_record_id = p_client_record_id
              AND observer_id = current_user_id
            FOR UPDATE;

            IF NOT FOUND THEN
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'failed',
                    'code', 'not_found',
                    'message', 'Observation not found'
                );
            ELSIF observation_row.deleted_at IS NOT NULL
                  OR observation_row.row_version IS DISTINCT FROM p_base_version THEN
                entity_server_id := observation_row.id;
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'conflict',
                    'code', 'version_conflict',
                    'message', 'Observation changed on the server',
                    'client_record_id', p_client_record_id,
                    'server_id', observation_row.id,
                    'row_version', observation_row.row_version,
                    'server_record', to_jsonb(observation_row) - 'location'
                );
            ELSE
                UPDATE public.observations
                SET observed_at = CASE
                        WHEN p_payload ? 'observed_at'
                            THEN NULLIF(p_payload ->> 'observed_at', '')::timestamptz
                        ELSE observed_at
                    END,
                    notes = CASE
                        WHEN p_payload ? 'notes'
                            THEN NULLIF(btrim(p_payload ->> 'notes'), '')
                        ELSE notes
                    END,
                    height_cm = CASE
                        WHEN p_payload ? 'height_cm'
                            THEN NULLIF(p_payload ->> 'height_cm', '')::numeric
                        ELSE height_cm
                    END,
                    diameter_cm = CASE
                        WHEN p_payload ? 'diameter_cm'
                            THEN NULLIF(p_payload ->> 'diameter_cm', '')::numeric
                        ELSE diameter_cm
                    END,
                    life_stage = CASE
                        WHEN p_payload ? 'life_stage'
                            THEN NULLIF(btrim(p_payload ->> 'life_stage'), '')
                        ELSE life_stage
                    END,
                    health_status = CASE
                        WHEN p_payload ? 'health_status'
                            THEN NULLIF(btrim(p_payload ->> 'health_status'), '')
                        ELSE health_status
                    END,
                    location = CASE
                        WHEN p_payload ? 'latitude' AND p_payload ? 'longitude'
                            THEN extensions.st_setsrid(
                                extensions.st_makepoint(
                                    (p_payload ->> 'longitude')::double precision,
                                    (p_payload ->> 'latitude')::double precision
                                ),
                                4326
                            )::extensions.geography
                        ELSE location
                    END,
                    gps_accuracy_m = CASE
                        WHEN p_payload ? 'gps_accuracy_m'
                            THEN NULLIF(p_payload ->> 'gps_accuracy_m', '')::numeric
                        ELSE gps_accuracy_m
                    END
                WHERE id = observation_row.id
                  AND row_version = p_base_version
                  AND deleted_at IS NULL
                RETURNING * INTO observation_row;

                IF NOT FOUND THEN
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'conflict',
                        'code', 'version_conflict',
                        'message', 'Observation changed while it was being synced'
                    );
                ELSE
                    entity_server_id := observation_row.id;
                    result := jsonb_build_object(
                        'operation_id', p_operation_id,
                        'status', 'success',
                        'entity_type', 'observation',
                        'operation_type', 'update',
                        'client_record_id', p_client_record_id,
                        'server_id', observation_row.id,
                        'row_version', observation_row.row_version,
                        'record', to_jsonb(observation_row) - 'location'
                    );
                END IF;
            END IF;

        ELSE
            SELECT *
            INTO observation_row
            FROM public.observations
            WHERE client_record_id = p_client_record_id
              AND observer_id = current_user_id
            FOR UPDATE;

            IF NOT FOUND THEN
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'failed',
                    'code', 'not_found',
                    'message', 'Observation not found'
                );
            ELSIF observation_row.row_version IS DISTINCT FROM p_base_version THEN
                entity_server_id := observation_row.id;
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'conflict',
                    'code', 'version_conflict',
                    'message', 'Observation changed on the server',
                    'client_record_id', p_client_record_id,
                    'server_id', observation_row.id,
                    'row_version', observation_row.row_version,
                    'server_record', to_jsonb(observation_row) - 'location'
                );
            ELSE
                DELETE FROM public.observations
                WHERE id = observation_row.id
                  AND row_version = p_base_version
                RETURNING * INTO observation_row;

                entity_server_id := observation_row.id;
                result := jsonb_build_object(
                    'operation_id', p_operation_id,
                    'status', 'success',
                    'entity_type', 'observation',
                    'operation_type', 'delete',
                    'client_record_id', p_client_record_id,
                    'server_id', observation_row.id,
                    'row_version', observation_row.row_version
                );
            END IF;
        END IF;
    END IF;

    IF entity_server_id IS NOT NULL THEN
        SELECT max(sync_sequence)
        INTO latest_cursor
        FROM public.audit_logs
        WHERE owner_id = current_user_id
          AND entity_id = entity_server_id;
    END IF;

    result := result || jsonb_build_object(
        'entity_type', p_entity_type,
        'operation_type', p_operation_type,
        'client_record_id', p_client_record_id,
        'server_cursor', latest_cursor
    );

    INSERT INTO public.sync_events (
        user_id,
        plant_id,
        observation_id,
        sync_status,
        attempted_at,
        completed_at,
        operation_id,
        operation_type,
        entity_type,
        client_record_id,
        result_payload,
        server_cursor
    )
    VALUES (
        current_user_id,
        CASE
            WHEN p_entity_type = 'plant' THEN entity_server_id
            ELSE observation_row.plant_id
        END,
        CASE
            WHEN p_entity_type = 'observation' THEN entity_server_id
            ELSE NULL
        END,
        result ->> 'status',
        now(),
        now(),
        p_operation_id,
        p_operation_type,
        p_entity_type,
        p_client_record_id,
        result,
        latest_cursor
    );

    RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_botanist_sync_operation(
    uuid, text, text, uuid, integer, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_botanist_sync_operation(
    uuid, text, text, uuid, integer, jsonb
) TO authenticated;

COMMIT;
