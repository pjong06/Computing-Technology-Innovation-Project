'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createHash}=require('node:crypto');
const {createWorkspaceRouter}=require('../src/routes/iotWorkspace');
const {PhotoQueue,retryPhoto}=require('../../frontend/iot-workspace/photos');
const ID='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
async function fixture(t,role='officer',options={}){
  const queries=[],calls=[];
  const client={from(table){
    const conditions=[];let columns;
    const result=()=>{
      if(options.error)return {error:{code:options.error}};
      if(table==='alerts')return {data:options.hidden?null:{id:ID,assigned_to:OTHER,alert_status:'acknowledged'}};
      if(table==='alert_camera_evidence')return {data:{id:OTHER,file_path:'station/photo.jpg',byte_count:(options.bytes||Buffer.from('abc')).length,sha256:createHash('sha256').update(options.bytes||'abc').digest('hex')}};
      return {data:[]};
    };
    const q={};for(const name of ['select','delete','eq','in','order','range','limit','gte','lte'])q[name]=(...args)=>{conditions.push([name,...args]);if(name==='select')columns=args[0];return q;};
    q.maybeSingle=async()=>result();q.then=(yes,no)=>Promise.resolve({...result(),data:table==='alerts'?(options.rows||[]):[],count:options.count===undefined?2:options.count}).then(yes,no);
    queries.push({table,conditions,get columns(){return columns;}});return q;
  },async rpc(name,args){calls.push({name,args});return options.error?{error:{code:options.error}}:{data:{id:ID}};},storage:{from(bucket){assert.equal(bucket,'camera-evidence');return {async createSignedUrl(path,ttl){calls.push({path,ttl});return {data:{signedUrl:'https://project.supabase.co/storage/v1/object/sign/camera-evidence/station/photo.jpg?token=test'}};}};}}};
  const app=express();app.disable('x-powered-by');app.use(express.json());
  app.use((req,res,next)=>{req.user={id:OTHER};req.profile=role?{role,account_status:options.suspended?'suspended':'active'}:null;req.supabase=client;next();});
  app.use(createWorkspaceRouter({readPhoto:async()=>options.bytes||Buffer.from('abc'),...(options.realResize?{}:{resize:async()=>Buffer.from('small')})}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return {queries,calls,async call(path,method='GET',body){const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const bytes=Buffer.from(await r.arrayBuffer());return {status:r.status,headers:r.headers,bytes,body:bytes.toString()};}};
}
test('workspace refuses anonymous, suspended, researcher and unsupported accounts',async t=>{
  for(const [role,options,status]of [[null,{},401],['researcher',{},403],['admin',{},403],['botanist',{suspended:true},403]]){
    const f=await fixture(t,role,options);assert.equal((await f.call('/session')).status,status);
  }
});
test('Botanist cannot read stations, telemetry, directory or assign tasks',async t=>{
  const f=await fixture(t,'botanist');for(const path of ['/stations','/readings','/botanists'])assert.equal((await f.call(path)).status,403);
  assert.equal((await f.call(`/alerts/${ID}/assign`,'PATCH',{})).status,403);assert.equal(f.queries.length,0);
});
test('Botanist list always filters own ID and counts only assigned tasks',async t=>{
  const f=await fixture(t,'botanist');assert.equal((await f.call('/alerts?status=resolved')).status,200);
  assert(f.queries[0].conditions.some(c=>c[0]==='eq'&&c[1]==='assigned_to'&&c[2]===OTHER));
  assert.equal((await f.call('/counts')).status,200);assert(f.queries[1].conditions.some(c=>c[1]==='alert_status'&&c[2]==='acknowledged'));
});

test('compact alert pages use bounded size and retain Botanist assignment filtering',async t=>{
  const f=await fixture(t,'botanist',{count:19});
  const r=await f.call('/alerts?status=acknowledged&page=2&page_size=8');
  assert.equal(r.status,200);
  assert.equal(JSON.parse(r.body).total_pages,3);
  assert.equal(JSON.parse(r.body).has_more,true);
  assert.deepEqual(f.queries[0].conditions.find(c=>c[0]==='range'),['range',8,15]);
  assert(f.queries[0].conditions.some(c=>c[0]==='eq'&&c[1]==='assigned_to'&&c[2]===OTHER));
  for(const size of ['0','51','-1','1.5','invalid',''])assert.equal((await f.call('/alerts?page_size='+size)).status,400);
});
test('task mutations validate payloads and use authenticated RPC with expected version',async t=>{
  const f=await fixture(t);assert.equal((await f.call(`/alerts/${ID}/assign`,'PATCH',{assigned_to:OTHER,assignment_notes:'check',expected_assigned_at:null})).status,200);
  assert.equal(f.calls[0].name,'iot_assign_alert');assert.equal(f.calls[0].args.p_expected,null);
  assert.equal((await f.call(`/alerts/${ID}/assign`,'PATCH',{assigned_to:OTHER,assignment_notes:'check',expected_assigned_at:null,assigned_by:OTHER})).status,400);
  assert.equal((await f.call(`/alerts/${ID}/resolve`,'PATCH',{})).status,403);
  const b=await fixture(t,'botanist');assert.equal((await b.call(`/alerts/${ID}/resolve`,'PATCH',{resolution_notes:' ',expected_assigned_at:'2026-11-19T10:00:00Z'})).status,400);
  assert.equal((await b.call(`/alerts/${ID}/resolve`,'PATCH',{resolution_notes:'Done',expected_assigned_at:'2026-11-19T10:00:00Z'})).status,200);
});
test('conflicting assignment returns 409; history rejects injection and oversized ranges',async t=>{
  const f=await fixture(t,'officer',{error:'40001'});assert.equal((await f.call(`/alerts/${ID}/assign`,'PATCH',{assigned_to:OTHER,assignment_notes:'',expected_assigned_at:null})).status,409);
  const q=await fixture(t);for(const path of ['/readings?station=bad','/alerts?status=open.or.true','/alerts?page=-1',`/readings?station=${ID}&from=2026-01-01T00:00:00Z&to=2026-11-19T00:00:00Z`])assert.equal((await q.call(path)).status,400);
  assert.equal(q.queries.length,0);
});
test('thumbnail cache rechecks task access and full image signatures stay 60 seconds',async t=>{
  const f=await fixture(t,'botanist');const path=`/alerts/${ID}/evidence/${OTHER}`;
  assert.equal((await f.call(path+'/thumbnail')).body,'small');assert.equal((await f.call(path+'/thumbnail')).body,'small');
  assert.equal(f.queries.filter(q=>q.table==='alerts').length,2);
  assert.equal((await f.call(path+'/url')).status,200);assert.equal(f.calls.at(-1).ttl,60);
  const hidden=await fixture(t,'botanist',{hidden:true});assert.equal((await hidden.call(path+'/thumbnail')).status,404);assert.equal(hidden.queries.length,1);
});
test('photo failures stop at initial attempt plus three backoff retries even when URLs change',async()=>{
  let calls=0;const waits=[],failures=[];
  await assert.rejects(retryPhoto(async()=>{calls++;throw new Error('Download failed after signing new URL');},{sleep:async ms=>waits.push(ms),onFailure:n=>failures.push(n)}));
  assert.equal(calls,4);assert.deepEqual(waits,[1000,2000,4000]);assert.deepEqual(failures,[1,2,3,4]);
  calls=0;await assert.rejects(retryPhoto(async()=>{calls++;throw Object.assign(new Error('Denied'),{permanent:true});}));assert.equal(calls,1);
});
test('photo queue never exceeds two concurrent downloads',async()=>{
  const queue=new PhotoQueue(2);let active=0,max=0;
  await Promise.all(Array.from({length:8},()=>queue.run(async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;})));
  assert.equal(max,2);
});

test('thumbnail route reduces real image dimensions and bytes',async t=>{
 const sharp=require('sharp');const bytes=await sharp({create:{width:2400,height:1600,channels:3,background:'#789478'}}).jpeg({quality:95}).toBuffer();
 const f=await fixture(t,'officer',{bytes,realResize:true});const r=await f.call(`/alerts/${ID}/evidence/${OTHER}/thumbnail`);
 assert.equal(r.status,200);const meta=await sharp(r.bytes).metadata();assert(meta.width<=480&&meta.height<=320);assert(r.bytes.length<bytes.length);
});
test('station filtering is server-side and cannot remove Botanist ownership scope',async t=>{
  const f=await fixture(t,'botanist');
  assert.equal((await f.call('/alerts?status=resolved&station='+ID)).status,200);
  const conditions=f.queries[0].conditions;
  assert(conditions.some(c=>c[0]==='eq'&&c[1]==='station_id'&&c[2]===ID));
  assert(conditions.some(c=>c[0]==='eq'&&c[1]==='assigned_to'&&c[2]===OTHER));
  const before=f.queries.length;
  assert.equal((await f.call('/alerts?station=invalid')).status,400);
  assert.equal((await f.call('/alerts?station='+ID+'&station='+OTHER)).status,400);
  assert.equal(f.queries.length,before);
});
test('Botanist station options enumerate only own alerts, never the station table',async t=>{
  const f=await fixture(t,'botanist');assert.equal((await f.call('/alert-stations')).status,200);
  assert(f.queries.every(q=>q.table==='alerts'));
  assert(f.queries[0].conditions.some(c=>c[0]==='eq'&&c[1]==='assigned_to'&&c[2]===OTHER));
});

test('AI resolution filter is a parameterized query and rejects unknown values',async t=>{
 const f=await fixture(t);assert.equal((await f.call('/alerts?status=resolved&resolution=ai')).status,200);
 assert(f.queries[0].conditions.some(c=>c[0]==='eq'&&c[1]==='resolution_source'&&c[2]==='ai'));
 assert.equal((await f.call('/alerts?resolution=forged')).status,400);
});

test('plain alert labels preserve high/low meaning and support existing rule names',()=>{
 const title=require('../../frontend/iot-workspace/alert-labels');
 for(const [raw,want] of [['Camera movement within range (movement_nearby_cm)','Movement detected near station'],['IoT high temperature (temperature_c)','High temperature'],['Steven Sprint2 TEST temperature >35 (temperature_c)','High temperature'],['Low temperature (temperature_c)','Low temperature'],['IoT low soil moisture (soil_moisture_pct)','Low soil moisture'],['IoT heavy rain (rain_intensity_pct)','Heavy rain detected'],['Humidity rule (humidity_percent)','Humidity alert']])assert.equal(title(raw),want);
 assert.equal(title('Unknown alarm'),'Unknown alarm');
});


test('alert pagination counts the filtered RLS-visible dataset and returns exact page totals',async t=>{
 for(const [count,page,pages,more]of [[0,1,1,false],[50,1,1,false],[51,1,2,true],[100,2,2,false],[101,2,3,true]]){
  const f=await fixture(t,'botanist',{count});const r=await f.call('/alerts?status=resolved&station='+ID+'&resolution=ai&page='+page);
  assert.equal(r.status,200);const body=JSON.parse(r.body);assert.equal(body.total,count);assert.equal(body.total_pages,pages);assert.equal(body.has_more,more);
  const conditions=f.queries[0].conditions;
  assert(conditions.some(c=>c[0]==='select'&&c[2]?.count==='exact'));
  for(const [key,value]of [['assigned_to',OTHER],['station_id',ID],['alert_status','resolved'],['resolution_source','ai']])assert(conditions.some(c=>c[0]==='eq'&&c[1]===key&&c[2]===value));
  assert.deepEqual(conditions.find(c=>c[0]==='range'),['range',(page-1)*50,page*50-1]);
 }
});
test('alert pagination never treats unavailable counts as an empty successful list',async t=>{
 const f=await fixture(t,'officer',{count:null});assert.equal((await f.call('/alerts')).status,503);
});


test('only active Officers can delete one valid alert ID through the user-scoped client',async t=>{
 for(const [role,options,status]of [[null,{},401],['botanist',{},403],['researcher',{},403],['officer',{suspended:true},403]]){
  const f=await fixture(t,role,options);assert.equal((await f.call('/alerts/'+ID,'DELETE')).status,status);assert.equal(f.queries.length,0);
 }
 const f=await fixture(t);assert.equal((await f.call('/alerts/not-a-uuid','DELETE')).status,400);assert.equal(f.queries.length,0);
 const result=await f.call('/alerts/'+ID,'DELETE');assert.equal(result.status,200);assert.equal(JSON.parse(result.body).data.id,ID);
 assert.equal(f.queries.length,1);assert.equal(f.queries[0].table,'alerts');assert.deepEqual(f.queries[0].conditions,[['delete'],['eq','id',ID],['select','id']]);
});
test('deleting a missing or RLS-denied alert never returns a false success',async t=>{
 const missing=await fixture(t,'officer',{hidden:true});assert.equal((await missing.call('/alerts/'+ID,'DELETE')).status,404);
 const denied=await fixture(t,'officer',{error:'42501'});assert.equal((await denied.call('/alerts/'+ID,'DELETE')).status,403);
});
