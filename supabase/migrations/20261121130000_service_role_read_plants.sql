begin;

-- Read-only access for server-side scripts (iNaturalist plant photo import).
grant select on table public.plants, public.species, public.plant_map_points to service_role;

commit;