-- Who decided a species request, and when (for the officer's Review history page).
-- The species request review (PATCH /api/knowledge/species/proposals/:id/review) sets both
-- when an officer adds or doesn't add a requested species. Requests decided before this
-- have neither; the history then shows the species row's updated_at and no officer.
-- RLS is unchanged: officers already manage species ("officers manage species").

ALTER TABLE public.species
    ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE INDEX IF NOT EXISTS species_reviewed_at_idx
    ON public.species (reviewed_at DESC)
    WHERE reviewed_at IS NOT NULL;
