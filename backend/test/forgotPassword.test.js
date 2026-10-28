const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
process.env.PASSWORD_RESET_REDIRECT_URL = 'niahbiotrack://change-password';
const { createAuthRouter } = require('../src/routes/auth');

async function start(client) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(client));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/api/auth` };
}

test('valid request uses configured redirect and generic response', async () => {
  const calls = [];
  const { server, url } = await start({
    auth: {
      resetPasswordForEmail: async (...args) => {
        calls.push(args);
        return { error: null };
      }
    }
  });
  try {
    const response = await fetch(`${url}/forgot-password`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ' Test@Example.com ' }),
    });
    assert.equal(response.status, 202);
    assert.match((await response.json()).message, /If an account exists/);
    assert.deepEqual(calls, [['test@example.com', { redirectTo: 'niahbiotrack://change-password' }]]);
  } finally { server.close(); }
});

test('invalid email is rejected without contacting Supabase', async () => {
  let called = false;
  const { server, url } = await start({ auth: { resetPasswordForEmail: async () => { called = true; } } });
  try {
    const response = await fetch(`${url}/forgot-password`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bad' }),
    });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally { server.close(); }
});

test('Supabase errors remain generic and per-email requests are limited', async () => {
  let calls = 0;
  const { server, url } = await start({
    auth: {
      resetPasswordForEmail: async () => {
        calls += 1;
        return { error: { status: 429, code: 'over_email_send_rate_limit' } };
      }
    }
  });
  try {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const response = await fetch(`${url}/forgot-password`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [202, 202, 202, 429]);
    assert.equal(calls, 3);
  } finally { server.close(); }
});

test('unsafe temporary-password endpoint is absent', async () => {
  const { server, url } = await start({ auth: { resetPasswordForEmail: async () => ({ error: null }) } });
  try {
    const response = await fetch(`${url}/temp-password`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'test@example.com', tempPassword: 'attacker123' }),
    });
    assert.equal(response.status, 404);
  } finally { server.close(); }
});
