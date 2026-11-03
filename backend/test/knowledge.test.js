const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
const { createKnowledgeRouter } = require('../src/routes/knowledge');
const { requireRole } = require('../src/middleware/auth');
const ID = '11111111-1111-4111-8111-111111111111';

test('invalid resource IDs are rejected before database access', async t => {
  const { request, calls } = await setup(t);
  for (const [path, method] of [['/species/bad', 'GET'], ['/species/bad/manage', 'GET'],
    ['/species/bad', 'DELETE'], ['/species/bad/photos', 'POST'],
    [`/species/${ID}/photos/bad/primary`, 'PATCH'], [`/species/${ID}/photos/bad`, 'DELETE'],
    [`/species/${ID}/photos/bad`, 'GET']]) {
    assert.equal((await request(path, method)).status, 400);
  }
  assert.equal(calls.length, 0);
});

for (const path of ['/species', '/species/manage', '/taxonomy']) {
  test(`${path} paginates with exact totals and stable ordering`, async t => {
    const { request, calls } = await setup(t, { data: [{ id: ID }], error: null, count: 5 });
    const response = await request(`${path}?page=2&page_size=2`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.pagination, { page: 2, page_size: 2, total: 5, total_pages: 3 });
    assert.deepEqual(calls.find(c => c[0] === 'range'), ['range', 2, 3]);
    assert.ok(calls.some(c => c[0] === 'order' && c[1] === 'id'));
    assert.equal(calls.find(c => c[0] === 'select')[2].count, 'exact');
  });
  test(`${path} rejects invalid pagination before database access`, async t => {
    const { request, calls } = await setup(t);
    for (const params of ['page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page=100001',
      'page=9007199254740992', 'page_size=0', 'page_size=101', 'page=1&page=2']) {
      assert.equal((await request(`${path}?${params}`)).status, 400, params);
    }
    assert.equal(calls.length, 0);
  });
  test(`${path} empty pages retain totals`, async t => {
    const { request } = await setup(t, { data: [], count: 3, error: null });
    const response = await request(`${path}?page=3&page_size=2`);
    assert.deepEqual(response.body.data, []);
    assert.equal(response.body.pagination.total_pages, 2);
  });
}

test('public filters use approved species, name matching and taxonomy family join', async t => {
  const { request, calls } = await setup(t, { data: [], error: null, count: 0 });
  assert.equal((await request('/species?q=Shorea&family=Dipterocarpaceae&conservation_status=Unknown&category=Tree')).status, 200);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'verification_status' && c[2] === 'approved'));
  assert.match(calls.find(c => c[0] === 'select')[1], /taxonomy!inner/);
  assert.deepEqual(calls.find(c => c[0] === 'is'), ['is', 'conservation_status', null]);
  assert.match(calls.find(c => c[0] === 'or')[1], /local_name.ilike.%Shorea%/);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'taxonomy.family' && c[2] === 'Dipterocarpaceae'));
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'species_category' && c[2] === 'Tree'));
});

test('whitespace family does not exclude species without taxonomy', async t => {
  const { request, calls } = await setup(t, { data: [], error: null, count: 0 });
  await request('/species?family=%20%20&conservation_status=EN');
  assert.doesNotMatch(calls.find(c => c[0] === 'select')[1], /!inner/);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'conservation_status' && c[2] === 'EN'));
});

