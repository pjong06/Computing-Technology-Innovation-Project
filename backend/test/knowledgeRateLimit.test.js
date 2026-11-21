const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
const { createKnowledgeRateLimit } = require('../src/middleware/knowledgeRateLimit');
const { createKnowledgeRouter } = require('../src/routes/knowledge');
const ID = '11111111-1111-4111-8111-111111111111';

async function fixture(t, { env = {}, realRouter = false, trustProxy = 3 } = {}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  let databaseCalls = 0;
  let authCalls = 0;
  if (realRouter) {
    const query = {
      select() { return this; }, eq() { return this; }, order() { return this; },
      range() { return this; }, then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); },
    };
    app.use('/api/knowledge', createKnowledgeRouter({
      rateLimitOptions: { env },
      supabase: { from() { databaseCalls++; return query; } },
      requireAuth(_req, res) { authCalls++; return res.status(401).json({ message: 'Bearer token required' }); },
    }));
  } else {
    app.use('/api/knowledge', createKnowledgeRateLimit({ env }), (_req, res) => {
      databaseCalls++;
      return res.json({ ok: true });
    });
  }
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    calls: () => ({ databaseCalls, authCalls }),
    async request(path = '/api/knowledge/species', { method = 'GET', ip = '198.51.100.10', headers = {} } = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers: { 'X-Forwarded-For': `${ip}, 203.0.113.2, 203.0.113.3`, ...headers },
      });
      const text = await response.text();
      return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
    },
  };
}

test('Knowledge defaults provide separate read, photo and write budgets', async t => {
  const f = await fixture(t);
  for (const [path, method, limit] of [
    ['/api/knowledge/species', 'GET', '300'],
    [`/api/knowledge/species/${ID}/photos/${ID}`, 'GET', '600'],
    ['/api/knowledge/species', 'POST', '60'],
  ]) {
    const r = await f.request(path, { method });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('ratelimit-limit'), limit);
    assert.equal(r.headers.get('x-ratelimit-limit'), null);
  }
});

test('read limit combines paths, queries, capitalization and HEAD; blocks before handler', async t => {
  const f = await fixture(t, { env: { KNOWLEDGE_READ_RATE_LIMIT: '2' } });
  assert.equal((await f.request('/api/knowledge/species?q=a')).status, 200);
  assert.equal((await f.request('/api/knowledge/TAXONOMY', { method: 'HEAD' })).status, 200);
  const blocked = await f.request('/api/knowledge/species?q=b');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'KNOWLEDGE_RATE_LIMITED');
  assert.equal(blocked.body.policy, 'read');
  assert.equal(blocked.headers.get('ratelimit-remaining'), '0');
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(blocked.body.retry_after_seconds, Number(blocked.headers.get('retry-after')));
  assert.equal(f.calls().databaseCalls, 2);
});

test('photo links share one budget across IDs and do not exhaust list reads', async t => {
  const f = await fixture(t, { env: { KNOWLEDGE_PHOTO_RATE_LIMIT: '1', KNOWLEDGE_READ_RATE_LIMIT: '1' } });
  assert.equal((await f.request(`/api/knowledge/species/${ID}/photos/${ID}`)).status, 200);
  const r = await f.request('/api/knowledge/SPECIES/other/PHOTOS/another/');
  assert.equal(r.status, 429);
  assert.equal(r.body.policy, 'photo');
  assert.equal((await f.request()).status, 200);
});

test('write budget covers POST, PATCH, PUT and DELETE independently of reads', async t => {
  const f = await fixture(t, { env: { KNOWLEDGE_WRITE_RATE_LIMIT: '1' } });
  assert.equal((await f.request('/api/knowledge/species', { method: 'POST' })).status, 200);
  for (const method of ['PATCH', 'PUT', 'DELETE']) {
    const r = await f.request(`/api/knowledge/species/${ID}`, { method });
    assert.equal(r.status, 429);
    assert.equal(r.body.policy, 'write');
  }
  assert.equal((await f.request()).status, 200);
});

test('separate client IPs have independent budgets', async t => {
  const f = await fixture(t, { env: { KNOWLEDGE_READ_RATE_LIMIT: '1' } });
  assert.equal((await f.request()).status, 200);
  assert.equal((await f.request()).status, 429);
  assert.equal((await f.request(undefined, { ip: '198.51.100.11' })).status, 200);
});

