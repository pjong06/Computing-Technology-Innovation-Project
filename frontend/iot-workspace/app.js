'use strict';
void (async()=>{
  const root=document.getElementById('app');
  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const glyph=name=>`<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({station:'<rect x="8" y="9" width="8" height="12" rx="2"/><path d="M9 6a5 5 0 0 1 6 0M6 3a10 10 0 0 1 12 0M11 17h2"/>',alert:'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v1"/>',check:'<path d="m5 12 4 4L19 6"/>',camera:'<rect x="2" y="6" width="20" height="15" rx="3"/><circle cx="12" cy="13" r="4"/>',leaf:'<path d="M20 4C9 2 3 8 6 15s15 5 14-11Z"/><path d="m5 21 10-12"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>'})[name]||'<path d="M3 5h18M3 12h18M3 19h18"/>'}</svg>`;
  let sb,identity,photos;
  const state={page:'overview',status:'open',station:null,alertStation:'all',resolution:'all',alertStations:[],range:'6h',metric:'temperature_c',from:'',to:'',severity:'all',query:'',selected:null,alertPage:1,hasMore:false,alerts:[],stations:[],botanists:[],readings:[],evidence:[],evidenceId:null,location:null,ai:null,error:'',busy:false,loading:false,menu:false,resolving:false,readingsPage:1,readingsMore:false};
  let renderedAlertId=null;
  let requestGeneration=0,detailGeneration=0,alertGeneration=0,polling=false,exporting=false;
  const labels={open:'Unassigned',acknowledged:'Assigned',resolved:'Resolved'};
  const metrics={temperature_c:{label:'Temperature',unit:'°C'},humidity_percent:{label:'Humidity',unit:'%'},soil_moisture_pct:{label:'Soil moisture',unit:'%'}};
  const time=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
  const value=(n,unit='')=>n===null||n===undefined?'—':`${Number(n).toFixed(1)}${unit}`;
  const badge=(text,kind='neutral')=>`<span class="badge ${esc(kind)}">${esc(text)}</span>`;
  const current=()=>state.alerts.find(a=>a.id===state.selected);
  const officer=()=>identity?.role==='officer';
  function dateInput(date){return new Date(date.getTime()+8*3600000).toISOString().slice(0,16);}
  function bounds(){
    if(state.range==='Custom'){
      const start=new Date(state.from+'+08:00'),end=new Date(state.to+'+08:00');
      if(!state.from||!state.to||!Number.isFinite(+start)||!Number.isFinite(+end)||start>=end||end-start>31*86400000)throw new Error('Choose a valid range of up to 31 days.');
      return {from:start.toISOString(),to:end.toISOString()};
    }
    const end=new Date();return {from:new Date(+end-Number.parseInt(state.range)*3600000).toISOString(),to:end.toISOString()};
  }
  async function token(){
    let {data:{session}}=await sb.auth.getSession();
    if(session?.expires_at*1000<Date.now()+60000){const r=await sb.auth.refreshSession();session=r.data.session;}
    if(!session){location.replace('login.html');throw Object.assign(new Error('Please sign in.'),{status:401,permanent:true});}
    return session.access_token;
  }
  function pathId(value){
    if(typeof value!=='string'||!/^[a-zA-Z0-9-]+$/.test(value))throw new Error('Invalid record identifier.');
    return value;
  }
  async function api(path,options={}){
    const response=await fetch('/api/iot-workspace'+path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+await token()},cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(response.status===401){photos?.clear();location.replace('login.html');}
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(body.message||`Request failed (${response.status})`),{status:response.status,permanent:[400,401,403,404].includes(response.status)});
    return body;
  }
  async function download(path,authenticated){
    if(!authenticated){const url=new URL(path),allowed=new URL(sb.supabaseUrl);if(url.protocol!=='https:'||url.origin!==allowed.origin||!url.pathname.startsWith('/storage/v1/object/sign/camera-evidence/'))throw Object.assign(new Error('Invalid photo link'),{permanent:true});}
    const response=await fetch(authenticated?'/api/iot-workspace'+path:path,{headers:authenticated?{Authorization:'Bearer '+await token()}:{},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok){await response.body?.cancel();throw Object.assign(new Error('Photo unavailable'),{permanent:authenticated&&[401,403,404].includes(response.status)});}
    const limit=authenticated?512000:6000000;
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new Error('Photo too large');}
    const reader=response.body.getReader(),parts=[];let total=0;
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new Error('Photo too large');}parts.push(value);}
    return new Blob(parts,{type:response.headers.get('content-type')||'image/jpeg'});
  }
  function summaries(){
    if(!officer())return `<section class="summary botanist-summary"><div class="summary-item"><div class="summary-label">${glyph('check')}Assigned tasks</div><div class="summary-value" id="task-count">${esc(state.taskCount??'—')}</div></div></section>`;
    const online=state.stations.filter(s=>s.latest?.received_at&&Date.now()-Date.parse(s.latest.received_at)<60000&&s.station_status==='active').length;
    return `<section class="summary"><div class="summary-item"><div class="summary-label">${glyph('station')}Monitored stations</div><div class="summary-value">${Number(state.stations.length)}<span class="metric-tag">${online} online</span></div></div><div class="summary-item"><div class="summary-label">${glyph('alert')}Unresolved alerts</div><div class="summary-value" id="unresolved-count">${esc(state.unresolved??'—')}</div></div></section>`;
  }
  function chart(){
    const meta=metrics[state.metric];const rows=state.readings.filter(r=>r[state.metric]!==null&&Number.isFinite(Number(r[state.metric])));
    let plot='<div class="empty-chart">No readings in this range</div>';
    if(rows.length){
      // Reduce only the drawn line; export retains the complete bounded query result.
      const shown=rows.filter((_,i)=>i%Math.max(1,Math.ceil(rows.length/250))===0||i===rows.length-1);
      const nums=shown.map(r=>Number(r[state.metric])),low=Math.min(...nums)-1,high=Math.max(...nums)+1;
      const t0=Date.parse(shown[0].recorded_at),t1=Date.parse(shown.at(-1).recorded_at);
      const points=shown.map(r=>`${40+560*(Date.parse(r.recorded_at)-t0)/Math.max(1,t1-t0)},${180-140*(Number(r[state.metric])-low)/(high-low)}`);
      plot=`<div class="chart-reading"><strong>${value(rows.at(-1)[state.metric])}<small>${meta.unit}</small></strong></div><svg class="trend-svg" viewBox="0 0 660 226" role="img" aria-label="${meta.label} historical readings">${[0,1,2,3].map(i=>`<line class="grid-line" x1="40" x2="610" y1="${40+i*46}" y2="${40+i*46}"/><text x="0" y="${43+i*46}">${(high-i*(high-low)/3).toFixed(1)}</text>`).join('')}<path class="chart-line" d="M${points.join(' L')}"/><text x="40" y="213">${esc(time(shown[0].recorded_at))}</text><text x="480" y="213">${esc(time(shown.at(-1).recorded_at))}</text></svg>`;
    }
    return `<section class="panel chart-panel"><div class="panel-heading"><h2>Environmental trends</h2><div class="trend-controls"><select id="trend-station" aria-label="Station">${state.stations.map((s,i)=>`<option value="${esc(s.id)}" ${state.station===s.id?'selected':''}>Station ${i+1}</option>`).join('')}</select><div class="segments">${['1h','6h','24h','Custom'].map(r=>`<button data-action="range" data-value="${r}" class="${state.range===r?'active':''}">${r==='Custom'?'Custom range':r}</button>`).join('')}</div><button class="button trend-export" data-action="export" ${exporting||!state.station?'disabled':''}>${exporting?'Exporting…':'Export'}</button></div></div>${state.range==='Custom'?`<div class="custom-dates"><label>From<input id="from-date" type="datetime-local" value="${esc(state.from)}"></label><label>To<input id="to-date" type="datetime-local" value="${esc(state.to)}"></label><button class="button" data-action="apply-dates">Apply</button></div>`:''}<div class="metric-tabs">${Object.entries(metrics).map(([key,m])=>`<button data-action="metric" data-value="${key}" class="${state.metric===key?'active':''}">${m.label}</button>`).join('')}</div>${plot}<div class="date-help">Malaysia time · ${state.readings.length} readings${state.readingsMore?' · more available':''}</div>${state.readingsMore?'<button class="button" data-action="more-readings">Load more readings</button>':''}<div class="history-launch"><button class="button" data-action="history" ${!state.station?'disabled':''}>Historical readings</button></div></section>`;
  }
  function network(){return `<section class="panel map-panel"><div class="panel-heading"><h2>Station locations</h2></div><div class="station-map-host" id="station-location-map"></div><ul class="station-locations">${state.stations.map((s,i)=>`<li><strong>Station ${i+1}</strong><small>${esc(s.station_code)}</small>${locationText(s)}</li>`).join('')}</ul></section>`;}
  function locationText(s,embedded=false){
    if(!s)return '<span>No location recorded</span>';
    const coords=s.latitude!==null&&s.longitude!==null&&Number.isFinite(Number(s.latitude))&&Number.isFinite(Number(s.longitude));
    return `${embedded&&coords?'<div class="station-map-host task-map-host" id="task-location-map"></div>':''}<p>${esc(s.location_note||'')}</p>${coords?`<a class="location-link" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${Number(s.latitude)}&mlon=${Number(s.longitude)}#map=17/${Number(s.latitude)}/${Number(s.longitude)}">${Number(s.latitude).toFixed(5)}, ${Number(s.longitude).toFixed(5)} · Open map</a>`:'<small>No coordinates recorded</small>'}`;
  }
  function stationTable(){return `<section class="panel stations-panel"><div class="panel-heading"><h2>Station readings</h2></div><div class="table-scroll"><table><thead><tr><th>Monitoring station</th><th>Status</th><th>Temperature</th><th>Humidity</th><th>Soil moisture</th><th>Rain intensity</th><th>Last seen</th></tr></thead><tbody>${state.stations.map((s,i)=>{const r=s.latest,online=r&&Date.now()-Date.parse(r.received_at)<60000&&s.station_status==='active';return `<tr class="${online?'':'station-offline'}"><td>Station ${i+1}<small class="stale-label">${esc(s.station_code)}</small></td><td><span class="connection-status ${online?'connected':'disconnected'}"><i></i>${online?'Online':'Offline'}</span></td><td>${value(r?.temperature_c,'°C')}</td><td>${value(r?.humidity_percent,'%')}</td><td>${value(r?.soil_moisture_pct,'%')}</td><td>${value(r?.rain_intensity_pct,'%')}</td><td>${esc(time(r?.received_at))}${online?'':'<small class="stale-label">Last received readings</small>'}</td></tr>`;}).join('')}</tbody></table></div></section>`;}
  function alertList(){
    const visible=state.alerts.filter(a=>(state.severity==='all'||a.severity===state.severity)&&[workspaceAlertTitle(a.alert_message),a.alert_message,state.alertStations.find(s=>s.id===a.station_id)?.station_code||''].join(' ').toLowerCase().includes(state.query.toLowerCase()));
    return `<section class="panel alerts-panel"><div class="panel-heading"><h2>${officer()?'Alerts':'Assigned to me'}</h2></div><div class="alert-view-tabs">${(officer()?['open','acknowledged','resolved']:['acknowledged','resolved']).map(s=>`<button data-action="status" data-value="${s}" class="${state.status===s?'active':''}" aria-pressed="${state.status===s}">${labels[s]}</button>`).join('')}</div><div class="alert-station-control"><label for="alert-station">Station</label><select id="alert-station"><option value="all" ${state.alertStation==='all'?'selected':''}>All stations</option>${state.alertStations.map(s=>`<option value="${esc(s.id)}" ${state.alertStation===s.id?'selected':''}>${esc(s.station_code)}</option>`).join('')}</select>${officer()&&identity.ai_auto_resolution&&state.status==='resolved'?`<label for="resolution-filter">Closed by</label><select id="resolution-filter"><option value="all" ${state.resolution==='all'?'selected':''}>All</option><option value="ai" ${state.resolution==='ai'?'selected':''}>AI</option><option value="staff" ${state.resolution==='staff'?'selected':''}>Staff</option></select>`:''}</div><div class="alert-tools"><div class="filter-pills">${['all','critical','high','warning'].map(s=>`<button data-action="severity" data-value="${s}" class="${state.severity===s?'active':''}">${s[0].toUpperCase()+s.slice(1)}</button>`).join('')}</div><label class="search alert-search-field">${glyph('search')}<input id="alert-search" placeholder="Search alerts" aria-label="Search alerts" value="${esc(state.query)}"></label></div><div class="alert-rows">${visible.length?visible.map(a=>`<button class="alert-row ${a.id===state.selected?'selected':''}" data-action="select" data-value="${esc(a.id)}" aria-pressed="${a.id===state.selected}"><span class="alert-symbol ${esc(a.severity)}">${glyph('alert')}</span><span class="alert-copy"><strong>${esc(workspaceAlertTitle(a.alert_message))}</strong><small class="alert-station-name">${esc(state.alertStations.find(s=>s.id===a.station_id)?.station_code||'Station unavailable')}</small><span>${esc(time(a.triggered_at))}</span>${a.assigned_to?`<small class="assigned-line">Assigned to: ${esc(state.botanists.find(b=>b.id===a.assigned_to)?.full_name||(!officer()?'You':'Botanist'))}</small>`:''}</span><span class="alert-end"><span class="alert-badges"><span class="badge status-badge status-${esc(a.alert_status)}">${a.resolution_source==='ai'?'AI resolved':labels[a.alert_status]}</span>${badge(a.severity,a.severity)}</span></span></button>`).join(''):'<div class="empty-state"><h3>No matching tasks</h3></div>'}</div><div class="pagination"><button class="button" data-action="prev-page" ${state.alertPage===1?'disabled':''}>Previous</button><span>Page ${state.alertPage}</span><button class="button" data-action="next-page" ${state.hasMore?'':'disabled'}>Next</button></div></section>`;
  }
  function details(){
    const a=current();
    if(!a)return `<aside class="panel review-panel"><div class="panel-heading"><h2>Alert details</h2></div><div class="empty-state"><h3>No alert selected</h3></div></aside>`;
    return `<aside class="panel review-panel"><div class="panel-heading"><h2>Alert details</h2></div>${state.loading?'<div class="workspace-note">Loading details…</div>':''}${state.evidence.length?`<div class="evidence-host" id="evidence-host"></div><div class="photo-actions"><select id="evidence-choice" aria-label="Evidence photograph">${state.evidence.map((e,i)=>`<option value="${esc(e.id)}" ${e.id===state.evidenceId?'selected':''}>Photo ${i+1} · ${esc(time(e.captured_at))}</option>`).join('')}</select><button class="button" data-action="full-photo">View photo</button></div>`:state.loading?'':'<div class="workspace-note">No photo attached</div>'}<div class="review-body"><div class="review-title">${badge(labels[a.alert_status])}${badge(a.severity,a.severity)}</div><h3>${esc(workspaceAlertTitle(a.alert_message))}</h3><div class="assignment-record"><strong>Location</strong>${locationText(state.location,true)}</div>${officer()&&state.ai?`<section class="ai-result"><h4>Photo review</h4><p>${esc(state.ai.status)} · ${esc((state.ai.targets||[]).join(', ')||state.ai.scene_status||'Awaiting analysis')}</p><span class="workspace-note">${state.ai.human_review_required?'Human review required':'No person detected'}</span></section>`:''}<div class="task-response"><h4>Task</h4>${a.assignment_notes?`<div class="assignment-record"><strong>Assignment note</strong><p>${esc(a.assignment_notes)}</p></div>`:''}${a.alert_status==='resolved'?`<div class="saved-note"><strong>${a.resolution_source==='ai'?'AI resolution reason':'Handling note'}</strong><p>${esc(a.resolution_notes||'—')}</p><small>${esc(time(a.resolved_at))}</small></div>`:officer()?`<label class="task-label">Assign to<select id="assignee"><option value="">Select a botanist</option>${state.botanists.map(b=>`<option value="${esc(b.id)}" ${a.assigned_to===b.id?'selected':''}>${esc(b.full_name||'Botanist')}</option>`).join('')}</select></label><label class="task-label">Assignment note <small>(optional)</small><textarea id="assignment-note" rows="2" maxlength="2000">${esc(a.assignment_notes||'')}</textarea></label><button class="button primary" data-action="assign" ${state.busy?'disabled':''}>${a.assigned_to?'Reassign task':'Assign task'}</button>`:a.assigned_to===identity.id&&a.alert_status==='acknowledged'?`<label class="task-label">Handling note<textarea id="resolution-note" rows="3" maxlength="2000" placeholder="Describe the action taken"></textarea></label><button class="button primary" data-action="resolve" ${state.busy?'disabled':''}>Resolve task</button>`:'<span class="read-only">Awaiting assignment</span>'}</div></div></aside>`;
  }
  function render(){
    const drafts=renderedAlertId===state.selected?[...root.querySelectorAll('.task-label textarea,.task-label select')].filter(n=>n.value!==(n.tagName==='SELECT'?([...n.options].find(o=>o.defaultSelected)||n.options[0])?.value:n.defaultValue)).map(n=>[n.id,n.value]):[];
    const menu=root.querySelector('#menu'),sectionTabs=root.querySelector('#section-tabs');
    document.body.className='live-body';
    root.innerHTML=`<div class="app-shell"><nav id="menu" aria-label="Website navigation"></nav><div class="main-shell"><div class="topbar"><button class="icon-button mobile-menu" data-action="menu" aria-label="Toggle navigation">${glyph('menu')}</button><span class="workspace-label">Niah National Park / Conservation workspace</span></div><main class="live-main"><h1>${officer()?(state.page==='overview'?'Monitoring overview':'Alerts & tasks'):'My assigned tasks'}</h1>${summaries()}<div class="workspace-toolbar">${officer()?`<div class="section-tabs">${['overview','alerts'].map(p=>`<button data-action="page" data-value="${p}" class="${state.page===p?'active':''}">${p==='overview'?'Overview':'Alerts'}</button>`).join('')}</div>`:'<span></span>'}<button class="button" data-action="refresh">${glyph('refresh')}Refresh</button></div><div id="workspace-error" class="workspace-error" role="alert" ${state.error?'':'hidden'}>${esc(state.error)}</div><div class="workspace view-${state.page}">${officer()&&state.page==='overview'?chart()+network()+stationTable():alertList()+details()}</div></main></div></div>`;
    if(menu){root.querySelector('#menu').replaceWith(menu);if(sectionTabs)root.querySelector('main').prepend(sectionTabs);}else drawMenu('iot-workspace.html');
    renderedAlertId=state.selected;for(const [id,value]of drafts){const node=root.querySelector('#'+id);if(node)node.value=value;}
    const host=root.querySelector('#evidence-host'),e=state.evidence.find(e=>e.id===state.evidenceId);
    if(host&&e&&current())photos.attach(host,current().id,e);
    const overviewMap=root.querySelector('#station-location-map');if(overviewMap)WorkspaceMaps.attach(overviewMap,state.stations,'overview');
    const taskMap=root.querySelector('#task-location-map');if(taskMap&&state.location)WorkspaceMaps.attach(taskMap,[state.location],'task');
  }
  function showError(error){state.error=error.message||'Service unavailable';const box=root.querySelector('#workspace-error');if(box){box.hidden=false;box.textContent=state.error;}else render();}
  async function loadReadings(more=false,{keepExtent=false}={}){
    if(!state.station){state.readings=[];return;}
    const generation=++requestGeneration,range=more?(state.readingBounds||bounds()):bounds();
    const first=more?state.readingsPage+1:1,last=more?first:keepExtent?state.readingsPage:1;
    const rows=more?state.readings.slice():[];let loadedPage=first,hasMore=false;
    for(let page=first;page<=last;page++){
      const r=await api('/readings?'+new URLSearchParams({station:state.station,...range,page}));
      if(generation!==requestGeneration)return;
      rows.push(...r.data);loadedPage=page;hasMore=r.has_more;if(!hasMore)break;
    }
    state.readingBounds=range;state.readings=rows;state.readingsPage=loadedPage;state.readingsMore=hasMore;
  }
  async function loadAlerts(){
    const generation=++alertGeneration;
    const r=await api('/alerts?'+new URLSearchParams({status:state.status,page:state.alertPage,...(state.alertStation==='all'?{}:{station:state.alertStation}),...(state.status==='resolved'&&state.resolution!=='all'?{resolution:state.resolution}:{})}));
    if(generation!==alertGeneration)return;
    state.alerts=r.data;state.hasMore=r.has_more;
    if(state.selected&&!current()){detailGeneration++;state.selected=null;state.loading=false;state.evidence=[];state.evidenceId=null;state.location=null;photos.clear();}
  }
  async function counts(){const r=await api('/counts');if(officer())state.unresolved=Number(r.data.unresolved);else state.taskCount=Number(r.data.assigned);const node=root.querySelector(officer()?'#unresolved-count':'#task-count');if(node)node.textContent=officer()?state.unresolved:state.taskCount;}
  async function refresh({automatic=false}={}){
    state.error='';
    try{
      if(officer()&&state.page==='overview'){const r=await api('/stations');state.stations=r.data;if(!state.stations.some(s=>s.id===state.station))state.station=state.stations[0]?.id||null;if(!automatic||state.readingsPage<=1)await loadReadings(false,{keepExtent:true});}
      else {state.alertStations=(await api('/alert-stations')).data;if(state.alertStation!=='all'&&!state.alertStations.some(s=>s.id===state.alertStation))state.alertStation='all';await loadAlerts();}await counts();if(state.page==='alerts'&&current())await loadDetails({preserve:true});else render();
    }catch(error){showError(error);}
  }
  async function loadAnalysis(generation=detailGeneration){
    const a=current(),e=state.evidenceId;if(!officer()||!a||!e)return;
    try{
      const r=await fetch(`/api/iot/camera-ai/alerts/${pathId(a.id)}/evidence/${pathId(e)}`,{headers:{Authorization:'Bearer '+await token()},signal:AbortSignal.timeout(15000)});
      if(!r.ok)return;const body=await r.json();
      if(generation===detailGeneration&&state.selected===a.id&&state.evidenceId===e){state.ai=body.data;render();}
    }catch(error){if(generation===detailGeneration)showError(error);}
  }
  async function loadDetails({preserve=false}={}){
    const a=current();if(!a)return;const generation=++detailGeneration,previous=state.evidenceId;
    if(!preserve){state.loading=true;state.evidence=[];state.evidenceId=null;state.location=null;state.ai=null;render();}
    try{
      const [location,evidence]=await Promise.all([api(`/alerts/${pathId(a.id)}/location`),api(`/alerts/${pathId(a.id)}/evidence`)]);
      if(generation!==detailGeneration||state.selected!==a.id)return;
      state.location=location.data;state.evidence=evidence.data;
      state.evidenceId=preserve&&evidence.data.some(e=>e.id===previous)?previous:evidence.data[0]?.id||null;
      if(state.evidenceId!==previous)state.ai=null;state.loading=false;render();await loadAnalysis(generation);
    }catch(error){if(generation===detailGeneration){state.loading=false;render();showError(error);}}
  }
  async function exportReadings({range=bounds(),station=state.station}={}){
    if(exporting)return;exporting=true;render();
    try{
      const rows=[];let page=1,more=true;
      while(more){const r=await api('/readings?'+new URLSearchParams({station,...range,page}));rows.push(...r.data);more=r.has_more;if(rows.length>50000)throw new Error('Choose a shorter range to export at most 50,000 readings.');page++;}
      const fields=['station_id','recorded_at','received_at','temperature_c','humidity_percent','soil_moisture_pct','rain_intensity_pct'];
      const csv=[fields,...rows.map(r=>fields.map(f=>r[f]??''))].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='sensor-readings.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }finally{exporting=false;render();}
  }
  root.addEventListener('click',async event=>{
    const b=event.target.closest('[data-action]');if(!b||b.disabled)return;const action=b.dataset.action,v=b.dataset.value;
    try{
      if(action==='menu'){state.menu=!state.menu;root.querySelector('#menu')?.classList.toggle('workspace-menu-open',state.menu);return;}
      if(action==='logout'){photos.clear();await sb.auth.signOut({scope:'local'});location.replace('login.html');return;}
      if(action==='refresh'){await refresh();return;}
      if(action==='page'){state.page=v;state.selected=null;state.evidence=[];state.evidenceId=null;detailGeneration++;render();await refresh();return;}
      if(action==='status'){state.status=v;state.selected=null;state.evidence=[];state.evidenceId=null;state.alertPage=1;detailGeneration++;await loadAlerts();render();return;}
      if(action==='severity'){state.severity=v;render();return;}
      if(action==='select'){state.selected=v;state.error='';await loadDetails();return;}
      if(action==='prev-page'||action==='next-page'){state.alertPage+=action==='next-page'?1:-1;state.selected=null;await loadAlerts();render();return;}
      if(action==='metric'){state.metric=v;render();return;}
      if(action==='range'){state.range=v;await loadReadings();render();return;}
      if(action==='apply-dates'){state.from=root.querySelector('#from-date').value;state.to=root.querySelector('#to-date').value;await loadReadings();render();return;}
      if(action==='more-readings'){await loadReadings(true);render();return;}
      if(action==='export'){await exportReadings();return;}
      if(action==='history'){const index=state.stations.findIndex(s=>s.id===state.station);openWorkspaceHistory({station:state.station,name:'Station '+(index+1)+' · '+(state.stations[index]?.station_code||''),range:{...(state.readingBounds||bounds())},readings:state.readings,hasMore:state.readingsMore,api,exportReadings,formatTime:time,formatValue:value,escape:esc,onClose:()=>root.querySelector('[data-action=history]')?.focus()});return;}
      if(action==='full-photo'){
        const e=state.evidence.find(e=>e.id===state.evidenceId);if(!e||!current())return;
        const dialog=document.createElement('dialog');dialog.className='workspace-photo-dialog';const close=document.createElement('button');close.className='button dialog-close';close.textContent='Close';close.onclick=()=>dialog.close();const host=document.createElement('div');host.className='workspace-photo-full';dialog.append(close,host);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();photos.attach(host,current().id,e,'full');return;
      }
      if(action==='assign'||action==='resolve'){
        if(state.busy)return;const a=current();if(!a)return;
        const body=action==='assign'?{assigned_to:root.querySelector('#assignee').value,assignment_notes:root.querySelector('#assignment-note').value,expected_assigned_at:a.assigned_at}:{resolution_notes:root.querySelector('#resolution-note').value,expected_assigned_at:a.assigned_at};
        if(action==='assign'&&!body.assigned_to)throw new Error('Select a botanist.');
        if(action==='resolve'&&!body.resolution_notes.trim())throw new Error('Add a handling note.');
        state.busy=true;b.disabled=true;
        try{await api(`/alerts/${pathId(a.id)}/${action}`,{method:'PATCH',body:JSON.stringify(body)});state.status=action==='assign'?'acknowledged':'resolved';await loadAlerts();await counts();state.busy=false;render();}finally{state.busy=false;b.disabled=false;}
      }
    }catch(error){showError(error);}
  });
  root.addEventListener('change',async event=>{
    try{
      if(event.target.id==='resolution-filter'){state.resolution=event.target.value;state.alertPage=1;state.selected=null;state.evidence=[];state.evidenceId=null;detailGeneration++;await loadAlerts();render();}
      if(event.target.id==='alert-station'){state.alertStation=event.target.value;state.alertPage=1;state.selected=null;state.loading=false;state.evidence=[];state.evidenceId=null;state.location=null;detailGeneration++;await loadAlerts();render();}
      if(event.target.id==='trend-station'){state.station=event.target.value;await loadReadings();render();}
      if(event.target.id==='evidence-choice'){state.evidenceId=event.target.value;state.ai=null;detailGeneration++;render();await loadAnalysis();}
    }catch(error){showError(error);}
  });
  root.addEventListener('input',event=>{if(event.target.id==='alert-search'){const pos=event.target.selectionStart;state.query=event.target.value;render();const input=root.querySelector('#alert-search');input.focus();input.setSelectionRange(pos,pos);}});
  try{
    sb=window.sb;
    if(!sb)throw new Error('Website sign-in is unavailable.');
    identity=(await api('/session')).data;
    const meResponse=await fetch('/api/me',{headers:{Authorization:'Bearer '+await token()},cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!meResponse.ok)throw new Error('Could not verify website session.');
    const me=await meResponse.json(),saved=getCurrentUser();startSession(me,saved?.id===me.id?saved.username:undefined);
    if(!officer()){state.page='alerts';state.status='acknowledged';}else state.botanists=(await api('/botanists')).data;
    const now=new Date();state.from=dateInput(new Date(+now-86400000));state.to=dateInput(now);
    photos=WorkspacePhotos.create({api,download});render();await refresh();
    // Poll data, never signatures or decoded images. Preserve editable notes and photo DOM.
    setInterval(async()=>{if(document.hidden||polling||state.busy||document.querySelector('.history-dialog[open]')||root.querySelector('textarea:focus,select:focus,input:focus')||[...root.querySelectorAll('textarea')].some(n=>n.value!==n.defaultValue))return;polling=true;try{if(officer()&&state.page==='overview'){await refresh({automatic:true});return;}await counts();if(state.page==='alerts'){
      const before=JSON.stringify(state.alerts);await loadAlerts();if(current())await loadDetails({preserve:true});else if(before!==JSON.stringify(state.alerts))render();
    }}catch(error){if([401,403].includes(error.status)){photos.clear();showError(error);}}finally{polling=false;}},30000);
  }catch(error){root.replaceChildren();const msg=document.createElement('p');msg.className='workspace-error';msg.textContent=error.message;root.append(msg);const login=document.createElement('a');login.href='login.html';login.textContent='Return to sign in';root.append(login);}
})().catch(error=>{const root=document.getElementById('app');if(root)root.textContent=error.message||'Workspace unavailable';});
