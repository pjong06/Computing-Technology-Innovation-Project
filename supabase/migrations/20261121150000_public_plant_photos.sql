-- Public copies of plant photos for visitors (backend/src/services/publicPlantPhotos.js).
--
-- Originals stay in the private 'plant-media' bucket, readable by staff only (unchanged).
-- When an officer's action makes a plant public, the backend - as that officer - writes a
-- stripped copy of its main photo (at most 1200 px JPEG, no EXIF/GPS, XMP or ICC profile)
-- to this bucket as "<tag>.jpg", and removes it when the plant stops being public.
-- Everything in this bucket is meant for the public, so anyone may read it; only officers
-- may add, replace or remove files.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('public-plant-photos', 'public-plant-photos', false, 5242880, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anyone reads public plant photo copies" ON storage.objects;
CREATE POLICY "anyone reads public plant photo copies"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'public-plant-photos');

DROP POLICY IF EXISTS "officers manage public plant photo copies" ON storage.objects;
CREATE POLICY "officers manage public plant photo copies"
    ON storage.objects
    FOR ALL
    TO authenticated
    USING (
        bucket_id = 'public-plant-photos'
        AND (SELECT public.current_app_role()) = 'officer'
    )
    WITH CHECK (
        bucket_id = 'public-plant-photos'
        AND (SELECT public.current_app_role()) = 'officer'
        AND name ~ '^NIAH-PLT-[0-9]{5}\.jpg$'
    );

-- For the visitor species cards: for each given species, the tag of its newest plant that
-- is on the public QR page (same rule as public_plant_by_qr_v2) and has a public photo copy.
-- Returns only species ids and public plant tags: never a storage path, location or person.
CREATE OR REPLACE FUNCTION public.public_species_photo_tags(p_species_ids uuid[])
RETURNS TABLE (species_id uuid, qr_code_value text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT DISTINCT ON (p.species_id)
        p.species_id,
        p.qr_code_value
    FROM public.plants AS p
    JOIN public.species AS s ON s.id = p.species_id
    WHERE p.species_id = ANY (p_species_ids)
      AND p.plant_status = 'approved'
      AND p.deleted_at IS NULL
      AND p.qr_code_value ~ '^NIAH-PLT-[0-9]{5}$'
      AND s.verification_status = 'approved'
      AND EXISTS (
          SELECT 1
          FROM public.observations AS o
          WHERE o.plant_id = p.id
            AND o.review_status = 'approved'
            AND o.deleted_at IS NULL
      )
      AND EXISTS (
          SELECT 1
          FROM storage.objects AS f
          WHERE f.bucket_id = 'public-plant-photos'
            AND f.name = p.qr_code_value || '.jpg'
      )
    ORDER BY p.species_id, p.registered_at DESC, p.id;
$function$;

REVOKE ALL ON FUNCTION public.public_species_photo_tags(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_species_photo_tags(uuid[]) TO anon, authenticated;
