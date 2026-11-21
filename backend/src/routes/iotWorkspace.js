'use strict';
const express = require('express');
const { createHash } = require('node:crypto');
const { downloadPhoto } = require('../../camera-ai/photo-download.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALERT_COLUMNS = 'id,station_id,reading_id,alert_message,severity,alert_status,triggered_at,assigned_to,assigned_by,assigned_at,assignment_notes,resolved_by,resolved_at,resolution_notes,resolution_source,ai_resolution_review_id';
const STATION_COLUMNS = 'id,station_code,station_status,latitude,longitude,location_note';
const READING_COLUMNS = 'id,station_id,recorded_at,received_at,temperature_c,humidity_percent,soil_moisture_pct,rain_intensity_pct,distance_cm,movement_detected';
function fail(res, error) {
  const status = error?.code === '42501' ? 403 : error?.code === 'P0002' ? 404 : error?.code === '40001' ? 409 : error?.code === '22023' ? 400 : 503;
  return res.status(status).json({ message: ({403:'Insufficient permissions',404:'Task not found',409:'Task changed; refresh and retry',400:'Invalid task request'})[status] || 'IoT service unavailable' });
}
function createWorkspaceRouter({ readPhoto = downloadPhoto, resize = async bytes => require('sharp')(bytes, { limitInputPixels: 25000000 }).rotate().resize({width:480,height:320,fit:'inside',withoutEnlargement:true}).jpeg({quality:65}).toBuffer(), now = Date.now } = {}) {
  const router = express.Router();
  const thumbnails = new Map();
  const pending = new Map();
  let busy = 0;
  router.use((req,res,next) => {
    res.set('Cache-Control','no-store');
    if (!req.user || !req.profile || !req.supabase) return res.sendStatus(401);
    if (req.profile.account_status !== 'active' || !['officer','botanist'].includes(req.profile.role)) return res.sendStatus(403);
    next();
  });
  const officer = (req,res,next) => req.profile.role === 'officer' ? next() : res.sendStatus(403);
  router.param('alertId', (req,res,next,id) => UUID.test(id) ? next() : res.sendStatus(400));
  router.param('evidenceId', (req,res,next,id) => UUID.test(id) ? next() : res.sendStatus(400));
  router.get('/session', (req,res) => res.json({data:{id:req.user.id,role:req.profile.role,ai_auto_resolution:true}}));
  router.get('/counts',async(req,res) => {
    try {
      let q=req.supabase.from('alerts').select('id',{count:'exact',head:true});
      q=req.profile.role==='botanist'?q.eq('assigned_to',req.user.id).eq('alert_status','acknowledged'):q.in('alert_status',['open','acknowledged']);
      const r=await q;return r.error?fail(res,r.error):res.json({data:{[req.profile.role==='botanist'?'assigned':'unresolved']:r.count}});
    }catch{return fail(res);}
  });
  router.get('/botanists',officer,async(req,res) => {
    try { const r=await req.supabase.rpc('iot_assignable_botanists');return r.error?fail(res,r.error):res.json({data:r.data}); } catch {return fail(res);}
  });
  router.get('/alert-stations',async(req,res) => {
    try {
      if(req.profile.role==='officer'){
        const r=await req.supabase.from('sensor_stations').select('id,station_code').order('station_code').limit(200);
        return r.error?fail(res,r.error):res.json({data:r.data});
      }
      // Botanists cannot enumerate the station table. Resolve only names of
      // stations attached to their own RLS-visible tasks through the scoped RPC.
      const stations=new Map();let page=0;
      while(page<10){
        const r=await req.supabase.from('alerts').select('id,station_id').eq('assigned_to',req.user.id).order('id').range(page*1000,(page+1)*1000-1);
        if(r.error)return fail(res,r.error);
        for(const alert of r.data||[]){
          if(stations.has(alert.station_id))continue;
          const location=await req.supabase.rpc('iot_task_location',{p_alert:alert.id});
          if(location.error)return fail(res,location.error);
          const station=location.data?.[0];if(station)stations.set(alert.station_id,{id:station.station_id,station_code:station.station_code});
          if(stations.size>200)return res.status(503).json({message:'Too many task stations to list'});
        }
        if((r.data||[]).length<1000)return res.json({data:[...stations.values()].sort((a,b)=>a.station_code.localeCompare(b.station_code))});
        page++;
      }
      return res.status(503).json({message:'Too many assigned tasks to list stations'});
    }catch{return fail(res);}
  });
  router.get('/stations',officer,async(req,res) => {
    try {
      const r=await req.supabase.from('sensor_stations').select(STATION_COLUMNS).order('station_code').limit(200);
      if(r.error)return fail(res,r.error);
      const data=await Promise.all((r.data||[]).map(async station => {
        const latest=await req.supabase.from('sensor_readings').select(READING_COLUMNS).eq('station_id',station.id).order('recorded_at',{ascending:false}).order('id',{ascending:false}).limit(1);
        if(latest.error)throw latest.error;
        return {...station,latest:latest.data?.[0]||null};
      }));
      return res.json({data});
    }catch{return fail(res);}
  });
  router.get('/readings',officer,async(req,res) => {
    const {station,from,to}=req.query;
    const page=Number(req.query.page||1);
    const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
    if(!UUID.test(station)||!iso(from)||!iso(to)||Date.parse(from)>=Date.parse(to)||Date.parse(to)-Date.parse(from)>31*86400000||!Number.isInteger(page)||page<1||page>1000)return res.sendStatus(400);
    try {
      const r=await req.supabase.from('sensor_readings').select(READING_COLUMNS).eq('station_id',station).gte('recorded_at',from).lte('recorded_at',to).order('recorded_at').order('id').range((page-1)*500,page*500);
      return r.error?fail(res,r.error):res.json({data:(r.data||[]).slice(0,500),has_more:(r.data||[]).length>500,page});
    }catch{return fail(res);}
  });
  router.get('/alerts',async(req,res) => {
    const status=req.query.status||'open',page=Number(req.query.page||1);
    const station=req.query.station;
    const resolution=req.query.resolution;
    if(!['open','acknowledged','resolved'].includes(status)||!Number.isInteger(page)||page<1||page>1000||(station!==undefined&&(typeof station!=='string'||!UUID.test(station)))||(resolution!==undefined&&!['ai','staff'].includes(resolution)))return res.sendStatus(400);
    try {
      let q=req.supabase.from('alerts').select(ALERT_COLUMNS,{count:'exact'}).eq('alert_status',status);
      if(req.profile.role==='botanist')q=q.eq('assigned_to',req.user.id);
      if(station)q=q.eq('station_id',station);
      if(resolution)q=q.eq('resolution_source',resolution);
      const r=await q.order('triggered_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*50,page*50-1);
      if(r.error)return fail(res,r.error);
      if(!Number.isSafeInteger(r.count)||r.count<0)return fail(res);
      const totalPages=Math.max(1,Math.ceil(r.count/50));
      return res.json({data:r.data||[],has_more:page<totalPages,page,total:r.count,total_pages:totalPages});
    }catch{return fail(res);}
  });
  async function visibleTask(req) {
    let q=req.supabase.from('alerts').select(ALERT_COLUMNS).eq('id',req.params.alertId);
    if(req.profile.role==='botanist')q=q.eq('assigned_to',req.user.id);
    return q.maybeSingle();
  }
  router.get('/alerts/:alertId/location',async(req,res) => {
    try {const r=await req.supabase.rpc('iot_task_location',{p_alert:req.params.alertId});return r.error?fail(res,r.error):res.json({data:r.data?.[0]||null});}catch{return fail(res);}
  });
  router.patch('/alerts/:alertId/assign',officer,async(req,res) => {
    const b=req.body;
    if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['assigned_to','assignment_notes','expected_assigned_at'].includes(k))||!UUID.test(b.assigned_to)||typeof b.assignment_notes!=='string'||b.assignment_notes.length>2000||!(b.expected_assigned_at===null||typeof b.expected_assigned_at==='string'&&Number.isFinite(Date.parse(b.expected_assigned_at))))return res.sendStatus(400);
    try {const r=await req.supabase.rpc('iot_assign_alert',{p_alert:req.params.alertId,p_botanist:b.assigned_to,p_notes:b.assignment_notes.trim(),p_expected:b.expected_assigned_at});return r.error?fail(res,r.error):res.json({data:r.data});}catch{return fail(res);}
  });
  router.patch('/alerts/:alertId/resolve',async(req,res) => {
    if(req.profile.role!=='botanist')return res.sendStatus(403);
    const b=req.body;
    if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['resolution_notes','expected_assigned_at'].includes(k))||typeof b.resolution_notes!=='string'||!b.resolution_notes.trim()||b.resolution_notes.length>2000||typeof b.expected_assigned_at!=='string'||!Number.isFinite(Date.parse(b.expected_assigned_at)))return res.sendStatus(400);
    try {const r=await req.supabase.rpc('iot_resolve_assigned_alert',{p_alert:req.params.alertId,p_notes:b.resolution_notes.trim(),p_expected:b.expected_assigned_at});return r.error?fail(res,r.error):res.json({data:r.data});}catch{return fail(res);}
  });
  router.get('/alerts/:alertId/evidence',async(req,res) => {
    try {
      const a=await visibleTask(req);if(a.error)return fail(res,a.error);if(!a.data)return res.sendStatus(404);
      const r=await req.supabase.from('alert_camera_evidence').select('id,alert_id,captured_at,byte_count,sha256').eq('alert_id',req.params.alertId).order('captured_at',{ascending:false}).order('id').limit(20);
      return r.error?fail(res,r.error):res.json({data:r.data});
    }catch{return fail(res);}
  });
  async function evidence(req) {
    const a=await visibleTask(req);if(a.error)return {error:a.error};if(!a.data)return {data:null};
    return req.supabase.from('alert_camera_evidence').select('id,file_path,byte_count,sha256').eq('id',req.params.evidenceId).eq('alert_id',req.params.alertId).maybeSingle();
  }
  router.get('/alerts/:alertId/evidence/:evidenceId/url',async(req,res) => {
    try {
      const r=await evidence(req);if(r.error)return fail(res,r.error);if(!r.data)return res.sendStatus(404);
      const link=await req.supabase.storage.from('camera-evidence').createSignedUrl(r.data.file_path,60);
      if(link.error||!link.data?.signedUrl)return fail(res);
      return res.json({url:link.data.signedUrl,expires_in:60});
    }catch{return fail(res);}
  });
  router.get('/alerts/:alertId/evidence/:evidenceId/thumbnail',async(req,res) => {
    try {
      // Re-authorize before serving cached bytes, including after reassignment.
      const r=await evidence(req);if(r.error)return fail(res,r.error);if(!r.data)return res.sendStatus(404);
      const e=r.data,key=e.id+':'+e.sha256;
      let cached=thumbnails.get(key);
      if(cached&&cached.until<now()){thumbnails.delete(key);cached=null;}
      if(!cached){
        if(!pending.has(key)){
          if(busy>=2)return res.status(429).set('Retry-After','2').json({message:'Photo service busy'});
          busy++;
          pending.set(key,(async()=>{
            const bytes=await readPhoto({userClient:req.supabase,filePath:e.file_path,expectedBytes:e.byte_count,supabaseUrl:process.env.SUPABASE_URL});
            if(bytes.length!==e.byte_count||createHash('sha256').update(bytes).digest('hex')!==e.sha256)throw new Error('PHOTO_INTEGRITY');
            const image=await resize(bytes);if(image.length>512000)throw new Error('THUMBNAIL_SIZE');
            if(thumbnails.size>=32)thumbnails.delete(thumbnails.keys().next().value);
            const item={bytes:image,until:now()+300000};thumbnails.set(key,item);return item;
          })().finally(()=>{busy--;pending.delete(key);}));
        }
        cached=await pending.get(key);
      }
      res.set('X-Content-Type-Options','nosniff');return res.type('image/jpeg').send(cached.bytes);
    }catch{return fail(res);}
  });
  return router;
}
module.exports={createWorkspaceRouter};
