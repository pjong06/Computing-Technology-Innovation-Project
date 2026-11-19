'use strict';
// Isolated PostgreSQL verification; never connects to Supabase or Gemini.
// Set PGLITE_MODULE to a locally installed @electric-sql/pglite package if needed.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const folder=path.resolve(__dirname,'../../supabase/migrations');
(async()=>{
 const db=new PGlite();let checks=0;
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
 grant usage on schema public,auth,storage to authenticated,service_role;grant execute on all functions in schema auth to authenticated,service_role;
 create table public.profiles(id uuid primary key,full_name text,role text,account_status text);
 create function public.current_app_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid() and account_status='active'$$;
 create table public.sensor_stations(id uuid primary key default gen_random_uuid(),station_code text,latitude double precision,longitude double precision,location_note text);
 create table public.sensor_readings(id uuid primary key default gen_random_uuid(),station_id uuid,recorded_at timestamptz);
 create table public.alerts(id uuid primary key default gen_random_uuid(),station_id uuid,reading_id uuid,alert_message text,severity text,alert_status text default 'open',triggered_at timestamptz default now(),acknowledged_by uuid,acknowledged_at timestamptz,resolved_by uuid,resolved_at timestamptz,resolution_notes text);
 create table public.alert_camera_evidence(id uuid primary key default gen_random_uuid(),alert_id uuid references public.alerts(id),file_path text,byte_count integer,sha256 text,created_at timestamptz default now());
 create table storage.objects(id uuid,bucket_id text,name text);
 create function public.enforce_alert_staff_transition() returns trigger language plpgsql as $$begin return new;end$$;
 create trigger enforce_alert_staff_transition before update on public.alerts for each row execute function public.enforce_alert_staff_transition();
 alter table public.alerts enable row level security;alter table public.sensor_readings enable row level security;alter table public.sensor_stations enable row level security;alter table public.alert_camera_evidence enable row level security;alter table storage.objects enable row level security;
 create policy "officers read alerts" on public.alerts for select to authenticated using(public.current_app_role()='officer');create policy "officers update alerts" on public.alerts for update to authenticated using(public.current_app_role()='officer') with check(public.current_app_role()='officer');
 create policy "botanists and researchers read alerts" on public.alerts for select to authenticated using(true);create policy staff_handle_alerts on public.alerts for update to authenticated using(true) with check(true);
 create policy "botanists and researchers read sensor readings" on public.sensor_readings for select to authenticated using(true);create policy staff_read_sensor_stations on public.sensor_stations for select to authenticated using(true);
 create policy botanists_researchers_read_camera_evidence on public.alert_camera_evidence for select to authenticated using(true);create policy botanists_researchers_read_camera_objects on storage.objects for select to authenticated using(true);
 grant select on public.alerts,public.sensor_stations,public.sensor_readings,public.alert_camera_evidence,storage.objects to authenticated;grant update(alert_status,resolution_notes) on public.alerts to authenticated;
 grant insert on public.alert_camera_evidence to service_role;grant select(id) on public.alert_camera_evidence to service_role;
 insert into public.profiles values('10000000-0000-4000-8000-000000000001','Officer','officer','active'),('20000000-0000-4000-8000-000000000001','Botanist','botanist','active');`);
 for(const name of ['20261118120218_camera_ai_persistent_review_queue.sql','20261119082701_assigned_iot_workspace.sql','20261119103249_camera_ai_no_person_resolution.sql','20261119105800_camera_ai_reopen_pending_evidence_guard.sql'])await db.exec(fs.readFileSync(path.join(folder,name),'utf8'));
 await db.exec("update camera_ai_private.settings set enabled=true,auto_resolution_enabled=true,auto_resolution_since='2000-01-01' where singleton;");
 const worker=async()=>db.exec("reset role;set request.jwt.claim.sub='';set request.jwt.claim.role='service_role';set role service_role;");
 const owner=async()=>db.exec("reset role;set request.jwt.claim.sub='';set request.jwt.claim.role='';");
 const equal=(a,b)=>{assert.equal(a,b);checks++;};
 async function photo(alert,created){
   const e=(await db.query('insert into public.alert_camera_evidence(alert_id,file_path,byte_count,sha256,created_at) values($1,$2,1,$3,coalesce($4::timestamptz,now())) returning id',[alert,'fixture.jpg','a'.repeat(64),created||null])).rows[0].id;
   return e;
 }
 async function fixture({message='Movement (movement_detected)',station='steven-sprint2-test-01',assigned=false,old=false,photos=1}={}){
   await owner();const s=(await db.query('insert into public.sensor_stations(station_code) values($1) returning id',[station])).rows[0].id;
   const a=(await db.query('insert into public.alerts(station_id,alert_message,severity,alert_status,assigned_to) values($1,$2,$3,$4,$5) returning id',[s,message,'high',assigned?'acknowledged':'open',assigned?'20000000-0000-4000-8000-000000000001':null])).rows[0].id;
   const jobs=[];
   for(let i=0;i<photos;i++){
     const e=await photo(a,old?'1999-01-01':null);
     let j=(await db.query('select id from public.camera_ai_reviews where evidence_id=$1',[e])).rows[0]?.id;
     if(!j)j=(await db.query('insert into public.camera_ai_reviews(evidence_id) values($1) returning id',[e])).rows[0].id;
     const lease=(await db.query("update public.camera_ai_reviews set status='processing',attempts=1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning lease_token",[j])).rows[0].lease_token;
     jobs.push({id:j,lease,evidence:e});
   }
   return {id:a,jobs};
 }
 async function finish(job,result,error=null){await worker();return (await db.query('select public.camera_ai_finish($1,$2,$3,$4) as ok',[job.id,job.lease,result,error])).rows[0].ok;}
 async function alert(id){await owner();return (await db.query('select * from public.alerts where id=$1',[id])).rows[0];}
 const empty={targets:[],uncertain:false,scene_status:'no_target_detected'},animal={targets:['animal'],uncertain:false,scene_status:'target_detected'};
 for(const result of [empty,animal]){
   const f=await fixture();equal(await finish(f.jobs[0],result),true);let a=await alert(f.id);equal(a.alert_status,'resolved');equal(a.resolution_source,'ai');equal(a.resolved_by,null);assert.match(a.resolution_notes,/no person detected/);checks++;
   equal((await db.query('select human_review_required from public.camera_ai_reviews where id=$1',[f.jobs[0].id])).rows[0].human_review_required,false);
   equal(await finish(f.jobs[0],result),false);
 }
 for(const result of [{targets:['person'],uncertain:false,scene_status:'target_detected'},{targets:['person','animal'],uncertain:false,scene_status:'target_detected'},{targets:[],uncertain:true,scene_status:'unclear'},{targets:['animal'],uncertain:true,scene_status:'target_detected'}]){
   const f=await fixture();await finish(f.jobs[0],result);equal((await alert(f.id)).alert_status,'open');
 }
 for(const options of [{message:'Temperature (temperature_c)'},{station:'outside-approved-scope'},{assigned:true},{old:true}]){
   const f=await fixture(options);await finish(f.jobs[0],empty);equal((await alert(f.id)).alert_status,options.assigned?'acknowledged':'open');
 }
 const multi=await fixture({photos:2});await finish(multi.jobs[0],empty);equal((await alert(multi.id)).alert_status,'open');await finish(multi.jobs[1],animal);equal((await alert(multi.id)).alert_status,'resolved');
 // A late photo reopens only an AI resolution and waits for a fresh result.
 await worker();await photo(multi.id,'2001-01-01');equal((await alert(multi.id)).alert_status,'open');
 const mixed=await fixture({photos:2});await finish(mixed.jobs[0],empty);await finish(mixed.jobs[1],{targets:['person'],uncertain:false,scene_status:'target_detected'});equal((await alert(mixed.id)).alert_status,'open');
 const failed=await fixture();await finish(failed.jobs[0],null,'GEMINI_HTTP_429');equal((await alert(failed.id)).alert_status,'open');
 const disabled=await fixture();await owner();await db.exec('update camera_ai_private.settings set auto_resolution_enabled=false where singleton');await finish(disabled.jobs[0],empty);equal((await alert(disabled.id)).alert_status,'open');
 await owner();await db.exec('update camera_ai_private.settings set auto_resolution_enabled=true where singleton');
 const forged=await fixture();await db.exec("set request.jwt.claim.role='service_role'");await assert.rejects(db.query("update public.alerts set alert_status='resolved',resolution_source='ai',resolved_at=now() where id=$1",[forged.id]));checks++;
 console.log(JSON.stringify({result:'PASS',checks,scope:'Isolated PostgreSQL only; no hosted changes or Gemini calls'}));await db.close();
})().catch(e=>{console.error(e.message,e.cause||'');process.exit(1)});
