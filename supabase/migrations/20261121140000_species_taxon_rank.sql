-- "Identified to" on the species record: how far the plant was identified.
-- Existing species are full species. RLS is unchanged.
ALTER TABLE public.species
    ADD COLUMN IF NOT EXISTS taxon_rank text NOT NULL DEFAULT 'species';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'species_taxon_rank_check'
          AND conrelid = 'public.species'::regclass
    ) THEN
        ALTER TABLE public.species
            ADD CONSTRAINT species_taxon_rank_check
                CHECK (taxon_rank IN ('species', 'genus', 'family', 'other'));
    END IF;
END;
$$;
