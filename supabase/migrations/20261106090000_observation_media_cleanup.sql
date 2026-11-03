-- Let a botanist delete their OWN unlinked visit photo files in the observation-media
-- bucket. POST /api/observations/:id/photo uploads the file first and then inserts the
-- observation_media row; if the insert fails, it removes the file so nothing unlinked is
-- left behind. Without a DELETE policy on this bucket that cleanup is refused.
--
-- Same shape as the existing "botanists clean up unlinked plant image files" policy on
-- plant-media: own folder ({auth.uid()}/...), botanist role, and only files that no
-- observation_media row points to (so a saved photo can never be deleted this way).
-- No existing policy is changed.

BEGIN;

DROP POLICY IF EXISTS "botanists clean up unlinked observation image files" ON storage.objects;

CREATE POLICY "botanists clean up unlinked observation image files"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'observation-media'
        AND (SELECT public.current_app_role()) = 'botanist'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND NOT EXISTS (
            SELECT 1
            FROM public.observation_media AS m
            WHERE m.file_path = objects.name
        )
    );

COMMIT;
