const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { randomBytes } = require('node:crypto');
const { createIngestionRouter } = require('../src/routes/iotIngestion');
const { createTelemetryPersistence } = require('../src/services/telemetryPersistence');

test('HTTP auth/validation/station boundary, persistence mapping and sanitized errors', async () => {
  const token = randomBytes(32).toString('hex');
  let mode = 'ok';
  const inserts = [];
  const client = { from(table) {
    if (table === 'sensor_stations') return { select(columns) {
      assert.equal(columns,'id');
      return { eq() { return this; }, single: async () => mode === 'missing'
        ? {data:null,error:{code:'PGRST116'}} : {data:{id:'station-uuid'},error:null} };
    } };
    assert.equal(table,'sensor_readings');
    return { insert(row) { inserts.push(row); return { select(columns) {
      assert.equal(columns,'id'); return { single: async () => mode === 'error'
        ? {error:{message:'sensitive internal error'}} : {data:{id:'reading-uuid'}} };
    } }; } };
  } };
  const app=express(); app.use(express.json());
  app.use('/ingest',createIngestionRouter({IOT_INGESTION_SERVER_ENABLED:'true',IOT_INGESTION_TOKEN:token,IOT_INGESTION_STATION_CODE:'test-station'},client));
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const payload={schema_version:1,station_id:'test-station',sequence:1,uptime_ms:1000,
    temperature_c:40,humidity_pct:70,dht_valid:true,soil_raw:2200,soil_moisture_pct:50,
    motion_detected:false,distance_cm:100,distance_valid:true,rain_raw:3900,rain_intensity_pct:5};
  const endpoint=`http://127.0.0.1:${server.address().port}/ingest`;
  const send=(body,credential=token)=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential}`},body:JSON.stringify(body)});
  try {
    assert.equal((await send(payload,'invalid')).status,401);
    assert.equal((await send({})).status,400);
    assert.equal((await send({...payload,station_id:'other'})).status,403);
    assert.equal(inserts.length,0);
    mode='missing'; assert.equal((await send(payload)).status,403); assert.equal(inserts.length,0);
    mode='ok'; const response=await send(payload); assert.equal(response.status,201);
    assert.equal((await response.json()).reading_id,'reading-uuid');
    assert.equal(inserts[0].station_id,'station-uuid'); assert.equal(inserts[0].temperature_c,40);
    assert.equal(inserts[0].humidity_percent,70); assert.equal(inserts[0].movement_detected,false);
    for (const key of ['soil_raw','soil_moisture_pct','distance_cm','distance_valid',
      'rain_raw','rain_intensity_pct','dht_valid','sequence','uptime_ms']) {
      assert.equal(inserts[0][key],payload[key]);
    }
    assert.equal((await send({...payload,dht_valid:false,distance_valid:false})).status,201);
    assert.equal(inserts[1].temperature_c,null); assert.equal(inserts[1].humidity_percent,null);
    assert.equal(inserts[1].distance_cm,null); assert.equal(inserts[1].distance_valid,false);
    mode='error'; const error=await send(payload); assert.equal(error.status,503);
    assert.doesNotMatch(await error.text(),/sensitive/);
    mode='ok';
    const persist=createTelemetryPersistence({IOT_PERSISTENCE_ENABLED:'true',IOT_INGESTION_URL:'https://example.test/ingest',IOT_INGESTION_TOKEN:token},async (_url,options)=>{
      assert.equal(options.redirect,'error'); return fetch(endpoint,options);
    });
    assert.equal((await persist(payload)).reading_id,'reading-uuid');
  } finally { await new Promise(r=>server.close(r)); }
});
