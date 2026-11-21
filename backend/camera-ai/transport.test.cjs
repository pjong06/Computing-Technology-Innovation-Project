'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {readBoundedResponse}=require('./bounded-response.cjs');const {downloadPhoto}=require('./photo-download.cjs');
test('stream limiter cancels oversized and stalled responses',async()=>{
  let cancelled=false;
  await assert.rejects(readBoundedResponse(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(20));},cancel(){cancelled=true;}})),10),/RESPONSE_SIZE_LIMIT/);
  assert.equal(cancelled,true);
  await assert.rejects(readBoundedResponse(new Response(new ReadableStream({pull(){}})),10,10),{name:'TimeoutError'});
});
test('photo download checks size before signing and enforces bytes while streaming',async()=>{
  let signs=0;let cancelled=false;
  const userClient={storage:{from:()=>({createSignedUrl:async()=>{signs++;return{data:{signedUrl:'https://example.supabase.co/storage/v1/object/sign/camera-evidence/station/alert/image.jpg?token=test-value'}};}})}};
  await assert.rejects(downloadPhoto({userClient,filePath:'station/alert/image.jpg',expectedBytes:6*1024*1024,supabaseUrl:'https://example.supabase.co'}),/PHOTO_SIZE_INVALID/);
  assert.equal(signs,0);
  await assert.rejects(downloadPhoto({userClient,filePath:'station/alert/image.jpg',expectedBytes:10,supabaseUrl:'https://example.supabase.co',fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(20));},cancel(){cancelled=true;}}))}),/RESPONSE_SIZE_LIMIT/);
  assert.equal(cancelled,true);
});
test('photo redirects and cross-project signed URLs are rejected',async()=>{
  let fetched=false;
  const userClient={storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://unrelated.example/storage/v1/object/sign/camera-evidence/x'}})})}};
  await assert.rejects(downloadPhoto({userClient,filePath:'x',expectedBytes:1,supabaseUrl:'https://example.supabase.co',fetchImpl:async()=>{fetched=true;}}),/PHOTO_ORIGIN_INVALID/);
  assert.equal(fetched,false);
});
test('scoped signed photo bytes can be streamed without exposing URL to the caller',async()=>{
  const bytes=Buffer.from('test image bytes');
  const userClient={storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://example.supabase.co/storage/v1/object/sign/camera-evidence/station/alert/image.jpg?token=test-value'}})})}};
  const result=await downloadPhoto({userClient,filePath:'station/alert/image.jpg',expectedBytes:bytes.length,supabaseUrl:'https://example.supabase.co',fetchImpl:async(_url,options)=>{
    assert.equal(options.redirect,'error');return new Response(bytes);
  }});
  assert.deepEqual(result,bytes);
});
