'use strict';
// Prototype credentials/session exist in browser memory only; no localStorage.
let token; let config; const images = [];
const statusNode = document.getElementById('status');
const results = document.getElementById('results');
const refreshButton = document.getElementById('refresh');
const logoutButton = document.getElementById('logout');
const olderButton = document.getElementById('older');
let nextCursor;
let generation = 0;
function clearResults() { for (const url of images.splice(0)) URL.revokeObjectURL(url); results.replaceChildren(); }
async function api(url,options={}) {
  const r = await fetch(url,{...options,cache:'no-store',headers:{...options.headers,Authorization:`Bearer ${token}`}});
  if (!r.ok) throw new Error(`请求失败 HTTP ${r.status}`);
  return r;
}
async function refresh(cursor) {
  const current = ++generation; clearResults();olderButton.disabled=true;
  try {
    const response = await api(`/api/iot/camera-ai/reviews${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); const payload = await response.json();
    if (current !== generation || !token) return;
    for (const review of payload.data || []) {
      const article = document.createElement('article');
      const title = document.createElement('h2'); title.textContent = `照片 ${review.evidence_id}`; article.append(title);
      const info = document.createElement('p');
      info.textContent = `状态：${review.status}；目标：${(review.targets || []).join('、') || '—'}；场景：${review.scene_status || '—'}；不确定：${review.uncertain ?? '—'}；${review.error_code || ''}；需人工复核`;
      article.append(info);
      const photo = document.createElement('button'); photo.textContent='查看照片';
      photo.addEventListener('click',async () => {
        try {
          const r = await api(`/api/iot/camera-ai/reviews/${encodeURIComponent(review.id)}/photo`);
          const blob = await r.blob(); if (current !== generation || !token) return;
          const url = URL.createObjectURL(blob); images.push(url);
          const image = document.createElement('img'); image.src=url; image.alt='告警关联照片'; image.width=480;
          photo.replaceWith(image);
        } catch (e) { statusNode.textContent=e.message; }
      }); article.append(photo);
      if (review.status === 'completed') {
        for (const [decision,label] of [['confirmed','判断符合照片'],['incorrect','判断错误'],['uncertain','无法确认']]) {
          const button = document.createElement('button'); button.textContent=label;
          button.addEventListener('click',async () => {
            try {
              await api(`/api/iot/camera-ai/reviews/${encodeURIComponent(review.id)}/human`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})});
              statusNode.textContent='人工复核已记录；原 alert 状态未改变。';
            } catch (e) { statusNode.textContent=e.message; }
          }); article.append(button);
        }
      }
      results.append(article);
    }
    nextCursor=payload.next_cursor;olderButton.disabled=!nextCursor;
    statusNode.textContent=`已读取 ${(payload.data || []).length} 条分析任务；刷新返回最新页，下一页查看更早任务。`;
  } catch (e) { if (current === generation) statusNode.textContent=e.message; }
}
document.getElementById('login').addEventListener('submit',async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    config = await fetch('/camera-ai-demo/config',{cache:'no-store'}).then(r => {if (!r.ok) throw new Error(); return r.json();});
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`,{
      method:'POST',headers:{'Content-Type':'application/json',apikey:config.key},
      body:JSON.stringify({email:form.elements.email.value,password:form.elements.password.value}),
    });
    if (!response.ok) throw new Error();
    const session = await response.json(); if (!session.access_token) throw new Error();
    token=session.access_token; form.elements.password.value='';
    refreshButton.disabled=false; logoutButton.disabled=false;
    await refresh();
  } catch { statusNode.textContent='登录或配置不可用；请确认账号、项目及网络。'; }
  finally { form.elements.password.value=''; }
});
refreshButton.addEventListener('click',()=>refresh());
olderButton.addEventListener('click',()=>refresh(nextCursor));
logoutButton.addEventListener('click',async () => {
  const old=token; token=undefined; generation++; clearResults();
  refreshButton.disabled=true; logoutButton.disabled=true;olderButton.disabled=true;nextCursor=undefined;
  try {
    const response = await fetch(`${config.url}/auth/v1/logout?scope=local`,{method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${old}`}});
    statusNode.textContent=response.ok ? '已退出并请求撤销本次会话。' : '本页会话已清除；服务端退出未确认。';
  } catch { statusNode.textContent='本页会话已清除；服务端退出未确认。'; }
});
