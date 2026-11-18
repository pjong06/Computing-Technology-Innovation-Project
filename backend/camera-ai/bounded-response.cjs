'use strict';

async function readBoundedResponse(response, limit, timeoutMs = 15000) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('RESPONSE_READ_FAILED');
  let timer; let bytes = 0; const chunks = [];
  const timeout = new Promise((_resolve,reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('RESPONSE_TIMEOUT'),{name:'TimeoutError'})),timeoutMs);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(),timeout]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) throw new Error('RESPONSE_SIZE_LIMIT');
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks);
  } catch(error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
module.exports = { readBoundedResponse };
