const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { EventEmitter } = require('node:events');
const { installCameraAI } = require('../camera-ai/install.cjs');
const { registerBackendShutdown } = require('../camera-ai/server-lifecycle.cjs');

test('mounting the app never starts AI even if enabled in the test environment', async () => {
  const app = express(); app.disable('x-powered-by');
  // Starting with these deliberately incomplete credentials would throw.
  const cameraAI = installCameraAI(app, (_req,res) => res.sendStatus(401), { CAMERA_AI_ENABLED:'true' }, { startProcessing:false });
  assert.equal(cameraAI.enabled,false);
  assert.throws(() => cameraAI.start(),/AI_DATABASE_CONFIG_REQUIRED/);
  await cameraAI.stop();
});

test('real backend exports the AI demo and protected API without starting the worker', async () => {
  const saved = { SUPABASE_URL:process.env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY, CAMERA_AI_ENABLED:process.env.CAMERA_AI_ENABLED };
  process.env.SUPABASE_URL='https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_integration_fixture';
  process.env.CAMERA_AI_ENABLED='true';
  let server;
  try {
    const app=require('../src/server');
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base=`http://127.0.0.1:${server.address().port}`;
    const demo=await fetch(`${base}/camera-ai-demo`);
    assert.equal(demo.status,200);assert.match(await demo.text(),/Camera AI/);
    assert.match(demo.headers.get('content-security-policy'),/script-src 'self'/);
    assert.equal((await fetch(`${base}/api/iot/camera-ai/reviews`)).status,401);
    assert.equal((await fetch(`${base}/api/health`)).status,200);
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    for(const [key,value] of Object.entries(saved)) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});

test('backend shutdown closes HTTP/MQTT and waits for the current AI attempt once', async () => {
  const signals = new EventEmitter(); const exits=[]; signals.exit=code=>exits.push(code);
  let closed=0; let ended=0; let stopped=0; let finish;
  const stop = registerBackendShutdown({
    server:{close(callback){closed++;callback();}},
    cameraAI:{stop(){stopped++;return new Promise(resolve=>{finish=resolve;});}},
    mqttClient:{end(force,options,callback){ended++;assert.equal(force,false);callback();}},
    processRef:signals,
  });
  signals.emit('SIGTERM'); signals.emit('SIGINT');
  assert.deepEqual(exits,[]); assert.equal(closed,1);assert.equal(ended,1);assert.equal(stopped,1);
  finish(); await stop(); assert.deepEqual(exits,[0]);
});

test('backend shutdown is bounded if a request or worker is stuck', async () => {
  const signals = new EventEmitter(); let exitCode;
  const exited = new Promise(resolve=>{signals.exit=code=>{exitCode=code;resolve();};});
  const keepAlive = setInterval(()=>{},1000);
  try {
    const stop=registerBackendShutdown({server:{close(){}},cameraAI:{stop:async()=>{}},processRef:signals,timeoutMs:10});
    void stop(); await exited; assert.equal(exitCode,1);
  } finally {clearInterval(keepAlive);}
});