test('public search rejects filter syntax and repeated parameters', async t => {
  const { request, calls } = await setup(t);
  for (const params of ['q=a&q=b', 'q=%25', 'q=x%2Cy', 'q=' + 'a'.repeat(101)]) {
    assert.equal((await request(`/species?${params}`)).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('create and update consistently reject empty or oversized optional text', async t => {
  const { request, calls } = await setup(t);
  for (const method of ['POST', 'PATCH']) {
    for (const fields of [{ common_name: ' ' }, { common_name: 'a'.repeat(201) },
      { conservation_status: 'a'.repeat(101) }, { description: 'a'.repeat(10001) }]) {
      assert.equal((await request(method === 'POST' ? '/species' : `/species/${ID}`, method,
        { scientific_name: 'Shorea', ...fields })).status, 400);
    }
  }
  assert.equal(calls.length, 0);
});

test('public species detail enforces approved status and excludes sensitive notes', async t => {
  const { request, calls } = await setup(t);
  assert.equal((await request(`/species/${ID}`)).status, 200);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'verification_status' && c[2] === 'approved'));
  assert.doesNotMatch(calls.find(c => c[0] === 'select')[1], /distribution_notes|location/);
});

for (const path of [`/species/${ID}`, `/species/${ID}/manage`]) {
  test(`${path} missing records return 404`, async t => {
    const { request } = await setup(t, { data: null, error: null });
    assert.equal((await request(path)).status, 404);
  });
}

for (const [path, method, body] of [['/species', 'GET'], ['/taxonomy', 'GET'],
  ['/species/manage', 'GET'], [`/species/${ID}`, 'GET'], [`/species/${ID}/manage`, 'GET'],
  ['/taxonomy', 'POST', { family: 'Family', genus: 'Genus' }],
  ['/species', 'POST', { scientific_name: 'Example' }],
  [`/species/${ID}`, 'PATCH', { scientific_name: 'Example' }], [`/species/${ID}`, 'DELETE']]) {
  test(`${method} ${path} hides database failure details`, async t => {
    const { request } = await setup(t, { data: null, error: { message: 'SECRET_DATABASE_DETAILS' } });
    const response = await request(path, method, body);
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(response.body), /SECRET_DATABASE_DETAILS/);
  });
}

test('unexpected rejected database request returns JSON 500', async t => {
  const { request } = await setup(t, new Error('PRIVATE_FAILURE'));
  const response = await request('/species');
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { message: 'Could not process knowledge request' });
});

test('JSON parser reports invalid JSON as 400 and oversized JSON as 413', async t => {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.use(require('../src/middleware/jsonErrorHandler'));
  app.post('/', (_req, res) => res.sendStatus(200));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  for (const [body, expected] of [['{', 400], [JSON.stringify({ value: 'a'.repeat(2000) }), 413]]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal(response.status, expected);
    assert.equal(typeof (await response.json()).message, 'string');
  }
});

