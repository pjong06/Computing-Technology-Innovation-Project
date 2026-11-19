-- User-approved and applied as hosted migration 20261119082701.
-- Existing records/statuses are preserved; acknowledgement means assignment in the new UI.
alter table public.alerts
  add column assigned_to uuid references public.profiles(id),
  add column assigned_by uuid references public.profiles(id),
  add column assigned_at timestamptz,
  add column assignment_notes text check (length(assignment_notes) <= 2000);
create index alerts_assignee_status_time on public.alerts(assigned_to,alert_status,triggered_at desc,id);
create index if not exists sensor_readings_station_time_id on public.sensor_readings(station_id,recorded_at,id);

-- The same JWT role must be enforced for direct Data API access as for Express.
alter policy "botanists and researchers read alerts" on public.alerts
  using ((select public.current_app_role())='botanist' and assigned_to=(select auth.uid()));
alter policy staff_handle_alerts on public.alerts
  using ((select public.current_app_role())='botanist' and assigned_to=(select auth.uid()) and alert_status='acknowledged')
  with check ((select public.current_app_role())='botanist' and assigned_to=(select auth.uid()) and alert_status='resolved');
alter policy "botanists and researchers read sensor readings" on public.sensor_readings using (false);
alter policy staff_read_sensor_stations on public.sensor_stations using (false);
alter policy botanists_researchers_read_camera_evidence on public.alert_camera_evidence
  using ((select public.current_app_role())='botanist' and exists(select 1 from public.alerts a where a.id=alert_id and a.assigned_to=(select auth.uid())));
alter policy botanists_researchers_read_camera_objects on storage.objects
  using (bucket_id='camera-evidence' and (select public.current_app_role())='botanist'
    and exists(select 1 from public.alert_camera_evidence e join public.alerts a on a.id=e.alert_id where e.file_path=name and a.assigned_to=(select auth.uid())));
alter policy camera_ai_staff_read on public.camera_ai_reviews using ((select public.current_app_role())='officer');
alter policy camera_ai_human_staff_read on public.camera_ai_human_reviews using ((select public.current_app_role())='officer');

-- Column grants do not replace the transition trigger or RLS predicates.
grant select(assigned_to,assigned_by,assigned_at,assignment_notes) on public.alerts to authenticated;
grant update(assigned_to,assignment_notes) on public.alerts to authenticated;

create or replace function public.enforce_alert_staff_transition()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text:=public.current_app_role(); assignment_changed boolean;
begin
  if actor is null or actor_role not in ('officer','botanist') or actor_role is null then
    raise exception 'Active officer or assigned botanist required' using errcode='42501';
  end if;
  if (to_jsonb(new)-array['assigned_to','assigned_by','assigned_at','assignment_notes','alert_status','acknowledged_by','acknowledged_at','resolved_by','resolved_at','resolution_notes'])
     is distinct from (to_jsonb(old)-array['assigned_to','assigned_by','assigned_at','assignment_notes','alert_status','acknowledged_by','acknowledged_at','resolved_by','resolved_at','resolution_notes']) then
    raise exception 'Telemetry and alert identity are immutable' using errcode='42501';
  end if;
  assignment_changed := new.assigned_to is distinct from old.assigned_to or new.assignment_notes is distinct from old.assignment_notes;
  if actor_role='officer' then
    if old.alert_status='resolved' or new.alert_status<>'acknowledged' or new.assigned_to is null then
      raise exception 'Officer must assign an unresolved alert' using errcode='22023';
    end if;
    if not exists(select 1 from public.profiles p where p.id=new.assigned_to and p.role='botanist' and p.account_status='active') then
      raise exception 'Active botanist required' using errcode='22023';
    end if;
    if new.resolution_notes is distinct from old.resolution_notes then raise exception 'Only assignee resolves' using errcode='42501'; end if;
    new.assigned_by:=actor;
    new.assigned_at:=clock_timestamp();
    new.acknowledged_by:=actor;
    new.acknowledged_at:=coalesce(old.acknowledged_at,new.assigned_at);
    new.resolved_by:=old.resolved_by; new.resolved_at:=old.resolved_at;
  else
    if old.assigned_to is distinct from actor or assignment_changed or old.alert_status<>'acknowledged' or new.alert_status<>'resolved'
       or new.assigned_by is distinct from old.assigned_by or new.assigned_at is distinct from old.assigned_at
       or nullif(btrim(new.resolution_notes),'') is null or length(new.resolution_notes)>2000 then
      raise exception 'Only assigned botanist may resolve with notes' using errcode='42501';
    end if;
    new.acknowledged_by:=old.acknowledged_by;new.acknowledged_at:=old.acknowledged_at;
    new.resolved_by:=actor;new.resolved_at:=clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.enforce_alert_staff_transition() from public,anon,authenticated;

