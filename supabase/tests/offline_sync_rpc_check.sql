-- Read-only verification for 20261103133000_apply_offline_sync_operation.sql.

DO $check$
BEGIN
    IF to_regprocedure(
        'public.apply_botanist_sync_operation(uuid,text,text,uuid,integer,jsonb)'
    ) IS NULL THEN
        RAISE EXCEPTION 'apply_botanist_sync_operation RPC is missing';
    END IF;

    IF NOT has_function_privilege(
        'authenticated',
        'public.apply_botanist_sync_operation(uuid,text,text,uuid,integer,jsonb)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'authenticated role cannot execute sync operation RPC';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.apply_botanist_sync_operation(uuid,text,text,uuid,integer,jsonb)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'anon must not execute sync operation RPC';
    END IF;

    RAISE NOTICE 'Offline-sync operation RPC check passed';
END;
$check$;
