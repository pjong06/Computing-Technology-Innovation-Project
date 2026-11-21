-- "Edit and resend" for a botanist's species request that the officer did not add.
--
-- Botanists can only insert species requests (RLS has no UPDATE policy for them, and that is
-- unchanged). This narrow function lets the botanist who made a request change it and send
-- it again, and nothing else:
--   * only an active botanist, only their own request (proposed_by = auth.uid()),
--   * only while it is 'rejected' (shown as "Not added"),
--   * it goes back to 'pending' (waiting for review) and the officer's reason is cleared;
--     taxonomy, created_by and every other column are left as they are.
-- Anything else raises P0002 (no such request), so other people's requests and approved,
-- pending or archived species can't be touched.

CREATE OR REPLACE FUNCTION public.resubmit_species_proposal(
    p_id uuid,
    p_scientific_name text,
    p_common_name text DEFAULT NULL,
    p_local_name text DEFAULT NULL,
    p_family text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_habitat text DEFAULT NULL
)
-- The updated row (the API returns only the request fields from it).
RETURNS SETOF public.species
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF (SELECT public.current_app_role()) IS DISTINCT FROM 'botanist' THEN
        RAISE EXCEPTION 'Only a botanist can send a species request again' USING ERRCODE = '42501';
    END IF;
    IF nullif(btrim(p_scientific_name), '') IS NULL OR length(btrim(p_scientific_name)) > 200 THEN
        RAISE EXCEPTION 'scientific_name is required and must be at most 200 characters' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    UPDATE public.species AS s
       SET scientific_name = btrim(p_scientific_name),
           common_name = nullif(btrim(p_common_name), ''),
           local_name = nullif(btrim(p_local_name), ''),
           proposed_family = nullif(btrim(p_family), ''),
           description = nullif(btrim(p_description), ''),
           habitat = nullif(btrim(p_habitat), ''),
           verification_status = 'pending',
           review_comment = NULL
     WHERE s.id = p_id
       AND s.proposed_by = (SELECT auth.uid())
       AND s.verification_status = 'rejected'
    RETURNING s.*;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No species request of yours that was not added has this id' USING ERRCODE = 'P0002';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.resubmit_species_proposal(uuid, text, text, text, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_species_proposal(uuid, text, text, text, text, text, text)
    TO authenticated;
