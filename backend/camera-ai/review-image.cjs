'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { MODEL, LIMIT, prepareImage, reviewImage } = require('./gemini-review.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    console.log('Preview only: node camera-ai/review-image.cjs --image "C:\\path\\sample.jpg"');
    console.log('Send one non-sensitive image to Google: append --send');
    return;
  }
  let imagePath;
  let send = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--image' && args[i + 1] && !args[i + 1].startsWith('--') && !imagePath) imagePath = args[++i];
    else if (args[i] === '--send' && !send) send = true;
    else throw new Error('ARGUMENTS_INVALID');
  }
  if (!imagePath || /^https?:/i.test(imagePath)) throw new Error('LOCAL_IMAGE_REQUIRED');
  const handle = await fs.open(path.resolve(imagePath), 'r');
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > LIMIT) throw new Error('IMAGE_SIZE_INVALID');
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  const jpeg = await prepareImage(bytes);
  if (!send) {
    console.log(JSON.stringify({ mode: 'preview-only', model: MODEL, image_valid: true, outgoing_bytes: jpeg.length, metadata_stripped: true, api_called: false }));
    return;
  }
  // Load only the explicitly agreed local backend file; never print its contents.
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  const result = await reviewImage({ jpeg, apiKey: process.env.GEMINI_API_KEY });
  console.log(JSON.stringify({ mode: 'live-single-image', ...result }, null, 2));
}

const safeCodes = new Set(['ARGUMENTS_INVALID', 'LOCAL_IMAGE_REQUIRED', 'IMAGE_SIZE_INVALID', 'IMAGE_DECODE_FAILED', 'GEMINI_KEY_MISSING', 'MODEL_NOT_APPROVED', 'AI_RESULT_INVALID', 'AI_RESPONSE_INCOMPLETE', 'GEMINI_TIMEOUT', 'GEMINI_NETWORK_FAILED']);
main().catch(error => {
  const code = error?.message;
  console.error(safeCodes.has(code) || /^GEMINI_HTTP_\d{3}$/.test(code) ? code : 'LOCAL_IMAGE_OR_RUNTIME_FAILED');
  process.exitCode = 1;
});
