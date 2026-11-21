'use strict';
const { LIMIT } = require('./gemini-review.cjs');
const { readBoundedResponse } = require('./bounded-response.cjs');

async function downloadPhoto({userClient,filePath,expectedBytes,supabaseUrl,fetchImpl=fetch}) {
  if (!Number.isInteger(expectedBytes) || expectedBytes<1 || expectedBytes>LIMIT) throw new Error('PHOTO_SIZE_INVALID');
  const origin = new URL(supabaseUrl);
  if(origin.protocol!=='https:' || origin.username || origin.password) throw new Error('PHOTO_ORIGIN_INVALID');
  const signed=await userClient.storage.from('camera-evidence').createSignedUrl(filePath,60);
  if(signed.error || !signed.data?.signedUrl) throw new Error('PHOTO_UNAVAILABLE');
  const url=new URL(signed.data.signedUrl);
  if(url.origin!==origin.origin || decodeURIComponent(url.pathname)!==`/storage/v1/object/sign/camera-evidence/${filePath}`) throw new Error('PHOTO_ORIGIN_INVALID');
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw new Error('PHOTO_UNAVAILABLE');}
  return readBoundedResponse(response,expectedBytes);
}
module.exports={downloadPhoto};
