'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { createHash } = require('node:crypto'); const { createWorker, startWorker } = require('./worker.cjs');
const { MODEL } = require('./gemini-review.cjs');
function setup({ badHash=false, publicBucket=false, leaseLost=false, analysisError=false, saveError=false }={}) {
  const bytes=Buffer.from('controlled image');
  const job={id:'job',lease_token:'lease',evidence_id:'photo',alert_id:'alert',model:MODEL,file_path:'station/alert/photo.jpg',byte_count:bytes.length,sha256:badHash?'a'.repeat(64):createHash('sha256').update(bytes).digest('hex')};
  const calls=[]; let analysed=0;
  const client={
    rpc:async (name,args) => {calls.push({name,args}); return name==='camera_ai_claim' ? {data:job} : {data:!leaseLost,error:saveError?{}:null};},
    storage:{ getBucket:async () => ({data:{public:publicBucket}}), from:() => ({download:async () => ({data:new Blob([bytes])})}) },
  };
  const worker=createWorker({client,apiKey:'unit-test-value',prepare:async b=>b,analyse:async ()=>{
    analysed++; if (analysisError) throw new Error('GEMINI_HTTP_429');
    return {targets:['person'],uncertain:false,scene_status:'target_detected'};
  },log:()=>{}});
  return {worker,calls,analysed:()=>analysed};
}
test('worker links exactly the claimed job and lease; never updates alert lifecycle',async()=>{
  const s=setup(); assert.equal((await s.worker.tick()).outcome,'completed');
  assert.equal(s.analysed(),1); assert.deepEqual(s.calls.map(c=>c.name),['camera_ai_claim','camera_ai_finish']);
  assert.equal(s.calls[1].args.p_job,'job'); assert.equal(s.calls[1].args.p_lease,'lease');
  assert.equal(s.calls[1].args.p_result.scene_status,'target_detected');
});
test('wrong bytes or public bucket are never sent to model',async()=>{
  for (const options of [{badHash:true},{publicBucket:true}]) {
    const s=setup(options); assert.equal((await s.worker.tick()).outcome,'attempt-failed');
    assert.equal(s.analysed(),0); assert.ok(s.calls[1].args.p_error);
  }
});
test('429 records safe error without immediate retry',async()=>{
  const s=setup({analysisError:true}); await s.worker.tick();
  assert.equal(s.analysed(),1); assert.equal(s.calls[1].args.p_error,'GEMINI_HTTP_429');
});
test('stale lease and save failure never report completion',async()=>{
  assert.equal((await setup({leaseLost:true}).worker.tick()).outcome,'lease-lost');
  await assert.rejects(setup({saveError:true}).worker.tick(),/AI_RESULT_SAVE_FAILED/);
});
test('disabled worker does not read key, contact database or start timers',async()=>{
  const worker=startWorker({}); assert.equal(worker.enabled,false); await worker.stop();
});
test('overlapping tick does not claim twice',async()=>{
  let resolve; let claims=0;
  const worker=createWorker({apiKey:'unit-test-value',client:{rpc:()=>{claims++;return new Promise(r=>{resolve=r;});}}});
  const first=worker.tick(); assert.equal((await worker.tick()).outcome,'busy');
  resolve({data:null}); await first; assert.equal(claims,1);
});
