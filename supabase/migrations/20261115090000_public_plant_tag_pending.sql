-- Report pending review status for physical tags without returning plant fields.
CREATE FUNCTION public.public_plant_tag_is_pending(p_qr text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.plants AS p
        WHERE p_qr ~ '^NIAH-PLT-[0-9]{5}$'
          AND p.qr_code_value = p_qr
          AND p.plant_status = 'pending'
          AND p.deleted_at IS NULL
    );
$function$;

REVOKE ALL ON FUNCTION public.public_plant_tag_is_pending(text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_plant_tag_is_pending(text)
    TO anon, authenticated;
