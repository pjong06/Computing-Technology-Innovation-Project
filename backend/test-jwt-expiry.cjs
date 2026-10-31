// SEC-03: genuine signed JWT expiry. No passwords, JWTs or refresh tokens saved.
const { ask } = require('./test-security-accounts.cjs');
const { createClient } = require('@supabase/supabase-js');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
async function main(){
  if(!process.stdin.isTTY)throw new Error('Run interactively in PowerShell.');
  const port=3002;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_KEY||process.env.SUPABASE_ANON_KEY,url=process.env.SUPABASE_URL;
  let keyRole;try{keyRole=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role;}catch{}
  if(!url?.startsWith('https://')||!(key?.startsWith('sb_publishable_')||keyRole==='anon'))throw new Error('HTTPS and public/anon key required.');
  const occupied=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});if(occupied)throw new Error(`Port ${port} occupied; stop its test before this run.`);
  const destination=path.join(__dirname,`jwt-expiry-${Date.now()}-results.json`);
  const out={started_at:new Date().toISOString(),baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:__dirname,encoding:'utf8'}).trim(),status:'IN PROGRESS',results:[],scope:'Read-only JWT and rejection-body tests. Token retained only in process memory; auto-refresh and persistence disabled.'};
  const save=()=>fs.writeFileSync(destination,JSON.stringify(out,null,2));
  function record(test,pass,detail={}){out.results.push({test,result:pass?'PASS':'FAIL',...detail});save();console.log(`${pass?'PASS':'FAIL'}: ${test}`);if(!pass)throw new Error('Assertion failed; see sanitized results.');}
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});let server;
  const endpoints=['/api/me','/api/plants','/api/iot/summary'];
  async function fetchResponse(target,options={}){
    // Network retries only; HTTP rejection responses are returned without retry.
    for(let attempt=1;attempt<=12;attempt++){
      try{const response=await fetch(target,{...options,signal:AbortSignal.timeout(15000)});const text=await response.text();return {response,text};}
      catch(error){
        out.network_retries=out.network_retries||[];
        out.network_retries.push({at:new Date().toISOString(),attempt,code:error.cause?.code||error.code||error.name,service:target.startsWith(url)?'Supabase':'local backend'});save();
        if(attempt===12)throw error;
        const service=target.startsWith(url)?'Supabase':'local backend';
        console.log(`${service} request failed (${error.cause?.code||error.code||error.name}); retry ${attempt}/12 in 15 seconds.`);
        await new Promise(resolve=>setTimeout(resolve,15000));
      }
    }
  }
  async function request(endpoint,authorization){const {response:r,text}=await fetchResponse(`http://127.0.0.1:${port}${endpoint}`,{headers:authorization===null?{}:{Authorization:authorization}});let body;try{body=JSON.parse(text);}catch{}return {status:r.status,body};}
  function safeBody(body){return !!body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1&&typeof body.message==='string'&&['Bearer token required','Invalid or expired token'].includes(body.message);}
  try{
    let startupError=null;
    server=spawn(process.execPath,['src/server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),MQTT_URL:''},stdio:'ignore',windowsHide:true});
    server.on('error',error=>{startupError=error.code||'SPAWN_ERROR';});
    let ready=false;
    // Startup polling is separate from long network retries: initial refusal
    // is normal while the child process loads its dependencies.
    for(let i=0;i<60;i++){
      if(startupError||server.exitCode!==null)throw new Error(`Backend startup failed (${startupError||server.exitCode}). No token test started.`);
      try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1500)});await r.text();if(r.status===200){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!ready)throw new Error('Backend unavailable before login.');
    console.log(`Local test backend ready on port ${port}.`);
    const input=await ask('Account email (Enter = Researcher test account): ');
    const email=input.trim()||'stevenchengyujay+researcher@gmail.com';let password=await ask('Password (hidden): ',true);
    const {data,error}=await client.auth.signInWithPassword({email,password});password='';
    if(error||!data.session)throw new Error('Login failed.');
    const token=data.session.access_token;
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
    if(!Number.isFinite(claims.exp))throw new Error('JWT has no valid expiration.');
    const fingerprint=createHash('sha256').update(token).digest('hex');
    out.expires_at=new Date(claims.exp*1000).toISOString();out.token_sha256=fingerprint;
    const me=await request('/api/me',`Bearer ${token}`);
    record('Original signed token accepted by backend',me.status===200&&me.body?.id===data.user.id,{http:me.status,role:me.body?.role});
    const parts=token.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
    for(const endpoint of endpoints){
      for(const [condition,authorization] of [['missing',null],['empty','Bearer '],['malformed','Bearer invalid-test-token'],['wrong scheme','Basic invalid'],['tampered genuine signature',`Bearer ${parts.join('.')}`]]){
        const r=await request(endpoint,authorization);record(`${endpoint}: ${condition} rejected without protected fields`,r.status===401&&safeBody(r.body),{http:r.status,body_shape_valid:safeBody(r.body)});
      }
    }
    const waitUntil=claims.exp*1000+75000;
    console.log(`Token expires at ${out.expires_at}. Waiting until 75 seconds after expiry; approximately ${Math.max(0,Math.ceil((waitUntil-Date.now())/60000))} minutes. Keep this window and the computer awake. No token refresh will occur.`);
    out.status='WAITING FOR REAL EXPIRY';save();
    while(Date.now()<waitUntil){const ms=Math.min(30000,waitUntil-Date.now());await new Promise(r=>setTimeout(r,ms));console.log(`Expiry test: ${Math.max(0,Math.ceil((waitUntil-Date.now())/60000))} minute(s) remaining`);}
    // Independent Supabase rejection with explicit expiry reason prevents interpreting
    // unrelated invalidation as proof of expiry. Never save raw responses/tokens.
    const {response:auth,text:raw}=await fetchResponse(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`}});
    const serverDate=auth.headers.get('date');
    const expiredReason=/expir|"exp" claim timestamp check failed/i.test(raw);
    const serverAfterExpiry=!!serverDate&&Date.parse(serverDate)>=claims.exp*1000;
    // Auth may return 403 for an expired JWT; our protected backend normalizes
    // verification failures to 401. Require an explicit expiry reason as well.
    record('Unchanged genuine JWT independently rejected for expiry',[401,403].includes(auth.status)&&expiredReason&&serverAfterExpiry&&createHash('sha256').update(token).digest('hex')===fingerprint,{http:auth.status,expiry_reason_confirmed:expiredReason,server_date:serverDate,server_after_expiry:serverAfterExpiry});
    for(const endpoint of endpoints){const r=await request(endpoint,`Bearer ${token}`);record(`${endpoint}: genuinely expired JWT rejected without protected fields`,r.status===401&&safeBody(r.body),{http:r.status,body_shape_valid:safeBody(r.body)});}
    out.status='COMPLETE';out.finished_at=new Date().toISOString();save();console.log(`Finished. Results: ${path.basename(destination)}`);
  }catch(e){out.status='INCOMPLETE';out.error=e.code||e.message;save();throw e;}
  finally{server?.kill();try{await client.auth.signOut({scope:'local'});}catch{}process.stdin.pause();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
