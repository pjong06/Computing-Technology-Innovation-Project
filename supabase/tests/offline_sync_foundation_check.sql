-- Read-only verification for 20261103090000_offline_sync_foundation.sql.
-- Run this in Supabase SQL Editor after the migration succeeds.

DO $check$
DECLARE
    missing_columns text[];
    missing_objects text[];
BEGIN
    SELECT array_agg(required.name ORDER BY required.name)
    INTO missing_columns
    FROM (
        VALUES
            ('plants.updated_at'),
            ('plants.deleted_at'),
            ('plants.deleted_by'),
            ('observations.updated_at'),
            ('plant_media.client_record_id'),
            ('plant_media.row_version'),
            ('plant_media.updated_at'),
            ('observation_media.client_record_id'),
            ('observation_media.row_version'),
            ('observation_media.updated_at'),
            ('audit_logs.sync_sequence'),
            ('audit_logs.owner_id'),
            ('audit_logs.row_version'),
            ('sync_events.operation_id')
    ) AS required(name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'public'
          AND c.table_name = split_part(required.name, '.', 1)
          AND c.column_name = split_part(required.name, '.', 2)
    );

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'Missing offline-sync columns: %', missing_columns;
    END IF;

    SELECT array_agg(required.name ORDER BY required.name)
    INTO missing_objects
    FROM (
        VALUES
            ('function:pull_botanist_changes'),
            ('function:bump_sync_row_version'),
            ('index:audit_logs_sync_sequence_key'),
            ('index:audit_logs_owner_sequence_idx'),
            ('index:sync_events_user_operation_key')
    ) AS required(name)
    WHERE CASE split_part(required.name, ':', 1)
        WHEN 'function' THEN NOT EXISTS (
            SELECT 1
            FROM pg_proc AS p
            JOIN pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = split_part(required.name, ':', 2)
        )
        WHEN 'index' THEN NOT EXISTS (
            SELECT 1
            FROM pg_indexes AS i
            WHERE i.schemaname = 'public'
              AND i.indexname = split_part(required.name, ':', 2)
        )
        ELSE true
    END;

    IF missing_objects IS NOT NULL THEN
        RAISE EXCEPTION 'Missing offline-sync objects: %', missing_objects;
    END IF;

    IF EXISTS (
        SELECT sync_sequence
        FROM public.audit_logs
        GROUP BY sync_sequence
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'audit_logs contains duplicate sync_sequence values';
    END IF;

    RAISE NOTICE 'Offline-sync foundation check passed';
END;
$check$;

SELECT
    count(*) AS audit_row_count,
    min(sync_sequence) AS first_cursor,
    max(sync_sequence) AS latest_cursor,
    count(*) FILTER (WHERE owner_id IS NULL) AS rows_without_owner
FROM public.audit_logs;
