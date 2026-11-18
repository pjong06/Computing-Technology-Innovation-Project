// Register the isolated AI prototype checks in the existing npm test/CI command.
// These tests never load .env, contact Gemini/Supabase, or activate a camera.
require('../camera-ai/gemini-review.test.cjs');
require('../camera-ai/worker.test.cjs');
require('../camera-ai/router.test.cjs');
require('../camera-ai/transport.test.cjs');
