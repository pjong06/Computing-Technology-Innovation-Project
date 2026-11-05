-- Preserve Officer policies and all writer/mutation permissions.
CREATE POLICY botanists_researchers_read_camera_evidence
ON public.alert_camera_evidence FOR SELECT TO authenticated
USING ((SELECT public.current_app_role()) IN ('botanist','researcher'));
CREATE POLICY botanists_researchers_read_camera_objects
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='camera-evidence'
 AND (SELECT public.current_app_role()) IN ('botanist','researcher')
 AND EXISTS (SELECT 1 FROM public.alert_camera_evidence e WHERE e.file_path=storage.objects.name));
