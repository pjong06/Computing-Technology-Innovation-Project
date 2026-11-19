'use strict';
window.WorkspaceMaps=(()=>{
  const entries=new Map();
  const valid=p=>p.latitude!==null&&p.longitude!==null&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&Math.abs(Number(p.latitude))<=90&&Math.abs(Number(p.longitude))<=180;
  function attach(host,points,key){
    const usable=points.filter(valid);
    if(!usable.length){host.textContent='No station coordinates recorded';host.classList.add('map-empty');return;}
    if(!window.L){host.textContent='Map could not load. Use the location link below.';host.classList.add('map-empty');return;}
    let entry=entries.get(key);
    if(!entry){
      const node=document.createElement('div');node.className='embedded-station-map';node.setAttribute('aria-label','Station location map');host.replaceChildren(node);
      const map=L.map(node,{scrollWheelZoom:false});
      const base='https://server.arcgisonline.com/ArcGIS/rest/services/';
      const street=L.tileLayer(base+'World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles &copy; Esri'}).addTo(map);
      const satellite=L.tileLayer(base+'World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles &copy; Esri'});
      L.control.layers({Street:street,Satellite:satellite}).addTo(map);
      const markers=L.layerGroup().addTo(map);
      entry={node,map,markers,fingerprint:''};entries.set(key,entry);
    }else host.replaceChildren(entry.node);
    const fingerprint=JSON.stringify(usable.map(p=>[p.id||p.station_id,p.station_code,p.latitude,p.longitude]));
    if(entry.fingerprint!==fingerprint){
      entry.markers.clearLayers();
      for(const p of usable){
        const label=document.createElement('span');label.textContent=p.station_code||'Station';
        L.circleMarker([Number(p.latitude),Number(p.longitude)],{radius:8,color:'#334f3f',weight:2,fillColor:'#a6c9ae',fillOpacity:1}).bindTooltip(label,{permanent:true,direction:'top'}).addTo(entry.markers);
      }
      const positions=usable.map(p=>[Number(p.latitude),Number(p.longitude)]);
      if(positions.length===1)entry.map.setView(positions[0],16);
      else entry.map.fitBounds(L.latLngBounds(positions),{padding:[35,35],maxZoom:17});
      entry.fingerprint=fingerprint;
    }
    requestAnimationFrame(()=>entry.map.invalidateSize());
  }
  window.addEventListener('pagehide',()=>{for(const e of entries.values())e.map.remove();entries.clear();});
  return {attach};
})();
