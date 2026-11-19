'use strict';
// Separate retry state for each evidence/hash/size; a fresh signature never resets it.
(function(root,factory){if(typeof module==='object')module.exports=factory();else root.WorkspacePhotos=factory();})(globalThis,()=>{
  class PhotoQueue {
    constructor(limit=2){this.limit=limit;this.active=0;this.waiting=[];}
    run(fn){return new Promise((resolve,reject)=>{this.waiting.push({fn,resolve,reject});this.pump();});}
    pump(){while(this.active<this.limit&&this.waiting.length){const job=this.waiting.shift();this.active++;Promise.resolve().then(job.fn).then(job.resolve,job.reject).finally(()=>{this.active--;this.pump();});}}
  }
  async function retryPhoto(load,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),onFailure=()=>{}}={}){
    for(let attempt=0;attempt<=3;attempt++){
      try{return await load(attempt);}catch(error){onFailure(attempt+1);if(error.permanent||attempt===3)throw error;await sleep(1000*2**attempt);}
    }
  }
  function create({api,download,document:doc=document,URL:urls=URL,clock=Date.now}){
    const queue=new PhotoQueue(2),entries=new Map(),links=new Map();
    function attach(host,alertId,evidence,size='thumbnail'){
      const key=[alertId,evidence.id,evidence.sha256,size].join(':');let entry=entries.get(key);
      if(!entry){
        const node=doc.createElement('div');node.className='workspace-photo';
        const image=doc.createElement('img');image.alt='Camera evidence';image.hidden=true;
        const status=doc.createElement('span');status.className='photo-loading';status.textContent='Loading photo…';
        const refresh=doc.createElement('button');refresh.className='button photo-refresh';refresh.textContent='Refresh';refresh.hidden=true;
        node.append(image,status,refresh);
        entry={node,image,status,refresh,failures:0,loaded:false,running:false,disposed:false,url:null};entries.set(key,entry);
        const path=`/alerts/${encodeURIComponent(alertId)}/evidence/${encodeURIComponent(evidence.id)}`;
        async function getBytes(){
          if(size==='thumbnail')return download(path+'/thumbnail',true);
          let link=links.get(key);
          if(!link||link.expires<=clock()+3000){const signed=await api(path+'/url');link={url:signed.url,expires:clock()+signed.expires_in*1000};links.set(key,link);}
          try{return await download(link.url,false);}catch(error){links.delete(key);throw error;}
        }
        async function start(manual=false){
          if(entry.running||entry.loaded||entry.disposed)return;
          if(manual)entry.failures=0; // Explicit user action starts one new bounded cycle.
          entry.running=true;refresh.hidden=true;status.hidden=false;status.textContent='Loading photo…';node.classList.remove('photo-failed');
          try{
            const blob=await retryPhoto(()=>queue.run(async()=>{
              if(entry.disposed)throw Object.assign(new Error('Cancelled'),{permanent:true});
              const bytes=await getBytes();const url=urls.createObjectURL(bytes);
              try{const probe=doc.createElement('img');probe.src=url;await probe.decode();return {bytes,url};}catch(error){urls.revokeObjectURL(url);throw error;}
            }),{onFailure:n=>{entry.failures=n;}});
            if(entry.disposed){urls.revokeObjectURL(blob.url);return;}
            entry.url=blob.url;image.src=blob.url;image.hidden=false;entry.loaded=true;status.hidden=true;
          }catch(error){if(!entry.disposed){node.classList.add('photo-failed');status.textContent=error.permanent?'Photo unavailable':'Could not load photo';refresh.hidden=!!error.permanent;}}
          finally{entry.running=false;}
        }
        refresh.addEventListener('click',()=>start(true));entry.start=start;
      }
      // Reuse the actual decoded image node during refreshes, not only its URL.
      host.replaceChildren(entry.node);
      if(!entry.loaded&&!entry.running&&entry.failures===0){
        if(typeof IntersectionObserver==='undefined')entry.start();
        else{const observer=new IntersectionObserver(items=>{if(items.some(i=>i.isIntersecting)){observer.disconnect();entry.start();}});observer.observe(entry.node);}
      }
      for(const [oldKey,old]of entries){if(entries.size<=12)break;if(!old.node.isConnected&&!old.running&&oldKey!==key){old.disposed=true;if(old.url)urls.revokeObjectURL(old.url);entries.delete(oldKey);links.delete(oldKey);}}
      return entry;
    }
    function clear(){for(const e of entries.values()){e.disposed=true;if(e.url)urls.revokeObjectURL(e.url);}entries.clear();links.clear();}
    return {attach,clear};
  }
  return {PhotoQueue,retryPhoto,create};
});
