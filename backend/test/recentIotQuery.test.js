const test = require('node:test');
const assert = require('node:assert/strict');
const { recentIotQuery } = require('../src/services/recentIotQuery');

test('shared query preserves selected columns, newest-first limit and sanitized errors', async () => {
  for (const mode of ['ok','error','throw']) {
    const calls=[]; let status=200; let body;
    const db={from(table){calls.push(table);return {select(columns){calls.push(columns);return {
      order(field,options){calls.push([field,options]);return this;},
      async limit(n){calls.push(n);if(mode==='throw')throw new Error('private details');
        return mode==='error'?{error:{message:'private details'}}:{data:[{id:'fixture'}]};},
    };}};}};
    const res={status(n){status=n;return this;},json(value){body=value;}};
    await recentIotQuery({table:'sensor_readings',columns:'id,received_at',orderBy:'recorded_at',
      message:'Success',failure:'Query unavailable'})({supabase:db},res);
    assert.deepEqual(calls,['sensor_readings','id,received_at',['recorded_at',{ascending:false}],100]);
    assert.equal(status,mode==='ok'?200:500);
    assert.doesNotMatch(JSON.stringify(body),/private details/);
    if(mode==='ok')assert.deepEqual(body,{message:'Success',data:[{id:'fixture'}]});
  }
});
