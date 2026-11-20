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
  let evidenceCount=1,analysisStatus='pending',hostile=false,alertTotal=101,alertCount=7,role='officer',analysisOverride={},alertFields={};const requested=[];
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname,json=data=>route.fulfill({json:data});requested.push(p);
   if(p.endsWith('/badge-check.html'))return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><nav id="menu"></nav><main></main><script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js"></script><script src="js/shared.js" data-navigation-only></script><script>startSession('+JSON.stringify({id:role,role,email:role+'@example.com'})+');drawMenu("species.html");</script></body></html>'});
   if(p.endsWith('/iot-workspace.html')){const r=await route.fetch();return route.fulfill({response:r,body:(await r.text()).replace(/ integrity="[^"]+"/g,'')});}
   if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'application/javascript',body:"window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture',expires_at:9999999999}}}),signOut:async()=>({})}})}"});
   if(url.hostname==='unpkg.com')return route.fulfill({body:'',contentType:p.endsWith('.css')?'text/css':'application/javascript'});
   if(p==='/api/me')return json({id:role,role,email:role+'@example.com'});
   if(p.endsWith('/session'))return json({data:{id:role,role,ai_auto_resolution:true}});
   if(p.endsWith('/botanists'))return json({data:[{id:'botanist',full_name:'<img src=x onerror=window.injected=true>'}]});
   if(p.endsWith('/counts'))return json({data:{unresolved:hostile?'<img src=x onerror=window.injected=true>':alertCount,assigned:3}});
   if(p.endsWith('/stations'))return json({data:[{id:station,station_code:'North station',latitude:null,longitude:null,station_status:'active',latest:null}]});
   if(p.endsWith('/alert-stations'))return json({data:[{id:station,station_code:'North station'}]});
   if(p.endsWith('/readings')){
    queries.push(Object.fromEntries(url.searchParams));const n=Number(url.searchParams.get('page'));
    return json({data:Array.from({length:n===1?500:1},(_,i)=>({id:String(i),recorded_at:new Date(Date.now()-3600000+i*1000).toISOString(),temperature_c:28,humidity_percent:80,soil_moisture_pct:40,rain_intensity_pct:0})),has_more:n===1});
   }
   if(p.endsWith('/alerts'))return json({data:[{id:hostile?'../outside?x=1':alert,station_id:station,alert_message:'Camera movement within range (movement_nearby_cm)',severity:'high',alert_status:'open',triggered_at:new Date().toISOString(),...alertFields}],has_more:Number(url.searchParams.get('page'))<Math.max(1,Math.ceil(alertTotal/50)),total:alertTotal,total_pages:Math.max(1,Math.ceil(alertTotal/50))});
   if(p.endsWith('/location'))return json({data:{station_code:'North station',latitude:null,longitude:null}});
   if(p.endsWith('/evidence'))return json({data:Array.from({length:evidenceCount},(_,i)=>({id:'photo-'+i,sha256:'fixture',captured_at:new Date().toISOString()}))});
   if(p.endsWith('/thumbnail'))return route.fulfill({status:403,body:'Denied'});
   if(p.includes('/camera-ai/'))return json({data:{status:analysisStatus,targets:p.endsWith('photo-1')?['animal']:[],scene_status:p.endsWith('photo-1')?'target_detected':'no_target_detected',human_review_required:true,uncertain:false,...analysisOverride}});
   if(p.includes('/api/'))return json({data:[],pagination:{total_pages:1}});
   return route.continue();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/portal/iot-workspace.html`);
  await page.waitForFunction(()=>document.querySelector('#iot-alert-menu-count')?.textContent==='7');
  assert.equal(await page.locator('#iot-alert-menu-count').isVisible(),true);
  alertCount=0;await page.locator('[data-action=refresh]').click();await page.waitForFunction(()=>document.querySelector('#iot-alert-menu-count')?.hidden===true);
  alertCount=4;await page.locator('[data-action=refresh]').click();await page.waitForFunction(()=>document.querySelector('#iot-alert-menu-count')?.textContent==='4');
  assert.deepEqual(await page.locator('.metric-tabs .metric-emoji').allTextContents(),['🌡️','💧','🌱']);
  assert.deepEqual(await page.locator('.stations-panel .metric-emoji').allTextContents(),['🌡️','💧','🌱','🌧️']);
  await page.locator('[data-action=more-readings]').click();
  await page.waitForFunction(()=>document.querySelector('.date-help')?.textContent.includes('501 readings'));
  await page.locator('[data-action=refresh]').click();
  await page.waitForFunction(()=>document.querySelector('.date-help')?.textContent.includes('501 readings'));
  await page.locator('[data-action=history]').click();await page.locator('.history-dialog[open]').waitFor();
  await page.locator('[data-history=next]').click();await page.waitForFunction(()=>document.querySelector('.history-pages span')?.textContent.includes('Page 2'));
  await page.keyboard.press('Escape');
  await page.locator('[data-action=page][data-value=alerts]').click();
  await page.waitForFunction(()=>document.querySelector('.pagination span')?.textContent==='Page 1 / 3');
  await page.locator('[data-action=next-page]').click();await page.waitForFunction(()=>document.querySelector('.pagination span')?.textContent==='Page 2 / 3');
  alertTotal=1;await page.locator('[data-action=refresh]').click();await page.waitForFunction(()=>document.querySelector('.pagination span')?.textContent==='Page 1 / 1');
  assert.equal(await page.locator('[data-action=next-page]').isDisabled(),true);
  await page.locator('.alert-row').click();
  await page.waitForFunction(()=>document.querySelector('.ai-result')?.textContent.includes('Waiting for analysis'));
  evidenceCount=2;analysisStatus='completed';
  await page.locator('[data-action=refresh]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#evidence-choice option').length===2&&document.querySelector('.ai-result')?.textContent.includes('Analysis complete'));
  await page.locator('#evidence-choice').selectOption('photo-1');
  await page.waitForFunction(()=>document.querySelector('.ai-result')?.textContent.includes('Animal detected'));
  const spacing=await page.locator('.review-body > .assignment-record').evaluate(n=>({top:n.getBoundingClientRect().top,titleBottom:n.previousElementSibling.getBoundingClientRect().bottom}));assert(spacing.top-spacing.titleBottom>=18);
  for(const [result,text]of [
    [{status:'completed',targets:['person'],scene_status:'target_detected',uncertain:false,human_review_required:true},'Person detected'],
    [{status:'completed',targets:[],scene_status:'unclear',uncertain:true,human_review_required:true},'Unable to determine'],
    [{status:'failed',targets:[],human_review_required:false},'Analysis failed'],
    [{status:'pending',targets:[],human_review_required:false},'Waiting for analysis']
  ]){
    analysisOverride=result;await page.locator('[data-action=refresh]').click();await page.waitForFunction(text=>document.querySelector('.ai-result')?.textContent.includes(text),text);
    assert.match(await page.locator('.ai-result').innerText(),/Human review required/);
    assert.doesNotMatch(await page.locator('.ai-result').innerText(),/No person or animal detected/);
  }
  analysisOverride={status:'completed',targets:['animal'],scene_status:'target_detected',uncertain:false,human_review_required:false};
  alertFields={alert_status:'resolved',resolution_source:'ai',resolution_notes:'No person detected in all reviewed photos.'};
  await page.locator('[data-action=status][data-value=resolved]').click();await page.locator('.alert-row').click();
  await page.waitForFunction(()=>document.querySelector('.ai-detection')?.textContent==='Animal detected');
  assert.equal(await page.locator('label[for=resolution-filter]').innerText(),'Resolved by');
  assert.match(await page.locator('.review-title').innerText(),/AI resolved/i);
  assert.equal(await page.locator('.resolved-by').innerText(),'Resolved by: AI');
  assert.equal(await page.locator('.saved-note p').innerText(),'No person detected in all reviewed photos.');
  analysisOverride={};alertFields={};await page.locator('[data-action=status][data-value=open]').click();await page.locator('.alert-row').click();
  await page.waitForFunction(()=>document.querySelector('#assignee'));
  assert.equal(await page.locator('#assignee option').last().textContent(),'<img src=x onerror=window.injected=true>');
  assert.equal(await page.locator('#menu .who button').innerText(),'Log out');
  assert.equal(await page.locator('.alert-copy strong').innerText(),'Movement detected near station');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  hostile=true;await page.locator('[data-action=refresh]').click();await page.locator('[data-action=severity][data-value=all]').click();await page.locator('.alert-row').click();
  await page.waitForFunction(()=>document.querySelector('#workspace-error')?.textContent.includes('Invalid record identifier'));
  assert.equal(await page.locator('#unresolved-count img').count(),0);
  assert.equal(await page.evaluate(()=>window.injected===true),false);
  assert(!requested.some(p=>p.includes('outside')));

  hostile=false;role='botanist';alertCount=999;
  await page.reload();await page.waitForFunction(()=>document.querySelector('#iot-alert-menu-count')?.textContent==='3');
  assert.equal(await page.locator('#iot-alert-menu-count').getAttribute('aria-label'),'3 assigned tasks');
  role='officer';alertCount=6;
  await page.goto(`http://127.0.0.1:${server.address().port}/portal/badge-check.html`);
  await page.waitForFunction(()=>document.querySelector('#iot-alert-menu-count')?.textContent==='6');
  assert.equal(await page.locator('#iot-alert-menu-count').getAttribute('class'),'menu-count');
  alertCount=0;await page.evaluate(()=>refreshIotAlertMenuCount());assert.equal(await page.locator('#iot-alert-menu-count').isHidden(),true);
  assert.deepEqual(errors,[]);assert(queries.some(q=>q.page==='2'));
  console.log('PASS: loaded history retained, popup paging, selected evidence/AI refresh, switched-photo analysis, shared navigation, labels, mobile layout.');
 }finally{await browser.close();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
})().catch(e=>{console.error(e);process.exit(1)});
