-- Sprint 2 offline-sync database foundation.
--
-- This migration is intentionally additive:
--   * existing rows are preserved;
--   * client-generated IDs remain the create-operation idempotency key;
--   * row_version supports optimistic concurrency;
--   * audit_logs becomes the ordered server delta feed;
--   * sync_events remains a server-side operation log, not the mobile outbox.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Sync metadata on server-owned entity tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.plants
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_by uuid;

ALTER TABLE public.observations
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.plant_media
    ADD COLUMN IF NOT EXISTS client_record_id uuid,
    ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.observation_media
    ADD COLUMN IF NOT EXISTS client_record_id uuid,
    ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'plants_deleted_by_fkey'
          AND conrelid = 'public.plants'::regclass
    ) THEN
        ALTER TABLE public.plants
            ADD CONSTRAINT plants_deleted_by_fkey
            FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
    END IF;
END;
$block$;

CREATE UNIQUE INDEX IF NOT EXISTS plant_media_client_record_id_key
    ON public.plant_media (client_record_id)
    WHERE client_record_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS observation_media_client_record_id_key
    ON public.observation_media (client_record_id)
    WHERE client_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS plants_owner_updated_idx
    ON public.plants (registered_by, updated_at, id);

CREATE INDEX IF NOT EXISTS observations_owner_updated_idx
    ON public.observations (observer_id, updated_at, id);

-- Always advance the server version when a row is changed. The backend will
-- later compare the client's base row_version before allowing an update.
CREATE OR REPLACE FUNCTION public.bump_sync_row_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    NEW.updated_at := clock_timestamp();
    NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS biotrack_bump_sync_version ON public.plants;
CREATE TRIGGER biotrack_bump_sync_version
    BEFORE UPDATE ON public.plants
    FOR EACH ROW
    EXECUTE FUNCTION public.bump_sync_row_version();

DROP TRIGGER IF EXISTS biotrack_bump_sync_version ON public.observations;
CREATE TRIGGER biotrack_bump_sync_version
    BEFORE UPDATE ON public.observations
    FOR EACH ROW
    EXECUTE FUNCTION public.bump_sync_row_version();

DROP TRIGGER IF EXISTS biotrack_bump_sync_version ON public.plant_media;
CREATE TRIGGER biotrack_bump_sync_version
    BEFORE UPDATE ON public.plant_media
    FOR EACH ROW
    EXECUTE FUNCTION public.bump_sync_row_version();

DROP TRIGGER IF EXISTS biotrack_bump_sync_version ON public.observation_media;
CREATE TRIGGER biotrack_bump_sync_version
    BEFORE UPDATE ON public.observation_media
    FOR EACH ROW
    EXECUTE FUNCTION public.bump_sync_row_version();

-- ---------------------------------------------------------------------------
-- 2. Ordered delta feed built on the existing audit_logs table
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.audit_logs_sync_sequence_seq AS bigint;

ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS sync_sequence bigint,
    ADD COLUMN IF NOT EXISTS owner_id uuid,
    ADD COLUMN IF NOT EXISTS row_version integer;

ALTER SEQUENCE public.audit_logs_sync_sequence_seq
    OWNED BY public.audit_logs.sync_sequence;

ALTER TABLE public.audit_logs
    ALTER COLUMN sync_sequence
    SET DEFAULT nextval('public.audit_logs_sync_sequence_seq'::regclass);

-- Existing audit rows receive deterministic cursor values without touching
-- plants or observations.
UPDATE public.audit_logs
SET sync_sequence = nextval('public.audit_logs_sync_sequence_seq'::regclass)
WHERE sync_sequence IS NULL;

SELECT setval(
    'public.audit_logs_sync_sequence_seq'::regclass,
    COALESCE((SELECT max(sync_sequence) FROM public.audit_logs), 1),
    EXISTS (SELECT 1 FROM public.audit_logs)
);

ALTER TABLE public.audit_logs
    ALTER COLUMN sync_sequence SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_sync_sequence_key
    ON public.audit_logs (sync_sequence);

CREATE INDEX IF NOT EXISTS audit_logs_owner_sequence_idx
    ON public.audit_logs (owner_id, sync_sequence)
    WHERE owner_id IS NOT NULL;

-- Backfill ownership/version for audit rows that pre-date this migration.
UPDATE public.audit_logs
SET owner_id = CASE entity_type
        WHEN 'plants' THEN COALESCE(
            NULLIF(new_values ->> 'registered_by', '')::uuid,
            NULLIF(old_values ->> 'registered_by', '')::uuid
        )
        WHEN 'observations' THEN COALESCE(
            NULLIF(new_values ->> 'observer_id', '')::uuid,
            NULLIF(old_values ->> 'observer_id', '')::uuid
        )
        WHEN 'plant_media' THEN COALESCE(
            NULLIF(new_values ->> 'uploaded_by', '')::uuid,
            NULLIF(old_values ->> 'uploaded_by', '')::uuid
        )
        WHEN 'observation_media' THEN COALESCE(
            NULLIF(new_values ->> 'uploaded_by', '')::uuid,
            NULLIF(old_values ->> 'uploaded_by', '')::uuid
        )
        ELSE NULL
    END,
    row_version = COALESCE(
        NULLIF(new_values ->> 'row_version', '')::integer,
        NULLIF(old_values ->> 'row_version', '')::integer,
        1
    )
