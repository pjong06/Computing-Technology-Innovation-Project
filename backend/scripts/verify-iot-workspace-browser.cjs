'use strict';
// Browser fixtures only. No login, database writes, or real model requests.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const express=require('express');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const server=await new Promise(resolve=>{const app=express();app.disable('x-powered-by');app.use('/portal',express.static(path.resolve(__dirname,'../../frontend')));const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],queries=[];
  page.on('pageerror',e=>errors.push(e.message));
  const station='11111111-1111-4111-8111-111111111111',alert='22222222-2222-4222-8222-222222222222';
  let evidenceCount=1,analysisStatus='pending',hostile=false;const requested=[];
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname,json=data=>route.fulfill({json:data});requested.push(p);
   if(p.endsWith('/iot-workspace.html')){const r=await route.fetch();return route.fulfill({response:r,body:(await r.text()).replace(/ integrity="[^"]+"/g,'')});}
   if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'application/javascript',body:"window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture',expires_at:9999999999}}}),signOut:async()=>({})}})}"});
   if(url.hostname==='unpkg.com')return route.fulfill({body:'',contentType:p.endsWith('.css')?'text/css':'application/javascript'});
   if(p==='/api/me')return json({id:'officer',role:'officer',email:'officer@example.com'});
   if(p.endsWith('/session'))return json({data:{id:'officer',role:'officer',ai_auto_resolution:true}});
   if(p.endsWith('/botanists'))return json({data:[{id:'botanist',full_name:'<img src=x onerror=window.injected=true>'}]});
   if(p.endsWith('/counts'))return json({data:{unresolved:hostile?'<img src=x onerror=window.injected=true>':1}});
   if(p.endsWith('/stations'))return json({data:[{id:station,station_code:'North station',latitude:null,longitude:null,station_status:'active',latest:null}]});
   if(p.endsWith('/alert-stations'))return json({data:[{id:station,station_code:'North station'}]});
   if(p.endsWith('/readings')){
    queries.push(Object.fromEntries(url.searchParams));const n=Number(url.searchParams.get('page'));
    return json({data:Array.from({length:n===1?500:1},(_,i)=>({id:String(i),recorded_at:new Date(Date.now()-3600000+i*1000).toISOString(),temperature_c:28,humidity_percent:80,soil_moisture_pct:40,rain_intensity_pct:0})),has_more:n===1});
   }
   if(p.endsWith('/alerts'))return json({data:[{id:hostile?'../outside?x=1':alert,station_id:station,alert_message:'Camera movement within range (movement_nearby_cm)',severity:'high',alert_status:'open',triggered_at:new Date().toISOString()}],has_more:false});
   if(p.endsWith('/location'))return json({data:{station_code:'North station',latitude:null,longitude:null}});
   if(p.endsWith('/evidence'))return json({data:Array.from({length:evidenceCount},(_,i)=>({id:'photo-'+i,sha256:'fixture',captured_at:new Date().toISOString()}))});
   if(p.endsWith('/thumbnail'))return route.fulfill({status:403,body:'Denied'});
   if(p.includes('/camera-ai/'))return json({data:{status:analysisStatus,targets:p.endsWith('photo-1')?['animal']:[],scene_status:p.endsWith('photo-1')?'target_detected':'no_target_detected',human_review_required:true}});
   if(p.includes('/api/'))return json({data:[],pagination:{total_pages:1}});
   return route.continue();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/portal/iot-workspace.html`);
  await page.locator('[data-action=more-readings]').click();
  await page.waitForFunction(()=>document.querySelector('.date-help')?.textContent.includes('501 readings'));
  await page.locator('[data-action=refresh]').click();
  await page.waitForFunction(()=>document.querySelector('.date-help')?.textContent.includes('501 readings'));
  await page.locator('[data-action=history]').click();await page.locator('.history-dialog[open]').waitFor();
  await page.locator('[data-history=next]').click();await page.waitForFunction(()=>document.querySelector('.history-pages span')?.textContent.includes('Page 2'));
  await page.keyboard.press('Escape');
  await page.locator('[data-action=page][data-value=alerts]').click();await page.locator('.alert-row').click();
  await page.waitForFunction(()=>document.querySelector('.ai-result')?.textContent.includes('pending'));
  evidenceCount=2;analysisStatus='completed';
  await page.locator('[data-action=refresh]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#evidence-choice option').length===2&&document.querySelector('.ai-result')?.textContent.includes('completed'));
  await page.locator('#evidence-choice').selectOption('photo-1');
  await page.waitForFunction(()=>document.querySelector('.ai-result')?.textContent.includes('animal'));
  assert.equal(await page.locator('#assignee option').last().textContent(),'<img src=x onerror=window.injected=true>');
  assert.equal(await page.locator('#menu .who button').innerText(),'Log out');
  assert.equal(await page.locator('.alert-copy strong').innerText(),'Movement detected near station');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  hostile=true;await page.locator('[data-action=refresh]').click();await page.locator('.alert-row').click();
  await page.waitForFunction(()=>document.querySelector('#workspace-error')?.textContent.includes('Invalid record identifier'));
  assert.equal(await page.locator('#unresolved-count img').count(),0);
  assert.equal(await page.evaluate(()=>window.injected===true),false);
  assert(!requested.some(p=>p.includes('outside')));

  assert.deepEqual(errors,[]);assert(queries.some(q=>q.page==='2'));
  console.log('PASS: loaded history retained, popup paging, selected evidence/AI refresh, switched-photo analysis, shared navigation, labels, mobile layout.');
 }finally{await browser.close();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
})().catch(e=>{console.error(e);process.exit(1)});
