-- Task 6: record live public-table RLS enablement in version control.
-- Existing tables must exist. Policies, grants, owners and FORCE RLS are unchanged.
-- Re-running ENABLE ROW LEVEL SECURITY is idempotent.
-- Views are intentionally excluded; this does not reconstruct the schema/policies.
BEGIN;
ALTER TABLE public.alert_camera_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observation_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.park_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_edit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_observation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.species ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.species_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.species_reference_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_reservation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_plant_migration_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_species ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_users ENABLE ROW LEVEL SECURITY;
COMMIT;
