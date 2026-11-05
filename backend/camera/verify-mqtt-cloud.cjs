// Explicit one-photo acceptance test against isolated MQTT topic and real ingestion.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
const mqtt = require('mqtt');
const run = randomUUID();
const reportFile = path.resolve(__dirname, '../../../security-test-results', `camera-mqtt-${run}.json`);
const report = { run, started_at:new Date().toISOString(), synthetic_telemetry:true, rows:[], readings:[], scope:'Real MQTT TLS, deployed ingestion, database trigger and local webcam/cloud adapter; no dashboard or real user JWT acceptance' };
let subscriber, publisher;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function waitFor(fn, ms=45000) { const end=Date.now()+ms; while(Date.now()<end){ const result=await fn(); if(result)return result; await sleep(300); } throw Error('Timed out waiting for pipeline stage'); }
async function save(){await fs.writeFile(reportFile,JSON.stringify(report,null,2));}
async function main(){
 if(!process.argv.includes('--capture-and-upload'))throw Error('Explicit --capture-and-upload required');
 if(new URL(process.env.MQTT_URL).protocol!=='mqtts:')throw Error('MQTT TLS required');
 process.env.MQTT_TOPIC_FILTER=`niah/camera-test/${run}`;
 process.env.MQTT_ALLOW_INSECURE_TLS='false';
 process.env.IOT_PERSISTENCE_ENABLED='true';
 process.env.IOT_INGESTION_URL=process.env.IOT_INGESTION_URL||'https://niah-backend.onrender.com/api/ingestion/telemetry';
 process.env.CAMERA_ENABLED='true';process.env.CAMERA_STORAGE_ENABLED='true';
 process.env.CAMERA_DISTANCE_CM='100';process.env.CAMERA_COOLDOWN_MS='30000';
 process.env.CAMERA_DATABASE_SERVER_KEY=process.env.CAMERA_DATABASE_SERVER_KEY||process.env.IOT_DATABASE_SERVER_KEY;
 if(!process.env.CAMERA_DATABASE_SERVER_KEY||!process.env.IOT_INGESTION_TOKEN)throw Error('Missing local server credential');
 const {startMqttIngestion}=require('../src/services/mqttIngestionService');
 const {getRecentReadings}=require('../src/services/iotTelemetryService');
 const {getCameraEvidenceService}=require('../src/services/cameraEvidenceService');
 const {createClient}=require('@supabase/supabase-js');
 const cloud=createClient(process.env.SUPABASE_URL,process.env.CAMERA_DATABASE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 subscriber=startMqttIngestion();
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('MQTT subscription timeout')),20000);subscriber.on('packetreceive',p=>{if(p.cmd==='suback'){clearTimeout(timeout);p.granted.some(x=>x>=128)?reject(Error('MQTT subscription denied')):resolve();}});});
 publisher=await mqtt.connectAsync(process.env.MQTT_URL,{username:process.env.MQTT_USERNAME,password:process.env.MQTT_PASSWORD,rejectUnauthorized:true,reconnectPeriod:0,connectTimeout:15000});
 const base={schema_version:1,station_id:'steven-sprint2-test-01',sequence:Date.now(),uptime_ms:1000,temperature_c:25,humidity_pct:70,dht_valid:true,soil_raw:2000,soil_moisture_pct:50,motion_detected:true,distance_cm:30,distance_valid:true,rain_raw:4095,rain_intensity_pct:0};
 const cases=[['no movement',{motion_detected:false},0],['invalid distance',{distance_valid:false},0],['outside 100cm',{distance_cm:101},0],['movement at 30cm',{},1]];
 for(let i=0;i<cases.length;i++){
  const [name,patch,expected]=cases[i];const payload={...base,...patch,sequence:base.sequence+i,uptime_ms:1000+i*10000};
  await publisher.publishAsync(process.env.MQTT_TOPIC_FILTER,JSON.stringify(payload),{qos:1,retain:false});
  const reading=await waitFor(()=>getRecentReadings().find(r=>r.sequence===payload.sequence&&r.database_reading_id));
  report.readings.push({name,id:reading.database_reading_id,sequence:payload.sequence});await save();
  const alerts=await cloud.from('alerts').select('id,alert_message').eq('reading_id',reading.database_reading_id).like('alert_message','% (movement_nearby_cm)');
  assert.equal(alerts.error,null);assert.equal(alerts.data.length,expected);
  report.rows.push({name,expected_alerts:expected,actual_alerts:alerts.data.length,pass:true});await save();
  if(expected){
   const evidence=await waitFor(async()=>{const records=await getCameraEvidenceService().list(alerts.data[0].id);return records.find(r=>r.database_reading_id===reading.database_reading_id&&r.sync_status==='uploaded');});
   report.evidence={id:evidence.id,alert_id:evidence.cloud.alert_id,reading_id:evidence.database_reading_id,file_path:evidence.cloud.file_path,byte_count:evidence.byte_count};await save();
   assert.equal(evidence.cloud.alert_id,alerts.data[0].id);
   const downloaded=await cloud.storage.from('camera-evidence').download(evidence.cloud.file_path);
   assert.equal(downloaded.error,null);
   const local=await getCameraEvidenceService().image(alerts.data[0].id,evidence.id);
   assert.ok(Buffer.from(await downloaded.data.arrayBuffer()).equals(local));
   report.rows.push({name:'real webcam upload linked to movement alert and identical bytes',pass:true});
  }
 }
 report.result='PASS';
}
main().catch(e=>{report.result='FAIL';report.error=e.message;process.exitCode=1;}).finally(async()=>{
 if(publisher)await publisher.endAsync();if(subscriber)await subscriber.endAsync();
 report.completed_at=new Date().toISOString();await save();console.log(JSON.stringify(report,null,2));
});