test('forged leftmost forwarding values cannot reset a quota behind the configured proxy chain', async t => {
  const f = await fixture(t, { env: { KNOWLEDGE_READ_RATE_LIMIT: '1' } });
  assert.equal((await f.request(undefined, { ip: '192.0.2.1, 198.51.100.10' })).status, 200);
  assert.equal((await f.request(undefined, { ip: '192.0.2.2, 198.51.100.10' })).status, 429);
});

test('changing Bearer strings does not evade an IP quota', async t => {
  const f = await fixture(t, { env: { KNOWLEDGE_READ_RATE_LIMIT: '1' } });
  assert.equal((await f.request(undefined, { headers: { Authorization: 'Bearer fake-a' } })).status, 200);
  assert.equal((await f.request(undefined, { headers: { Authorization: 'Bearer fake-b' } })).status, 429);
});

test('IPv6 addresses inside the same default /56 share a quota', async t => {
  const f = await fixture(t, { env: { KNOWLEDGE_READ_RATE_LIMIT: '1' } });
  assert.equal((await f.request(undefined, { ip: '2001:db8:abcd:1200::1' })).status, 200);
  assert.equal((await f.request(undefined, { ip: '2001:db8:abcd:1201::2' })).status, 429);
  assert.equal((await f.request(undefined, { ip: '2001:db8:abcd:1300::1' })).status, 200);
});

test('local direct connections work without forwarding headers or trusted proxies', async t => {
  const f = await fixture(t, { trustProxy: false, env: { KNOWLEDGE_READ_RATE_LIMIT: '1' } });
  const opts = { headers: { 'X-Forwarded-For': '' } };
  assert.equal((await f.request(undefined, opts)).status, 200);
  assert.equal((await f.request(undefined, opts)).status, 429);
});

test('OPTIONS and unrelated routes do not use Knowledge quotas', async t => {
  const f = await fixture(t, { env: { KNOWLEDGE_READ_RATE_LIMIT: '1' } });
  await f.request(undefined, { method: 'OPTIONS' });
  assert.equal((await f.request()).status, 200);
  assert.equal((await f.request()).status, 429);
  assert.equal((await f.request('/api/health')).status, 200);
});

test('quota recovers after its window without restarting the application', async t => {
  const f = await fixture(t, { env: { KNOWLEDGE_READ_RATE_LIMIT: '1', KNOWLEDGE_RATE_WINDOW_MS: '1000' } });
  assert.equal((await f.request()).status, 200);
  assert.equal((await f.request()).status, 429);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await f.request()).status, 200);
});

test('invalid configuration fails startup rather than silently disabling protection', () => {
  for (const value of ['0', '-1', '1.5', '1e2', '', 'abc', '9007199254740992']) {
    assert.throws(() => createKnowledgeRateLimit({ env: { KNOWLEDGE_READ_RATE_LIMIT: value } }), /KNOWLEDGE_READ_RATE_LIMIT/);
  }
  assert.throws(() => createKnowledgeRateLimit({ env: { KNOWLEDGE_RATE_WINDOW_MS: '2147483648' } }), /KNOWLEDGE_RATE_WINDOW_MS/);
});

test('real Knowledge router blocks excess reads before Supabase; validation is retained', async t => {
  const f = await fixture(t, { realRouter: true, env: { KNOWLEDGE_READ_RATE_LIMIT: '2' } });
  assert.equal((await f.request('/api/knowledge/species?page=0')).status, 400);
  assert.equal(f.calls().databaseCalls, 0);
  assert.equal((await f.request('/api/knowledge/taxonomy?page=1&page_size=2')).status, 200);
  assert.equal(f.calls().databaseCalls, 1);
  assert.equal((await f.request()).status, 429);
  assert.equal(f.calls().databaseCalls, 1);
});

test('real Knowledge write route retains authentication and throttles before auth and multipart work', async t => {
  const f = await fixture(t, { realRouter: true, env: { KNOWLEDGE_WRITE_RATE_LIMIT: '1' } });
  const path = `/api/knowledge/species/${ID}/photos`;
  assert.equal((await f.request(path, { method: 'POST' })).status, 401);
  assert.equal((await f.request(path, { method: 'POST' })).status, 429);
  assert.deepEqual(f.calls(), { databaseCalls: 0, authCalls: 1 });
});
