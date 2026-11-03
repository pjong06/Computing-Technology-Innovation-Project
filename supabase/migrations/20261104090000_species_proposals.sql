-- Species proposals: a botanist may PROPOSE a species (verification_status = 'pending');
-- only an officer approves or rejects it. Approved species stay the only ones the public
-- list and the mobile picker show ("read approved species" is unchanged).
-- Existing policies are not loosened: this only adds a botanist INSERT for pending rows
-- they propose themselves, and a botanist SELECT of their own proposals.
--
-- The species table was created outside these migrations, so the first block checks it
-- and stops with a clear message instead of guessing.

DO $check$
DECLARE
    status_type text;
    status_checks text;
    duplicate_names text;
BEGIN
    SELECT data_type INTO status_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'species' AND column_name = 'verification_status';

    IF status_type IS NULL THEN
        RAISE EXCEPTION 'public.species has no verification_status column';
    END IF;

    -- An enum type needs ALTER TYPE ... ADD VALUE first (it can't run in this transaction).
    IF status_type = 'USER-DEFINED' THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_attribute a JOIN pg_enum e ON e.enumtypid = a.atttypid
            WHERE a.attrelid = 'public.species'::regclass AND a.attname = 'verification_status'
              AND e.enumlabel = 'pending'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_attribute a JOIN pg_enum e ON e.enumtypid = a.atttypid
            WHERE a.attrelid = 'public.species'::regclass AND a.attname = 'verification_status'
              AND e.enumlabel = 'rejected'
        ) THEN
            RAISE EXCEPTION 'verification_status is an enum without pending/rejected. Add them with ALTER TYPE ... ADD VALUE, then rerun.';
        END IF;
    END IF;

    -- A CHECK constraint that lists allowed statuses must already include the new ones.
    SELECT string_agg(pg_get_constraintdef(oid), ' | ') INTO status_checks
    FROM pg_constraint
    WHERE conrelid = 'public.species'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%verification_status%';

    IF status_checks IS NOT NULL
       AND (status_checks NOT ILIKE '%''pending''%' OR status_checks NOT ILIKE '%''rejected''%') THEN
        RAISE EXCEPTION 'A CHECK constraint on verification_status does not allow pending/rejected: %', status_checks;
    END IF;

    -- The case-insensitive unique index below would fail on existing duplicates.
    SELECT string_agg(name, ', ') INTO duplicate_names
    FROM (
        SELECT lower(btrim(scientific_name)) AS name
        FROM public.species
        GROUP BY 1
        HAVING count(*) > 1
    ) AS duplicates;

    IF duplicate_names IS NOT NULL THEN
        RAISE EXCEPTION 'These scientific names exist more than once (ignoring case): %. Merge or rename them first.', duplicate_names;
    END IF;
END
$check$;

-- New columns (all nullable, so existing rows are unaffected).
ALTER TABLE public.species
    ADD COLUMN IF NOT EXISTS proposed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS client_record_id uuid,
    ADD COLUMN IF NOT EXISTS proposed_family text,
    ADD COLUMN IF NOT EXISTS review_comment text;

DO $constraints$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'species_proposed_family_length') THEN
        ALTER TABLE public.species
            ADD CONSTRAINT species_proposed_family_length CHECK (char_length(proposed_family) <= 200);
    END IF;
END
$constraints$;

-- The phone's own proposal ID: a retried upload finds the saved row instead of a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS species_client_record_id_unique
    ON public.species (client_record_id)
    WHERE client_record_id IS NOT NULL;

-- One species per scientific name, ignoring letter case and outer spaces. This also stops
-- a botanist proposing a name that another botanist's pending proposal (hidden from them
-- by RLS) already uses.
CREATE UNIQUE INDEX IF NOT EXISTS species_scientific_name_lower_unique
    ON public.species (lower(btrim(scientific_name)));

CREATE INDEX IF NOT EXISTS species_proposed_by_idx
    ON public.species (proposed_by)
    WHERE proposed_by IS NOT NULL;

-- RLS: botanists may insert only their own pending proposals, with no officer-only fields.
DROP POLICY IF EXISTS "botanists propose species" ON public.species;
DROP POLICY IF EXISTS "botanists read own proposals" ON public.species;

CREATE POLICY "botanists propose species"
    ON public.species
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.current_app_role() = 'botanist'
        AND verification_status = 'pending'
        AND proposed_by = auth.uid()
        AND taxonomy_id IS NULL
        AND review_comment IS NULL
    );

CREATE POLICY "botanists read own proposals"
    ON public.species
    FOR SELECT
    TO authenticated
    USING (
        public.current_app_role() = 'botanist'
        AND proposed_by = auth.uid()
    );

-- No botanist UPDATE or DELETE policy: only "officers manage species" can change rows,
-- so a botanist can never approve, reject or edit a proposal after sending it.
