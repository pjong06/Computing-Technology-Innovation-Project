'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { prepareImage, reviewImage, validateResult } = require('./gemini-review.cjs');
const good = { targets: ['person', 'animal'], uncertain: false, scene_status: 'target_detected' };

test('mixed targets are retained and human review cannot be disabled', () => {
  assert.deepEqual(validateResult(good).targets, ['person', 'animal']);
  assert.equal(validateResult(good).human_review_required, true);
  for (const bad of [{ ...good, human_review_required: false }, { ...good, targets: ['poacher'] }, { ...good, targets: [] }, { targets: [], uncertain: false, scene_status: 'unclear' }]) {
    assert.throws(() => validateResult(bad), /AI_RESULT_INVALID/);
  }
});
test('decodes and re-encodes images, removes metadata and rejects non-images', async () => {
  const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).jpeg().withMetadata().toBuffer();
  const output = await prepareImage(input);
  const meta = await sharp(output).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.exif, undefined);
  await assert.rejects(prepareImage(Buffer.from('not a photograph')), /IMAGE_DECODE_FAILED/);
});
test('request uses fixed Google endpoint and header key; no key in URL or body', async () => {
  let count = 0;
  const result = await reviewImage({ jpeg: Buffer.from('test'), apiKey: 'unit-test-value', fetchImpl: async (url, options) => {
    count++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'unit-test-value');
    assert.equal(options.body.includes('unit-test-value'), false);
    assert.equal(options.redirect, 'error');
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(good) }] } }] });
  } });
  assert.equal(count, 1);
  assert.equal(result.human_review_required, true);
});
test('quota error is not retried or echoed, including server-provided content', async () => {
  let count = 0;
  await assert.rejects(reviewImage({ jpeg: Buffer.from('test'), apiKey: 'unit-test-value', fetchImpl: async () => {
    count++;
    return { ok: false, status: 429, body: { cancel: async () => {} } };
  } }), { message: 'GEMINI_HTTP_429' });
  assert.equal(count, 1);
});
test('blocked, truncated and invalid model outputs fail closed', async () => {
  for (const data of [{ promptFeedback: { blockReason: 'SAFETY' } }, { candidates: [{ finishReason: 'MAX_TOKENS' }] }, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'private raw output' }] } }] }]) {
    await assert.rejects(reviewImage({ jpeg: Buffer.from('test'), apiKey: 'unit-test-value', fetchImpl: async () => Response.json(data) }), /AI_RESPONSE_INCOMPLETE|AI_RESULT_INVALID/);
  }
});
test('oversized Gemini HTTP response is cancelled before full buffering',async () => {
  let cancelled=false;let chunks=0;
  const body=new ReadableStream({pull(controller){chunks++;controller.enqueue(new Uint8Array(512*1024));},cancel(){cancelled=true;}});
  await assert.rejects(reviewImage({jpeg:Buffer.from('test'),apiKey:'unit-test-value',fetchImpl:async()=>new Response(body)}),/AI_RESULT_INVALID/);
  assert.equal(cancelled,true);assert.ok(chunks<=5);
});
test('credentials and model are checked before network; transport errors are redacted', async () => {
  const fetchImpl = async () => { throw new Error('secret material in transport error'); };
  await assert.rejects(reviewImage({ jpeg: Buffer.from('test'), apiKey: '', fetchImpl }), /GEMINI_KEY_MISSING/);
  await assert.rejects(reviewImage({ jpeg: Buffer.from('test'), apiKey: 'unit-test-value', model: 'other', fetchImpl }), /MODEL_NOT_APPROVED/);
  await assert.rejects(reviewImage({ jpeg: Buffer.from('test'), apiKey: 'unit-test-value', fetchImpl }), { message: 'GEMINI_NETWORK_FAILED' });
});
