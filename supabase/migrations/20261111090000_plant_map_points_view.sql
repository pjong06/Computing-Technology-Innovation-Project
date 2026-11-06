   -- Plant locations as numbers for the officer distribution map.
   -- security_invoker = true: the view follows the plants table's RLS rules,
   -- so it never shows locations to anyone who can't already read those plants.
   create or replace view public.plant_map_points
   with (security_invoker = true) as
   select
     p.id,
     p.species_id,
     p.qr_code_value,
     p.plant_status,
     p.location_description,
     st_y(p.location::geometry) as latitude,
     st_x(p.location::geometry) as longitude
   from public.plants p
   where p.location is not null
     and p.deleted_at is null;

     
grant select on public.plant_map_points to authenticated;
revoke all on public.plant_map_points from anon;
     