'use strict';
const { createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { MODEL, LIMIT, prepareImage, reviewImage } = require('./gemini-review.cjs');

const ERRORS = new Set(['GEMINI_HTTP_429','GEMINI_HTTP_500','GEMINI_HTTP_502','GEMINI_HTTP_503','GEMINI_HTTP_504',
  'GEMINI_HTTP_400','GEMINI_HTTP_401','GEMINI_HTTP_403','GEMINI_HTTP_404','GEMINI_TIMEOUT','GEMINI_NETWORK_FAILED',
  'AI_RESULT_INVALID','AI_RESPONSE_INCOMPLETE','IMAGE_SIZE_INVALID','IMAGE_DECODE_FAILED',
  'EVIDENCE_INTEGRITY_FAILED','STORAGE_UNAVAILABLE','WORKER_FAILED']);
const safeError = error => ERRORS.has(error?.message) ? error.message : 'WORKER_FAILED';

function createDatabaseClient(env) {
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { throw new Error('AI_DATABASE_CONFIG_REQUIRED'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('AI_DATABASE_CONFIG_REQUIRED');
  const key = env.CAMERA_AI_DATABASE_SERVER_KEY || env.CAMERA_DATABASE_SERVER_KEY;
  if (!key) throw new Error('AI_DATABASE_CONFIG_REQUIRED');
  return createClient(url.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options = {}) => {
      const response = await fetch(input, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
      const reader = response.body?.getReader();
      const chunks = []; let length = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            length += part.value.length;
            if (length > LIMIT + 1024 * 1024) throw new Error('DATABASE_RESPONSE_TOO_LARGE');
            chunks.push(Buffer.from(part.value));
          }
        } catch { await reader.cancel(); throw new Error('DATABASE_REQUEST_FAILED'); }
      }
      return new Response(response.status === 204 || response.status === 304 ? null : Buffer.concat(chunks), {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } },
  });
}

function createWorker({ client, apiKey, analyse = reviewImage, prepare = prepareImage, log = code => console.log(code) }) {
  if (!apiKey) throw new Error('GEMINI_KEY_MISSING');
  let busy = false;
  return {
    async tick() {
      if (busy) return { outcome: 'busy' };
      busy = true;
      try {
        const claim = await client.rpc('camera_ai_claim');
        if (claim.error) throw new Error('AI_QUEUE_UNAVAILABLE');
        const job = claim.data;
        if (!job) return { outcome: 'idle' };
        let result; let errorCode = null;
        try {
          if (job.model !== MODEL || !/^[a-f0-9]{64}$/i.test(job.sha256 || '') ||
            !Number.isInteger(job.byte_count) || job.byte_count < 1 || job.byte_count > LIMIT) throw new Error('EVIDENCE_INTEGRITY_FAILED');
          // Never accept arbitrary URLs or switch buckets based on model output.
          const components = (job.file_path || '').split('/');
          if (components.length !== 3 || components[1] !== job.alert_id || components[2] !== `${job.evidence_id}.jpg` ||
            !components.every(p => /^[a-zA-Z0-9_.-]+$/.test(p)) || components.some(p => p === '..')) throw new Error('EVIDENCE_INTEGRITY_FAILED');
          const bucket = await client.storage.getBucket('camera-evidence');
          if (bucket.error || bucket.data?.public !== false) throw new Error('STORAGE_UNAVAILABLE');
          const download = await client.storage.from('camera-evidence').download(job.file_path);
          if (download.error || !download.data || download.data.size > LIMIT) throw new Error('STORAGE_UNAVAILABLE');
          const bytes = Buffer.from(await download.data.arrayBuffer());
          if (bytes.length !== job.byte_count || createHash('sha256').update(bytes).digest('hex') !== job.sha256) throw new Error('EVIDENCE_INTEGRITY_FAILED');
          const jpeg = await prepare(bytes);
          result = await analyse({ jpeg, apiKey, model: job.model });
        } catch (error) { errorCode = safeError(error); }
        const finished = await client.rpc('camera_ai_finish', {
          p_job: job.id, p_lease: job.lease_token,
          p_result: errorCode ? null : { targets: result.targets, uncertain: result.uncertain, scene_status: result.scene_status },
          p_error: errorCode,
        });
        if (finished.error) throw new Error('AI_RESULT_SAVE_FAILED');
        if (finished.data !== true) { log('CAMERA_AI_LEASE_LOST'); return { outcome: 'lease-lost' }; }
        log(errorCode ? `CAMERA_AI_ATTEMPT_FAILED:${errorCode}` : 'CAMERA_AI_COMPLETED');
        return { outcome: errorCode ? 'attempt-failed' : 'completed' };
      } finally { busy = false; }
    },
  };
}

function startWorker(env = process.env, dependencies = {}) {
  if (env.CAMERA_AI_ENABLED !== 'true') return { enabled: false, stop: async () => {} };
  const worker = createWorker({ client: dependencies.client || createDatabaseClient(env), apiKey: env.GEMINI_API_KEY, ...dependencies });
  let stopped = false; let timer; let current;
  const run = async () => {
    try { await worker.tick(); } catch { console.error('CAMERA_AI_QUEUE_OR_SAVE_UNAVAILABLE'); }
    if (!stopped) timer = setTimeout(() => { current = run(); }, 15000);
  };
  current = run();
  return { enabled: true, async stop() { stopped = true; clearTimeout(timer); await current; } };
}
module.exports = { createDatabaseClient, createWorker, startWorker, safeError };