async function setup(t, result = { data: { id: ID }, error: null }, role = 'officer') {
  const calls = [];
  const query = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'range', 'or', 'is', 'insert', 'update', 'single', 'maybeSingle']) {
    query[method] = (...args) => { calls.push([method, ...args]); return query; };
  }
  query.then = (resolve, reject) => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject);
  const database = { from(table) { calls.push(['from', table]); return query; } };
  const app = express();
  app.use(express.json());
  app.use(require("../src/middleware/jsonErrorHandler"));
  app.use('/api/knowledge', createKnowledgeRouter({
    supabase: database,
    // Authentication is a fixture; role enforcement uses the real middleware.
    requireAuth(req, res, next) {
      if (!role) return res.status(401).json({ message: 'Bearer token required' });
      req.user = { id: ID };
      req.profile = { role };
      req.supabase = database;
      next();
    },
    requireRole,
  }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  async function request(path, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/knowledge${path}`, {
      method,
      ...(body === undefined ? {} : {
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
    });
    return { status: response.status, body: await response.json() };
  }
  return { calls, request };
}

for (const [role, status] of [[null, 401], ['botanist', 403], ['researcher', 403]]) {
  test(`protected routes reject ${role || 'unauthenticated'} requests`, async t => {
    const { request, calls } = await setup(t, undefined, role);
    for (const [path, method] of [
      ['/species/manage', 'GET'], ['/species', 'POST'],
      [`/species/${ID}`, 'PATCH'], [`/species/${ID}`, 'DELETE'],
      ['/taxonomy', 'POST'], [`/species/${ID}/photos`, 'POST'],
    ]) {
      assert.equal((await request(path, method, method === 'GET' ? undefined : {})).status, status);
    }
    assert.equal(calls.length, 0);
  });
}

test('officer creates species with trimmed text and server-controlled fields', async t => {
  const { request, calls } = await setup(t);
  assert.equal((await request('/species', 'POST', {
    scientific_name: '  Shorea example  ', common_name: '  Example  ',
    verification_status: 'archived', created_by: 'untrusted',
  })).status, 201);
  assert.deepEqual(calls.find(c => c[0] === 'insert')[1], {
    scientific_name: 'Shorea example', common_name: 'Example',
    taxonomy_id: null, verification_status: 'approved', created_by: ID,
  });
});

test('invalid species creation never queries the database', async t => {
  const { request, calls } = await setup(t);
  for (const body of [{}, [], { scientific_name: ' ' },
    { scientific_name: 'x'.repeat(201) },
    { scientific_name: 'Example', taxonomy_id: 'bad' },
    { scientific_name: 'Example', common_name: 42 }]) {
    assert.equal((await request('/species', 'POST', body)).status, 400);
  }
  assert.equal(calls.length, 0);
});

for (const [code, status, message] of [
  ['23505', 409, 'A species with this scientific name already exists'],
  ['23503', 400, 'taxonomy_id does not refer to an existing taxonomy row'],
]) {
  for (const method of ['POST', 'PATCH']) {
    test(`${method} species maps database ${code} to ${status}`, async t => {
      const { request } = await setup(t, { data: null, error: { code } });
      const response = await request(method === 'POST' ? '/species' : `/species/${ID}`,
        method, { scientific_name: 'Example' });
      assert.equal(response.status, status);
      assert.deepEqual(response.body, { message });
    });
  }
}

test('partial update clears nullable text without changing other fields', async t => {
  const { request, calls } = await setup(t);
  assert.equal((await request(`/species/${ID}`, 'PATCH', { common_name: null })).status, 200);
  assert.deepEqual(calls.find(c => c[0] === 'update'), ['update', { common_name: null }]);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'id' && c[2] === ID));
});

test('empty and invalid species updates never query the database', async t => {
  const { request, calls } = await setup(t);
  for (const body of [{}, { verification_status: 'approved' },
    { common_name: '' }, { taxonomy_id: 'bad' }]) {
    assert.equal((await request(`/species/${ID}`, 'PATCH', body)).status, 400);
  }
  assert.equal((await request('/species/bad', 'PATCH', { common_name: 'Example' })).status, 400);
  assert.equal(calls.length, 0);
});

test('archive updates status rather than deleting the row', async t => {
  const { request, calls } = await setup(t);
  assert.deepEqual(await request(`/species/${ID}`, 'DELETE'), {
    status: 200, body: { message: 'Species archived' },
  });
  assert.deepEqual(calls.find(c => c[0] === 'update'), ['update', { verification_status: 'archived' }]);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'id' && c[2] === ID));
});

test('update and archive return 404 for missing species', async t => {
  const { request } = await setup(t, { data: null, error: null });
  for (const method of ['PATCH', 'DELETE']) {
    assert.equal((await request(`/species/${ID}`, method, { common_name: 'Example' })).status, 404);
  }
});

test('taxonomy creation trims required fields and supplies nullable fields', async t => {
  const { request, calls } = await setup(t);
  assert.equal((await request('/taxonomy', 'POST', { family: ' Example ', genus: ' Shorea ' })).status, 201);
  assert.deepEqual(calls.find(c => c[0] === 'insert')[1], {
    kingdom: null, division: null, class_name: null, order_name: null,
    family: 'Example', genus: 'Shorea',
  });
});

test('invalid taxonomy never queries the database', async t => {
  const { request, calls } = await setup(t);
  for (const body of [{}, { family: 'Example' },
    { family: ' ', genus: 'Shorea' }, { family: 'Example', genus: 12 },
    { family: 'Example', genus: 'x'.repeat(101) }]) {
    assert.equal((await request('/taxonomy', 'POST', body)).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('duplicate taxonomy returns 409', async t => {
  const { request } = await setup(t, { data: null, error: { code: '23505' } });
  assert.equal((await request('/taxonomy', 'POST', { family: 'Example', genus: 'Shorea' })).status, 409);
});

test('officer photo upload requires a photo before querying', async t => {
  const { request, calls } = await setup(t);
  assert.deepEqual(await request(`/species/${ID}/photos`, 'POST'), {
    status: 400, body: { message: 'Photo is required' },
  });
  assert.equal(calls.length, 0);
});
