'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const express=require('express');
const {createAIRouter}=require('./router.cjs'); const {installCameraAI}=require('./install.cjs');
async function withServer(app,fn) {
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {await fn(`http://127.0.0.1:${server.address().port}`);} finally {await new Promise(resolve=>server.close(resolve));}
}
test('HTTP guards reject anonymous, visitor, suspended and legacy admin; allow active staff',async()=>{
  const app=express(); app.disable('x-powered-by'); let reads=0;
  app.use((req,_res,next)=>{
    const role=req.get('test-role');
    if(role){req.user={id:'test'};req.profile={role,account_status:req.get('test-status')||'active'};
      const q={order:()=>q,limit:async()=>{reads++;return{data:[]};}};
      req.supabase={from:()=>({select:()=>q})};}
    next();
  }); app.use('/ai',createAIRouter());
  await withServer(app,async base=>{
    assert.equal((await fetch(`${base}/ai/reviews`)).status,401);
    for(const role of ['visitor','admin']) assert.equal((await fetch(`${base}/ai/reviews`,{headers:{'test-role':role}})).status,403);
    assert.equal((await fetch(`${base}/ai/reviews`,{headers:{'test-role':'officer','test-status':'suspended'}})).status,403);
    assert.equal(reads,0);
    for(const role of ['officer','botanist','researcher']){
      const r=await fetch(`${base}/ai/reviews`,{headers:{'test-role':role}});
      assert.equal(r.status,200); assert.equal(r.headers.get('cache-control'),'no-store');
    }
    assert.equal(reads,3);
  });
});
test('human endpoint validates body, binds reviewer via user RPC and handles incomplete reviews',async()=>{
  const app=express(); app.disable('x-powered-by'); const calls=[];
  app.use((req,_res,next)=>{req.user={id:'user'};req.profile={role:'botanist',account_status:'active'};
    req.supabase={rpc:async(name,args)=>{calls.push({name,args});return{error:{message:'REVIEW_NOT_COMPLETED'}};}};next();});
  app.use('/ai',createAIRouter());
  await withServer(app,async base=>{
    const url=`${base}/ai/reviews/00000000-0000-0000-0000-000000000001/human`;
    assert.equal((await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:'confirmed',reviewer_id:'other'})})).status,400);
    assert.equal(calls.length,0);
    assert.equal((await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:'confirmed'})})).status,409);
    assert.equal(calls[0].name,'camera_ai_review_human');
    assert.deepEqual(Object.keys(calls[0].args).sort(),['p_decision','p_review']);
  });
});
test('demo has hidden password and rejects exposing server-only configuration',async()=>{
  const app=express();app.disable('x-powered-by');
  const worker=installCameraAI(app,(_req,res)=>res.sendStatus(401),{SUPABASE_URL:'https://example.supabase.co',SUPABASE_KEY:'not-a-public-key'});
  assert.equal(worker.enabled,false);
  await withServer(app,async base=>{
    const r=await fetch(`${base}/camera-ai-demo`);
    assert.equal(r.status,200);assert.equal(r.headers.get('x-frame-options'),'DENY');
    assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
    const body=await r.text();assert.match(body,/type="password"/);assert.doesNotMatch(body,/not-a-public-key/);
    assert.equal((await fetch(`${base}/camera-ai-demo/config`)).status,503);
    assert.equal((await fetch(`${base}/api/iot/camera-ai/reviews`)).status,401);
  }); await worker.stop();
});
test('public demo configuration can expose publishable key only',async()=>{
  const app=express();app.disable('x-powered-by');const worker=installCameraAI(app,(_req,res)=>res.sendStatus(401),{
    SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_unit_test',GEMINI_API_KEY:'private-unit-test-value'});
  await withServer(app,async base=>{
    const r=await fetch(`${base}/camera-ai-demo/config`);assert.equal(r.status,200);
    const data=await r.json();assert.deepEqual(Object.keys(data).sort(),['key','url']);
    assert.equal(data.key,'sb_publishable_unit_test');
    assert.equal(JSON.stringify(data).includes('private-unit-test-value'),false);
  });await worker.stop();
});
test('cursor pagination exposes older tasks and rejects injection before database access',async()=>{
  const app=express();app.disable('x-powered-by');let filter;let reads=0;
  const rows=Array.from({length:26},(_,i)=>({id:`00000000-0000-0000-0000-${String(26-i).padStart(12,'0')}`,created_at:'2026-11-18T10:00:00.123456+00:00'}));
  const q={order:()=>q,or:value=>{filter=value;return q;},limit:async()=>{reads++;return{data:filter?rows.slice(25):rows};}};
  app.use((req,_res,next)=>{req.user={id:'user'};req.profile={role:'officer',account_status:'active'};req.supabase={from:()=>({select:()=>q})};next();});
  app.use('/ai',createAIRouter());
  await withServer(app,async base=>{
    const bad=Buffer.from(JSON.stringify({id:rows[0].id,created_at:'x),id.not.is.null'})).toString('base64url');
    assert.equal((await fetch(`${base}/ai/reviews?cursor=${bad}`)).status,400);assert.equal(reads,0);
    const first=await fetch(`${base}/ai/reviews`).then(r=>r.json());assert.equal(first.data.length,25);assert.ok(first.next_cursor);
    const second=await fetch(`${base}/ai/reviews?cursor=${first.next_cursor}`).then(r=>r.json());
    assert.equal(second.data[0].id,rows[25].id);assert.equal(second.next_cursor,null);assert.match(filter,/123456\+00:00/);
  });
});
