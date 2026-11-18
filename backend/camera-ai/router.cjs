'use strict';
const express = require('express');
const { createHash } = require('node:crypto');
const { downloadPhoto } = require('./photo-download.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'id,evidence_id,model,status,attempts,targets,uncertain,scene_status,human_review_required,error_code,created_at,updated_at,completed_at';

function createAIRouter({supabaseUrl=process.env.SUPABASE_URL,readPhoto=downloadPhoto}={}) {
  const router = express.Router();
  router.use((req,res,next) => {
    res.set('Cache-Control','no-store');
    if (!req.user || !req.profile || !req.supabase) return res.sendStatus(401);
    if (req.profile.account_status !== 'active' || !['officer','botanist','researcher'].includes(req.profile.role)) return res.sendStatus(403);
    next();
  });
  router.get('/reviews', async (req,res) => {
    let cursor;
    if(req.query.cursor !== undefined) {
      try {
        if(typeof req.query.cursor!=='string' || req.query.cursor.length>250 || !/^[a-zA-Z0-9_-]+$/.test(req.query.cursor)) throw new Error();
        cursor=JSON.parse(Buffer.from(req.query.cursor,'base64url').toString('utf8'));
        if(!UUID.test(cursor.id) || typeof cursor.created_at!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/.test(cursor.created_at) || !Number.isFinite(Date.parse(cursor.created_at))) throw new Error();
      } catch { return res.sendStatus(400); }
    }
    try {
      let query=req.supabase.from('camera_ai_reviews').select(COLUMNS).order('created_at',{ascending:false}).order('id',{ascending:false});
      if(cursor) query=query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
      const result = await query.limit(26);
      if(result.error) return res.sendStatus(503);
      const data=(result.data || []).slice(0,25);const last=data.at(-1);
      const next_cursor=result.data?.length>25 ? Buffer.from(JSON.stringify({created_at:last.created_at,id:last.id})).toString('base64url') : null;
      return res.json({data,next_cursor});
    } catch { return res.sendStatus(503); }
  });
  router.get('/reviews/:reviewId/photo',async (req,res) => {
    if (!UUID.test(req.params.reviewId)) return res.sendStatus(400);
    try {
      const r = await req.supabase.from('camera_ai_reviews').select('evidence_id').eq('id',req.params.reviewId).maybeSingle();
      if (r.error) return res.sendStatus(503);
      if (!r.data) return res.sendStatus(404);
      const e = await req.supabase.from('alert_camera_evidence').select('file_path,byte_count,sha256').eq('id',r.data.evidence_id).maybeSingle();
      if (e.error) return res.sendStatus(503);
      if (!e.data) return res.sendStatus(404);
      const bytes=await readPhoto({userClient:req.supabase,filePath:e.data.file_path,expectedBytes:e.data.byte_count,supabaseUrl});
      if (bytes.length !== e.data.byte_count || createHash('sha256').update(bytes).digest('hex') !== e.data.sha256) return res.sendStatus(503);
      res.set('X-Content-Type-Options','nosniff');
      return res.type('image/jpeg').send(bytes);
    } catch { return res.sendStatus(503); }
  });
  router.get('/alerts/:alertId/evidence/:evidenceId', async (req,res) => {
    if (![req.params.alertId,req.params.evidenceId].every(id => UUID.test(id))) return res.sendStatus(400);
    try {
      const e = await req.supabase.from('alert_camera_evidence').select('id').eq('id',req.params.evidenceId).eq('alert_id',req.params.alertId).maybeSingle();
      if (e.error) return res.sendStatus(503);
      if (!e.data) return res.sendStatus(404);
      const r = await req.supabase.from('camera_ai_reviews').select(COLUMNS).eq('evidence_id',req.params.evidenceId).maybeSingle();
      return r.error ? res.sendStatus(503) : res.json({data:r.data});
    } catch { return res.sendStatus(503); }
  });
  router.patch('/reviews/:reviewId/human',express.json({limit:'1kb'}),async (req,res) => {
    if (!UUID.test(req.params.reviewId) || !req.body || Object.keys(req.body).length !== 1 ||
      !['confirmed','incorrect','uncertain'].includes(req.body.decision)) return res.sendStatus(400);
    try {
      const r = await req.supabase.rpc('camera_ai_review_human',{p_review:req.params.reviewId,p_decision:req.body.decision});
      if (r.error) return res.sendStatus(r.error.code === '42501' ? 403 : r.error.message === 'REVIEW_NOT_COMPLETED' ? 409 : 503);
      return res.json({data:{id:r.data}});
    } catch { return res.sendStatus(503); }
  });
  return router;
}
module.exports = { createAIRouter };