-- SECURITY DEFINER is needed only for narrow profile/location reads hidden by RLS.
-- Every function checks the live profile and exposes no unrelated telemetry or identities.
create function public.iot_assignable_botanists()
returns table(id uuid,full_name text) language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'officer' then raise exception 'Officer required' using errcode='42501'; end if;
  return query select p.id,p.full_name from public.profiles p where p.role='botanist' and p.account_status='active' order by p.full_name,p.id limit 200;
end $$;
create function public.iot_task_location(p_alert uuid)
returns table(station_id uuid,station_code text,latitude double precision,longitude double precision,location_note text)
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(public.current_app_role(),'') not in ('officer','botanist') then raise exception 'Staff required' using errcode='42501'; end if;
  return query select s.id,s.station_code,s.latitude,s.longitude,s.location_note from public.sensor_stations s join public.alerts a on a.station_id=s.id
    where a.id=p_alert and (public.current_app_role()='officer' or a.assigned_to=auth.uid());
end $$;
create function public.iot_assign_alert(p_alert uuid,p_botanist uuid,p_notes text,p_expected timestamptz)
returns public.alerts language plpgsql security invoker set search_path='' as $$
declare oldrow public.alerts; result public.alerts;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'officer' then raise exception 'Officer required' using errcode='42501'; end if;
  if p_notes is null or length(p_notes)>2000 then raise exception 'Invalid notes' using errcode='22023'; end if;
  select * into oldrow from public.alerts where id=p_alert for update;
  if not found then raise exception 'Task not found' using errcode='P0002'; end if;
  if oldrow.assigned_at is distinct from p_expected then raise exception 'Task changed' using errcode='40001'; end if;
  update public.alerts set assigned_to=p_botanist,assignment_notes=btrim(p_notes),alert_status='acknowledged' where id=p_alert returning * into result;
  return result;
end $$;
create function public.iot_resolve_assigned_alert(p_alert uuid,p_notes text,p_expected timestamptz)
returns public.alerts language plpgsql security invoker set search_path='' as $$
declare oldrow public.alerts; result public.alerts;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'botanist' then raise exception 'Botanist required' using errcode='42501'; end if;
  if p_notes is null or nullif(btrim(p_notes),'') is null or length(p_notes)>2000 then raise exception 'Handling note required' using errcode='22023'; end if;
  select * into oldrow from public.alerts where id=p_alert and assigned_to=auth.uid() for update;
  if not found then raise exception 'Task not found' using errcode='P0002'; end if;
  if oldrow.assigned_at is distinct from p_expected then raise exception 'Task changed' using errcode='40001'; end if;
  update public.alerts set alert_status='resolved',resolution_notes=btrim(p_notes) where id=p_alert and assigned_to=auth.uid() returning * into result;
  return result;
end $$;
revoke all on function public.iot_assignable_botanists(),public.iot_task_location(uuid),public.iot_assign_alert(uuid,uuid,text,timestamptz),public.iot_resolve_assigned_alert(uuid,text,timestamptz) from public,anon;
grant execute on function public.iot_assignable_botanists(),public.iot_task_location(uuid),public.iot_assign_alert(uuid,uuid,text,timestamptz),public.iot_resolve_assigned_alert(uuid,text,timestamptz) to authenticated;

-- Existing SECURITY DEFINER human-review RPC must not bypass the new read boundary.
create or replace function public.camera_ai_review_human(p_review uuid,p_decision text)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'officer' then raise exception 'OFFICER_REQUIRED' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('confirmed','incorrect','uncertain') then raise exception 'DECISION_INVALID' using errcode='22023'; end if;
  if not exists(select 1 from public.camera_ai_reviews where id=p_review and status='completed') then raise exception 'REVIEW_NOT_COMPLETED'; end if;
  insert into public.camera_ai_human_reviews(review_id,reviewer_id,decision) values(p_review,auth.uid(),p_decision) returning id into new_id;
  return new_id;
end $$;
revoke all on function public.camera_ai_review_human(uuid,text) from public,anon;
grant execute on function public.camera_ai_review_human(uuid,text) to authenticated;
