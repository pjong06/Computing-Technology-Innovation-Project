-- Review proposal: disabled until explicitly enabled for the approved test station.
alter table camera_ai_private.settings
  add column auto_resolution_enabled boolean not null default false,
  add column auto_resolution_since timestamptz;
alter table public.alerts
  add column resolution_source text not null default 'staff' check(resolution_source in ('staff','ai')),
  add column ai_resolution_review_id uuid references public.camera_ai_reviews(id) deferrable initially deferred;
grant select(resolution_source,ai_resolution_review_id) on public.alerts to authenticated;
alter table public.camera_ai_reviews drop constraint camera_ai_reviews_human_review_required_check;
alter table public.camera_ai_reviews add constraint camera_ai_review_no_person_check check(
  human_review_required or (status='completed' and uncertain is false and targets is not null
    and not ('person'=any(targets)) and scene_status in ('target_detected','no_target_detected'))
);

create function camera_ai_private.clear_without_person(r public.camera_ai_reviews)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(r.status='completed' and r.uncertain is false and r.model='gemini-3.5-flash-lite'
    and ((r.scene_status='no_target_detected' and cardinality(r.targets)=0)
      or (r.scene_status='target_detected' and r.targets=array['animal']::text[])),false)
$$;
create function camera_ai_private.can_auto_resolve(p_alert uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.alerts a join public.sensor_stations s on s.id=a.station_id
    join camera_ai_private.settings cfg on cfg.singleton
    where a.id=p_alert and a.alert_status='open' and a.assigned_to is null
      and cfg.enabled and cfg.auto_resolution_enabled and s.station_code=cfg.station_code
      and a.alert_message ~ '\((movement_nearby_cm|movement_detected)\)$'
      and exists(select 1 from public.alert_camera_evidence e where e.alert_id=a.id)
      and not exists(select 1 from public.alert_camera_evidence e
        left join public.camera_ai_reviews r on r.evidence_id=e.id
        where e.alert_id=a.id and (cfg.auto_resolution_since is null or e.created_at<cfg.auto_resolution_since
          or not camera_ai_private.clear_without_person(r))))
$$;
create function camera_ai_private.auto_resolution_reason(p_alert uuid)
returns text language sql stable set search_path='' as $$
  select 'AI auto-resolved: no person detected in all ' || count(*)::text || ' attached photo(s); '
    || case when bool_or('animal'=any(r.targets)) then 'animal detected only. ' else 'no person or animal detected. ' end
    || 'Analysis completed without uncertainty (gemini-3.5-flash-lite).'
  from public.alert_camera_evidence e join public.camera_ai_reviews r on r.evidence_id=e.id where e.alert_id=p_alert
$$;

-- Human transitions still use the original assignment guard. A distinct guard
-- permits only nested service-role AI actions; clients cannot forge AI closure.
create function camera_ai_private.guard_auto_transition()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.resolution_source='staff' and new.resolution_source='staff' then return new; end if;
  if pg_trigger_depth()<>2 or auth.role() is distinct from 'service_role' then
    raise exception 'AI transition requires the internal worker trigger' using errcode='42501';
  end if;
  if (to_jsonb(new)-array['alert_status','resolved_at','resolved_by','resolution_notes','resolution_source','ai_resolution_review_id'])
     is distinct from (to_jsonb(old)-array['alert_status','resolved_at','resolved_by','resolution_notes','resolution_source','ai_resolution_review_id']) then
    raise exception 'AI cannot change assignment or alert identity' using errcode='42501';
  end if;
  if new.alert_status='resolved' and new.resolution_source='ai' and old.alert_status='open'
     and new.resolved_by is null and old.assigned_to is null and new.resolved_at is not null
     and camera_ai_private.can_auto_resolve(old.id)
     and new.resolution_notes=camera_ai_private.auto_resolution_reason(old.id)
     and exists(select 1 from public.camera_ai_reviews r join public.alert_camera_evidence e on e.id=r.evidence_id
       where r.id=new.ai_resolution_review_id and e.alert_id=old.id and camera_ai_private.clear_without_person(r)) then return new;
  end if;
  if old.resolution_source='ai' and old.alert_status='resolved' and old.assigned_to is null
     and new.alert_status='open' and new.resolution_source='staff' and new.resolved_at is null
     and new.resolved_by is null and new.resolution_notes is null and new.ai_resolution_review_id is null
     and exists(select 1 from public.alert_camera_evidence e where e.alert_id=old.id and e.created_at>=old.resolved_at) then return new;
  end if;
  raise exception 'Invalid AI transition' using errcode='42501';
end $$;
create trigger camera_ai_guard_alert_update before update on public.alerts
for each row execute function camera_ai_private.guard_auto_transition();
drop trigger enforce_alert_staff_transition on public.alerts;
create trigger enforce_alert_staff_transition before update on public.alerts for each row
when (old.resolution_source='staff' and new.resolution_source='staff')
execute function public.enforce_alert_staff_transition();

create function camera_ai_private.resolve_no_person()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_alert_id uuid;
begin
  if auth.role() is distinct from 'service_role' or not camera_ai_private.clear_without_person(new) then return new; end if;
  select a.id into v_alert_id from public.alerts a join public.alert_camera_evidence e on e.alert_id=a.id
    where e.id=new.evidence_id for update of a;
  if v_alert_id is null or not camera_ai_private.can_auto_resolve(v_alert_id) then return new; end if;
  update public.alerts set alert_status='resolved',resolution_source='ai',ai_resolution_review_id=new.id,
    resolved_by=null,resolved_at=clock_timestamp(),resolution_notes=camera_ai_private.auto_resolution_reason(v_alert_id)
    where id=v_alert_id and alert_status='open' and assigned_to is null;
  update public.camera_ai_reviews set human_review_required=false where evidence_id in(
    select e.id from public.alert_camera_evidence e where e.alert_id=v_alert_id
  );
  return new;
end $$;
create trigger camera_ai_auto_resolve after update of status on public.camera_ai_reviews for each row
when (new.status='completed' and old.status is distinct from 'completed')
execute function camera_ai_private.resolve_no_person();

-- Additional photos invalidate a previous automatic decision. Human resolutions
-- and assigned tasks are never reopened or closed by this mechanism.
create function camera_ai_private.reopen_on_new_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.role()='service_role' then
    update public.alerts set alert_status='open',resolution_source='staff',ai_resolution_review_id=null,
      resolved_by=null,resolved_at=null,resolution_notes=null
      where id=new.alert_id and resolution_source='ai' and alert_status='resolved' and assigned_to is null;
  end if;
  return new;
end $$;
create trigger camera_ai_reopen_new_evidence after insert on public.alert_camera_evidence
for each row execute function camera_ai_private.reopen_on_new_evidence();
revoke all on function camera_ai_private.clear_without_person(public.camera_ai_reviews),camera_ai_private.can_auto_resolve(uuid),camera_ai_private.auto_resolution_reason(uuid),camera_ai_private.guard_auto_transition(),camera_ai_private.resolve_no_person(),camera_ai_private.reopen_on_new_evidence() from public,anon,authenticated,service_role;
