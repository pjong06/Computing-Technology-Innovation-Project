-- Fix a concurrent evidence insertion whose transaction timestamp predates AI closure.
-- Keep the nested service-role check; identify unreviewed evidence rather than compare clocks.
create or replace function camera_ai_private.guard_auto_transition()
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
     and exists(select 1 from public.alert_camera_evidence e
       left join public.camera_ai_reviews r on r.evidence_id=e.id
       where e.alert_id=old.id and not camera_ai_private.clear_without_person(r)) then return new;
  end if;
  raise exception 'Invalid AI transition' using errcode='42501';
end $$;
