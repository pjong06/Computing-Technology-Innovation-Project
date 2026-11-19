'use strict';
window.openWorkspaceHistory=function({station,name,range,readings,hasMore,api,exportReadings,formatTime,formatValue,escape:esc,onClose}){
  const dialog=document.createElement('dialog');dialog.className='history-dialog';dialog.setAttribute('aria-labelledby','history-title');
  const rows=readings.slice();let page=1,more=hasMore,busy=false,error='';
  function paint(){
    const shown=rows.slice((page-1)*500,page*500),next=page*500<rows.length||more;
    dialog.innerHTML=`<header class="history-header"><div><h2 id="history-title">Historical readings</h2><p>${esc(name)}</p><p>${esc(formatTime(range.from))} – ${esc(formatTime(range.to))} · Malaysia time</p></div><button class="button" data-history="close" autofocus>Close</button></header><div class="history-error workspace-error" role="alert" ${error?'':'hidden'}>${esc(error)}</div><div class="history-table-scroll"><table><thead><tr><th>Recorded at</th><th>Temperature</th><th>Humidity</th><th>Soil moisture</th><th>Rain intensity</th></tr></thead><tbody>${shown.length?shown.map(r=>`<tr><td>${esc(formatTime(r.recorded_at))}</td><td>${formatValue(r.temperature_c,'°C')}</td><td>${formatValue(r.humidity_percent,'%')}</td><td>${formatValue(r.soil_moisture_pct,'%')}</td><td>${formatValue(r.rain_intensity_pct,'%')}</td></tr>`).join(''):'<tr><td colspan="5">No readings in this range</td></tr>'}</tbody></table></div><footer class="history-footer"><div class="history-pages"><button class="button" data-history="previous" ${busy||page===1?'disabled':''}>Previous</button><span>Page ${page} · ${shown.length} readings</span><button class="button" data-history="next" ${busy||!next?'disabled':''}>${busy?'Loading…':'Next'}</button></div><button class="button primary" data-history="export" ${busy?'disabled':''}>Export</button></footer>`;
  }
  dialog.addEventListener('click',async event=>{
    const button=event.target.closest('[data-history]');if(!button||button.disabled)return;
    const action=button.dataset.history;if(action==='close'){dialog.close();return;}if(busy)return;
    error='';
    try{
      if(action==='previous')page--;
      if(action==='export'){busy=true;paint();await exportReadings({station,range});}
      if(action==='next'){
        if(page*500>=rows.length&&more){busy=true;paint();const result=await api('/readings?'+new URLSearchParams({station,...range,page:Math.floor(rows.length/500)+1}));if(!dialog.isConnected)return;rows.push(...result.data);more=result.has_more;}
        if(page*500<rows.length)page++;
      }
    }catch(e){error=e.message||'Could not load readings';}
    finally{busy=false;if(dialog.isConnected)paint();}
  });
  dialog.addEventListener('close',()=>{dialog.remove();onClose?.();},{once:true});
  paint();document.body.append(dialog);dialog.showModal();
};
