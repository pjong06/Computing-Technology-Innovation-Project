'use strict';

// Trace routes through the real app (src/server.js) with the real auth middleware:
// signed-out requests get 401 on upload and on the officer map routes. No request here
// reaches Supabase (a missing token is refused first).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
if (!process.env.SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_KEY && !process.env.SUPABASE_ANON_KEY) {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'placeholder-publishable-key';
}

const app = require('../src/server');

test('signed-out users get 401 on route upload and on the officer map routes', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const upload = await fetch(`${base}/api/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_route_id: '33333333-3333-4333-8333-333333333333' }),
    });
    assert.equal(upload.status, 401);
    await upload.text();

    const read = await fetch(`${base}/api/officer/map/routes`);
    assert.equal(read.status, 401);
    await read.text();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
