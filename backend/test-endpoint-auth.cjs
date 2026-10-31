// Read-only inventory plus unauthenticated rejection tests. No real IDs or users.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const localEnv = path.join(__dirname, '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : path.resolve(__dirname, '../../Computing-Technology-Innovation-Project/backend/.env'), quiet: true });
const mounts = { plants:'/api/plants', identify:'/api/identify', iot:'/api/iot', knowledge:'/api/knowledge', qrBatch:'/api/qr-batch', observations:'/api/observations', reports:'/api/reports', auth:'/api/auth', officerReviews:'/api/officer/reviews', iotIngestion:'/api/ingestion/telemetry' };
async function main(){
  const port=3004;
  const occupied=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});if(occupied)throw new Error('Port 3004 occupied.');
  const output={started_at:new Date().toISOString(),baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:__dirname,encoding:'utf8'}).trim(),status:'IN PROGRESS',source_sha256:{},routes:[],results:[],findings:[],scope:'Current local working source; static literal-route inventory. JWT checks do not prove role/RLS correctness. No valid user/device credentials sent.'};
  const file=path.join(__dirname,`endpoint-auth-${Date.now()}-results.json`);
  const save=()=>fs.writeFileSync(file,JSON.stringify(output,null,2));
  const source=file=>{const bytes=fs.readFileSync(path.join(__dirname,'src',file));output.source_sha256[file]=crypto.createHash('sha256').update(bytes).digest('hex');return bytes.toString();};
  const serverSource=source('server.js');
  for(const [name,prefix] of Object.entries(mounts)){
    // Optional IoT ingestion work may be present in a shared working tree but
    // absent from the authentication-only commit. Inventory mounted routes only.
    if(name==='iotIngestion'&&!serverSource.includes("'/api/ingestion/telemetry'"))continue;
    const text=source(`routes/${name}.js`);
    const globalAuth=/router\.use\(requireAuth/.test(text)||name==='iot';
    const pattern=/router\.(get|post|put|patch|delete)\(\s*(['"])(.*?)\2([\s\S]*?)(?=async\s*\(|\([^)]*\)\s*=>)/g;
    const expectedCount=[...text.matchAll(/router\.(?:get|post|put|patch|delete)\(/g)].length;
    const found=[];
    for(const match of text.matchAll(pattern)){
      const route=prefix+(match[3]==='/'?'':match[3]);
      const retired=name==='auth'&&match[3]==='/temp-password'&&text.includes("code: 'TEMP_PASSWORD_DISABLED'");
      const policy=retired?'retired (410, no credential operations)':name==='iotIngestion'?'device credential (separate from staff JWT)':globalAuth||/requireAuth/.test(match[4])?'staff JWT':'public/ungated';
      found.push({method:match[1].toUpperCase(),path:route,policy,source:`src/routes/${name}.js`,line:text.slice(0,match.index).split('\n').length});
    }
    if(found.length!==expectedCount)throw new Error(`Inventory parser mismatch in ${name}: ${found.length}/${expectedCount}; manual review required.`);
    output.routes.push(...found);
  }
  for(const match of serverSource.matchAll(/app\.get\(\s*(['"])(.*?)\1\s*,([^\n]*)/g))output.routes.push({method:'GET',path:match[2],policy:/requireAuth/.test(match[3])?'staff JWT':'public/ungated',source:'src/server.js',line:serverSource.slice(0,match.index).split('\n').length});
  output.findings.push({id:'AUTH-RESET-01',severity:'HIGH / potentially critical if privileged key configured',endpoint:'POST /api/auth/temp-password',finding:'No requireAuth or proof-of-recovery gate; caller controls identifier and replacement password before admin.updateUserById. Code review finding; actual password mutation deliberately not attempted.',status:'OPEN',recommended_action:'Disable this route or replace with validated Supabase recovery/session flow; never expose a privileged unauthenticated password setter.'});
  save();
  const child=spawn(process.execPath,['src/server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),MQTT_URL:'',IOT_PERSISTENCE_ENABLED:'false',IOT_INGESTION_SERVER_ENABLED:'false'},stdio:'ignore',windowsHide:true});
  async function request(route,authorization){const target=route.path.replace(/:[A-Za-z][A-Za-z0-9_]*/g,'11111111-1111-4111-8111-111111111111');const response=await fetch(`http://127.0.0.1:${port}${target}`,{method:route.method,headers:{...(authorization?{Authorization:authorization}:{}),...(['POST','PUT','PATCH'].includes(route.method)?{'Content-Type':'application/json'}:{})},body:['POST','PUT','PATCH'].includes(route.method)?'{}':undefined,signal:AbortSignal.timeout(15000)});const text=await response.text();let body;try{body=JSON.parse(text);}catch{}return {status:response.status,body};}
  try{
    let ready=false;for(let i=0;i<60;i++){try{if((await request({method:'GET',path:'/api/health'})).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}if(!ready)throw new Error('Backend startup failed.');
    for(const route of output.routes.filter(r=>r.policy==='staff JWT')){
      for(const condition of ['missing','invalid']){
        const r=await request(route,condition==='invalid'?'Bearer invalid-endpoint-audit-token':undefined);
        const bodySafe=r.body&&typeof r.body==='object'&&!Array.isArray(r.body)&&Object.keys(r.body).length===1&&r.body.message===(condition==='missing'?'Bearer token required':'Invalid or expired token');
        output.results.push({method:route.method,path:route.path,condition,http:r.status,error_body_safe:!!bodySafe,result:r.status===401&&bodySafe?'PASS':'FAIL'});save();
      }
    }
    // Empty-body probe; populated synthetic inputs covered by regression tests.
    const reset=await request({method:'POST',path:'/api/auth/temp-password'});
    output.findings[0].empty_body_probe_http=reset.status;
    output.findings[0].empty_body_reaches_handler=reset.status===400;
    const retired=output.routes.some(r=>r.path==='/api/auth/temp-password'&&r.policy.startsWith('retired'))&&reset.status===410&&reset.body?.code==='TEMP_PASSWORD_DISABLED';
    if(retired){output.findings[0].status='REMEDIATED LOCALLY';output.findings[0].remediation='Route retired with generic 410; Admin client and all account/password operations removed. Not merged/deployed.';}
    output.results.push({method:'POST',path:'/api/auth/temp-password',condition:'retired route',http:reset.status,result:retired?'PASS':'FAIL'});
    output.status=output.results.every(r=>r.result==='PASS')?(retired?'COMPLETE: LOCAL REMEDIATION VERIFIED':'COMPLETE WITH OPEN FINDING'):'CHECK FAILURES';output.finished_at=new Date().toISOString();save();
    const lines=['# Local endpoint authentication inventory','',`Baseline: ${output.baseline}; working-source SHA-256 values are recorded in ${path.basename(file)}.`, '', '| Method | Path | Authentication classification | Source |','| --- | --- | --- | --- |',...output.routes.map(r=>`| ${r.method} | ${r.path} | ${r.policy} | ${r.source}:${r.line} |`),'','## Open finding','',`AUTH-RESET-01: POST /api/auth/temp-password has no authentication or recovery proof gate. Empty-body request returned HTTP ${reset.status}; no account identifier/password supplied and no mutation attempted. Risk escalates if the server has a privileged Supabase key. This is not an approved public endpoint simply because it lacks a guard.`,'','Device telemetry ingestion uses a separate service credential and is not staff-JWT coverage. Public endpoints were classified from source; public data-contract correctness, `/portal` static content, nonliteral/dynamically registered routes and final deployment are outside this test.','',`Protected route checks: ${output.results.filter(r=>r.result==='PASS').length}/${output.results.length} PASS. No public AI requests, password changes, valid uploads or telemetry writes performed.`];
    if(retired){const start=lines.indexOf('## Open finding');lines.splice(start,3,'## Locally remediated finding','','AUTH-RESET-01: password setter retired with HTTP 410 / TEMP_PASSWORD_DISABLED. No Supabase client, user lookup or password modification remains. Merge/deployment verification pending.');}
    fs.writeFileSync(path.join(__dirname,'endpoint-auth-inventory.md'),lines.join('\n'));
    console.log(JSON.stringify({file:path.basename(file),routes:output.routes.length,protected_routes:output.routes.filter(r=>r.policy==='staff JWT').length,pass:output.results.filter(r=>r.result==='PASS').length,fail:output.results.filter(r=>r.result==='FAIL').length,status:output.status,finding:output.findings[0].status},null,2));
    if(output.results.some(r=>r.result==='FAIL'))process.exitCode=1;
  }finally{child.kill();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
