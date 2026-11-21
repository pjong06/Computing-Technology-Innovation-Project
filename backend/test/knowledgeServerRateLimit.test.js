const test = require('node:test');
const assert = require('node:assert/strict');
// Set policy before importing the real server's singleton Knowledge router.
process.env.KNOWLEDGE_READ_RATE_LIMIT = '2';
process.env.KNOWLEDGE_RATE_WINDOW_MS = '60000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
const app = require('../src/server');

test('main server mounts Knowledge protection, keeps security headers and leaves health unthrottled', async t => {
  // Importing the app does not start MQTT or an AI worker. Invalid IDs never query Supabase.
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (let i = 0; i < 3; i++) {
    const response = await fetch(`${base}/api/knowledge/species/invalid-id`);
    const body = await response.json();
    assert.equal(response.status, i < 2 ? 400 : 429);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    if (i === 2) {
      assert.equal(body.policy, 'read');
      assert.ok(Number(response.headers.get('retry-after')) > 0);
    }
  }
  const health = await fetch(`${base}/api/health`);
  await health.text();
  assert.equal(health.status, 200);
});
