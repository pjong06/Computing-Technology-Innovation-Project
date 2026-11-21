-- Demo plant coordinates (scripts/demo-plant-details/fill.mjs and remove.mjs).
--
-- fill.mjs gives active plants that have NO location a demo point inside Niah National Park,
-- and records it in plants.demo_values.coordinates ({"latitude", "longitude", "gps_accuracy_m"}),
-- like the other generated values (20261121200000_demo_plant_details.sql). remove.mjs empties
-- the location again while the plant is still at that point. Real coordinates are never changed.
--
-- fill.mjs also adds fields that are still missing (e.g. the clump width of a moss or
-- liverwort, as diameter_cm) to a plant's existing demo observation (is_demo = true) instead of
-- adding a second one. remove.mjs deletes that observation as before.
--
-- The scripts run locally with the service-role key. They may additionally write only the
-- location and its accuracy, and those observation fields; RLS and grants for every other
-- role are unchanged.

GRANT UPDATE (location, gps_accuracy_m)
    ON TABLE public.plants TO service_role;
GRANT UPDATE (height_cm, diameter_cm, health_status, life_stage)
    ON TABLE public.observations TO service_role;