WHERE owner_id IS NULL
   OR row_version IS NULL;

-- Preserve the existing audit behaviour while recording the record owner and
-- version needed for user-scoped delta sync. Officer changes are therefore
-- delivered to the botanist who owns the affected record.
CREATE OR REPLACE FUNCTION public.record_biotrack_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    record_data jsonb;
    record_owner uuid;
    record_version integer;
BEGIN
    record_data := CASE
        WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD)
        ELSE to_jsonb(NEW)
    END;

    record_owner := CASE TG_TABLE_NAME
        WHEN 'plants' THEN
            NULLIF(record_data ->> 'registered_by', '')::uuid
        WHEN 'observations' THEN
            NULLIF(record_data ->> 'observer_id', '')::uuid
        WHEN 'plant_media' THEN
            NULLIF(record_data ->> 'uploaded_by', '')::uuid
        WHEN 'observation_media' THEN
            NULLIF(record_data ->> 'uploaded_by', '')::uuid
        ELSE NULL
    END;

    -- observation_media.uploaded_by is nullable in the existing schema.
    IF record_owner IS NULL AND TG_TABLE_NAME = 'observation_media' THEN
        SELECT o.observer_id
        INTO record_owner
        FROM public.observations AS o
        WHERE o.id = NULLIF(record_data ->> 'observation_id', '')::uuid;
    END IF;

    record_version := COALESCE(
        NULLIF(record_data ->> 'row_version', '')::integer,
        1
    );

    INSERT INTO public.audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        owner_id,
        row_version
    )
    VALUES (
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
        record_owner,
        record_version
    );

    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Plants and observations already have audit triggers. Media receives the
-- same treatment so uploaded/deleted photos can participate in later pulls.
DROP TRIGGER IF EXISTS biotrack_audit_plant_media ON public.plant_media;
CREATE TRIGGER biotrack_audit_plant_media
    AFTER INSERT OR UPDATE OR DELETE ON public.plant_media
    FOR EACH ROW
    EXECUTE FUNCTION public.record_biotrack_audit();

DROP TRIGGER IF EXISTS biotrack_audit_observation_media
    ON public.observation_media;
CREATE TRIGGER biotrack_audit_observation_media
    AFTER INSERT OR UPDATE OR DELETE ON public.observation_media
    FOR EACH ROW
    EXECUTE FUNCTION public.record_biotrack_audit();

-- Authenticated users can pull only changes belonging to themselves. Direct
-- access to audit_logs is not required by the mobile app.
CREATE OR REPLACE FUNCTION public.pull_botanist_changes(
    p_after_sequence bigint DEFAULT 0,
    p_limit integer DEFAULT 100
)
RETURNS TABLE (
    sequence_cursor bigint,
    entity_type text,
    entity_id uuid,
    action text,
    row_version integer,
    changed_at timestamptz,
    record_payload jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        log.sync_sequence,
        log.entity_type,
        log.entity_id,
        log.action,
        log.row_version,
        log.created_at,
        CASE
            WHEN log.action = 'DELETE' THEN log.old_values
            ELSE log.new_values
        END
    FROM public.audit_logs AS log
    WHERE log.owner_id = auth.uid()
      AND log.sync_sequence > GREATEST(COALESCE(p_after_sequence, 0), 0)
      AND log.entity_type IN (
          'plants',
          'observations',
          'plant_media',
          'observation_media'
      )
    ORDER BY log.sync_sequence
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$function$;

REVOKE ALL ON FUNCTION public.pull_botanist_changes(bigint, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_botanist_changes(bigint, integer)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Server operation log additions
-- ---------------------------------------------------------------------------

ALTER TABLE public.sync_events
    ADD COLUMN IF NOT EXISTS operation_id uuid,
    ADD COLUMN IF NOT EXISTS operation_type text,
    ADD COLUMN IF NOT EXISTS entity_type text,
    ADD COLUMN IF NOT EXISTS client_record_id uuid,
    ADD COLUMN IF NOT EXISTS result_payload jsonb,
    ADD COLUMN IF NOT EXISTS server_cursor bigint;

CREATE UNIQUE INDEX IF NOT EXISTS sync_events_user_operation_key
    ON public.sync_events (user_id, operation_id)
    WHERE operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sync_events_user_attempted_idx
    ON public.sync_events (user_id, attempted_at DESC);

COMMIT;
