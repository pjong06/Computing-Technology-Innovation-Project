-- Demo plant coordinates (scripts/demo-plant-details/fill.mjs and remove.mjs).
--
-- fill.mjs gives active plants that have NO location a demo point inside Niah National Park,
-- and records it in plants.demo_values.coordinates ({"latitude", "longitude", "gps_accuracy_m"}),
-- like the other generated values (20261121200000_demo_plant_details.sql). remove.mjs empties
-- the location again while the plant is still at that point. Real coordinates are never changed.
--
-- The scripts run locally with the service-role key. They may additionally write only the
-- location and its accuracy; RLS and grants for every other role are unchanged. Existing
-- observations are never updated (new demo observations are inserted, as before).

GRANT UPDATE (location, gps_accuracy_m)
    ON TABLE public.plants TO service_role;
