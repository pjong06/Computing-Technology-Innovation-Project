-- Trace route (transect), phase 1: routes recorded on the phone and uploaded by botanists.
-- Plan: docs/trace-route-plan.md, section 2.3 and decision 2.
--
-- Who can do what (RLS):
--   botanist   insert and read only their own routes
--   officer    read all routes
--   researcher nothing (a later migration only if SFC requests it)
--   visitor    nothing (no policy matches the role)
--   anon       nothing (all rights revoked)
-- Nobody can update or delete a route through the API (no UPDATE/DELETE policy or grant).
--
-- Schema assumptions checked against the existing migrations:
--   * plants.id is uuid (plant_id parameters and ::uuid lookups in
--     20261016062147_officer_review_and_public_qr.sql, 20261103133000_apply_offline_sync_operation.sql).
--   * public.current_app_role() is the role helper every policy uses.
--   * Role values: 'botanist', 'officer', 'researcher', 'visitor'
--     (profiles role CHECK in 20261107090000_visitor_accounts.sql).
--   * Accounts are not hard-deleted (20261115171620_suspend_profile_on_website_user_delete.sql),
--     so recorded_by can reference auth.users(id) as in the plan.
BEGIN;

CREATE TABLE public.field_routes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_route_id uuid NOT NULL,
    recorded_by uuid NOT NULL REFERENCES auth.users(id),
    plant_id uuid NULL REFERENCES public.plants(id) ON DELETE SET NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    distance_m numeric NOT NULL,
    duration_s integer NOT NULL,
    points jsonb NOT NULL,
    waypoints jsonb NOT NULL DEFAULT '[]'::jsonb,
    point_count integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT field_routes_ended_after_started CHECK (ended_at >= started_at),
    CONSTRAINT field_routes_distance_range CHECK (distance_m >= 0 AND distance_m <= 100000),
    CONSTRAINT field_routes_duration_range CHECK (duration_s >= 0 AND duration_s <= 86400),
    -- An array of [lat, lng, recorded_at_ms, accuracy_m], 1 to 20,000 points.
    CONSTRAINT field_routes_points_array CHECK (
        CASE WHEN jsonb_typeof(points) = 'array'
             THEN jsonb_array_length(points) BETWEEN 1 AND 20000
             ELSE false END
    ),
    CONSTRAINT field_routes_point_count_matches CHECK (
        CASE WHEN jsonb_typeof(points) = 'array'
             THEN point_count = jsonb_array_length(points)
             ELSE false END
    ),
    -- An array of { number, label, lat, lng, time }, at most 200.
    CONSTRAINT field_routes_waypoints_array CHECK (
        CASE WHEN jsonb_typeof(waypoints) = 'array'
             THEN jsonb_array_length(waypoints) <= 200
             ELSE false END
    ),
    -- The same phone route is stored once per botanist (safe repeat uploads).
    CONSTRAINT field_routes_one_per_client_route UNIQUE (recorded_by, client_route_id)
);

COMMENT ON TABLE public.field_routes IS
    'Trace routes (transects) recorded on the phone. Botanists insert/read their own; officers read all. No updates or deletes.';

-- The officer map lists recent routes first (default: last 90 days).
CREATE INDEX field_routes_ended_at_idx ON public.field_routes (ended_at DESC);

ALTER TABLE public.field_routes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_routes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.field_routes TO authenticated;

CREATE POLICY "botanists insert own routes"
    ON public.field_routes FOR INSERT TO authenticated
    WITH CHECK (
        recorded_by = (SELECT auth.uid())
        AND (SELECT public.current_app_role()) = 'botanist'
    );

CREATE POLICY "botanists read own routes"
    ON public.field_routes FOR SELECT TO authenticated
    USING (
        recorded_by = (SELECT auth.uid())
        AND (SELECT public.current_app_role()) = 'botanist'
    );

CREATE POLICY "officers read all routes"
    ON public.field_routes FOR SELECT TO authenticated
    USING ((SELECT public.current_app_role()) = 'officer');

COMMIT;
