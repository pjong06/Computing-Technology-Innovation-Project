BEGIN;

-- The sync RPC runs as SECURITY INVOKER, so authenticated botanists
-- need table privileges in addition to the RPC EXECUTE privilege.
ALTER TABLE public.sync_events
    ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT
ON TABLE public.sync_events
TO authenticated;

-- Anonymous users must not access staff synchronization history.
REVOKE SELECT, INSERT, UPDATE, DELETE
ON TABLE public.sync_events
FROM anon;

DROP POLICY IF EXISTS "botanists read own sync events"
ON public.sync_events;

DROP POLICY IF EXISTS "botanists insert own sync events"
ON public.sync_events;

CREATE POLICY "botanists read own sync events"
ON public.sync_events
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    AND public.current_app_role() = 'botanist'
);

CREATE POLICY "botanists insert own sync events"
ON public.sync_events
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND public.current_app_role() = 'botanist'
);

COMMIT;