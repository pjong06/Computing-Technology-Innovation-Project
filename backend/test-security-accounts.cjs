const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
// Fixed executable locations prevent PATH-hijacking during evidence collection.
const gitExecutable = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git';
const { createClient } = require('@supabase/supabase-js');
const localEnv = path.join(__dirname, '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : path.resolve(__dirname, '../../Computing-Technology-Innovation-Project/backend/.env'), quiet: true });
const { stdin, stdout } = process;
const accounts = [
  ['officer', 'stevenchengyujay@gmail.com'],
  ['researcher', 'stevenchengyujay+researcher@gmail.com'],
  ['admin', 'stevenchengyujay+admin@gmail.com'],
  ['botanist', 'stevencyj06@gmail.com'],
  ['botanist', 'scyjay06@gmail.com'],
];
function ask(prompt, hidden = false) {
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    function cleanup() { stdin.setRawMode(false); stdin.off('data', onData); stdin.pause(); stdout.write('\n'); }
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') { cleanup(); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') { if (value) { value = value.slice(0,-1); if (!hidden) stdout.write('\b \b'); } }
        else if (char >= ' ') { value += char; if (!hidden) stdout.write(char); }
      }
    }
    stdin.on('data', onData);
  });
}
async function main() {
  if (!stdin.isTTY) throw new Error('Run in an interactive PowerShell window.');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  const url = process.env.SUPABASE_URL;
  let role; try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; } catch {}
  if (!url?.startsWith('https://') || !(key?.startsWith('sb_publishable_') || role === 'anon')) throw new Error('HTTPS URL and public/anon key required.');
  const occupied = await new Promise(resolve => { const s = net.connect(3001, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
  if (occupied) throw new Error('Port 3001 occupied. Stop its service before testing.');
  const server = spawn(process.execPath, ['src/server.js'], { cwd: __dirname, env: { ...process.env, PORT:'3001', MQTT_URL:'' }, stdio:'ignore', windowsHide:true });
  const output = { date: new Date().toISOString(), baseline: execFileSync(gitExecutable,['rev-parse','HEAD'],{cwd:__dirname,encoding:'utf8'}).trim(), branch:'steven/sprint-2-security', note:'Uncommitted security additions and patched lockfile; read-only data queries. No fixture-backed RLS acceptance verdict.', results:[] };
  const approvedMode = process.argv.includes('--approved-read');
  const destination = path.join(__dirname,approvedMode?'approved-observation-read-results.json':'security-account-results.json');
  if (fs.existsSync(destination) && approvedMode) { server.kill(); throw new Error('Approved-read evidence already exists; review it before replacing.'); }
  let approvedFixtures = [];
  output.approved_fixtures = approvedFixtures;
  const record = row => { output.results.push(row); fs.writeFileSync(destination,JSON.stringify(output,null,2)); console.log(JSON.stringify(row)); };
  async function request(endpoint, token) {
    const r = await fetch(`http://127.0.0.1:3001${endpoint}`, {headers: token ? {Authorization:`Bearer ${token}`} : {},signal:AbortSignal.timeout(20000)});
    let body; try {body=await r.json();} catch {}
    return {status:r.status,body};
  }
  try {
    let ready = false;
    for(let i=0;i<40;i++){try{if((await request('/api/health')).status===200){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,250));}
    if(!ready) throw new Error('Isolated backend failed to start.');
    for (const endpoint of ['/api/me','/api/plants','/api/iot/summary']) {
      const r = await request(endpoint); record({account:'anonymous',test:endpoint,expected:401,actual:r.status,result:r.status===401?'PASS':'FAIL'});
    }
    for(const [expectedRole,email] of accounts){
      console.log(`\n${expectedRole}: ${email}`);
      let password=await ask('Password (hidden; Enter to skip): ',true);
      if(!password){record({account:email,test:'login',result:'NOT TESTED',reason:'Skipped'});continue;}
      const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      try {
        const {data,error}=await client.auth.signInWithPassword({email,password}); password='';
        if(error || !data.session){record({account:email,test:'login',result:'FAIL',code:error?.code||'NO_SESSION'});continue;}
        const token=data.session.access_token;
        const me=await request('/api/me',token);
        const verified=me.status===200&&me.body?.role===expectedRole&&me.body?.id===data.user.id;
        record({account:email,test:'identity and expected role',expected:expectedRole,actual_role:me.body?.role||null,http:me.status,result:verified?'PASS':'FAIL'});
        if(!verified) continue;
        if (approvedMode) {
          if (expectedRole === 'officer') {
            const selected = await client.from('observations').select('id,observer_id,review_status,deleted_at').eq('review_status','approved').is('deleted_at',null).limit(100);
            if (selected.error) {
              record({account:email,test:'Discover Approved observations',result:'INCONCLUSIVE',code:selected.error.code});
            } else {
              approvedFixtures.push(...selected.data);
              record({account:email,test:'Discover Approved observations',result:selected.data.length?'FIXTURES FOUND':'BLOCKED',count:selected.data.length,reason:selected.data.length?undefined:'No Approved observations visible to Officer; no synthetic records approved by this test.'});
            }
          }
          if (!approvedFixtures.length) {
            record({account:email,test:'Read same Approved fixture IDs',result:'NOT TESTED',reason:'No Officer-confirmed Approved fixture IDs available.'});
          } else if (expectedRole === 'admin') {
            record({account:email,test:'Direct Approved observation access for Admin',result:'NOT TESTED',reason:'Admin public-data permissions must use appropriate public routes; direct observation-table access is not assumed.'});
          } else {
            const selected=await client.from('observations').select('id,review_status').in('id',approvedFixtures.map(f=>f.id)).is('deleted_at',null);
            const visible=new Set((selected.data||[]).map(r=>r.id));
            record({account:email,test:'Read known active Approved observations',expected_count:approvedFixtures.length,visible_count:visible.size,result:selected.error?'INCONCLUSIVE':approvedFixtures.every(f=>visible.has(f.id))?'PASS':'FAIL',code:selected.error?.code});
          }
          continue;
        }
        for(const [endpoint,expected] of [['/api/plants',expectedRole==='admin'?403:200],['/api/iot/summary',expectedRole==='officer'?200:403]]){
          const r=await request(endpoint,token); record({account:email,test:endpoint,expected,actual:r.status,result:r.status===expected?'PASS':'FAIL',scope:endpoint==='/api/plants'?'Current route gate: botanist/officer/researcher only; database list response status is not ownership proof. Public Admin access must be tested separately.':'IoT endpoint permission plus data availability'});
        }
        const parts=token.split('.'); parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
        const changed=await request('/api/me',parts.join('.'));
        record({account:email,test:'Real JWT signature tampered',expected:401,actual:changed.status,result:changed.status===401?'PASS':'FAIL'});
        const {data:rows,error:readError}=await client.from('observations').select('id,observer_id,review_status');
        if(readError){record({account:email,test:'Direct RLS observation visibility',result:'INCONCLUSIVE',code:readError.code});}
        else {
          const groups={};for(const row of rows){const group=`${row.observer_id===data.user.id?'own':'other'}:${row.review_status}`;groups[group]=(groups[group]||0)+1;}
          record({account:email,test:'Direct RLS observation visibility',result:'OBSERVATION ONLY',returned:rows.length,groups,limitation:'Known fixture IDs and expected permissions still required; empty results are not proof.'});
        }
      } catch(e){password='';record({account:email,test:'account checks',result:'ERROR',code:e.code||e.name});}
      finally { try{await client.auth.signOut({scope:'local'});}catch{} }
    }
    console.log(`\nSaved sanitized results to ${path.basename(destination)}. No database mutations performed. Genuine expiry and mutation permission checks are not covered.`);
  } finally {server.kill(); if(stdin.isTTY)stdin.setRawMode(false);stdin.pause();}
}
module.exports = { ask };
if (require.main === module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
