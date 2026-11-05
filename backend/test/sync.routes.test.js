'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const syncRouter = require('../src/routes/sync');

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const PLANT_CLIENT_ID = '33333333-3333-4333-8333-333333333333';

function operation(overrides = {}) {
  return {
    operation_id: OPERATION_ID,
    entity_type: 'plant',
    operation_type: 'create',
    client_record_id: CLIENT_ID,
    payload: {
      latitude: 3.8176,
      longitude: 113.781,
      location_description: 'Niah National Park',
    },
    ...overrides,
  };
}

function fakeSupabase(options = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params });
      if (options.error) return { data: null, error: options.error };
      if (name === 'pull_botanist_changes') {
        return { data: options.changes ?? [], error: null };
      }
      return {
        data: options.result ?? {
          operation_id: params.p_operation_id,
          status: 'success',
          entity_type: params.p_entity_type,
          operation_type: params.p_operation_type,
          client_record_id: params.p_client_record_id,
          server_id: '44444444-4444-4444-8444-444444444444',
          row_version: 1,
          server_cursor: 96,
        },
        error: null,
      };
    },
  };
}

async function withApp(database, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/sync', (req, _res, next) => {
    req.user = { id: '55555555-5555-4555-8555-555555555555' };
    req.profile = { role: 'botanist', account_status: 'active' };
    req.supabase = database;
    next();
  });
  app.use('/api/sync', syncRouter);

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    );
  }
}

async function requestJson(base, path, options = {}) {
  const url = new URL(path, base);
  const body = options.body === undefined
    ? null
    : JSON.stringify(options.body);

  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? 'GET',
      headers: body === null
        ? {}
        : {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          body: raw ? JSON.parse(raw) : null,
        });
      });
    });
    request.on('error', reject);
    if (body !== null) request.write(body);
    request.end();
  });
}

async function push(base, operations) {
  return requestJson(base, '/api/sync/push', {
    method: 'POST',
    body: { operations },
  });
}

test('sync push sends valid operations to the transactional RPC in order', async () => {
  const database = fakeSupabase();
  const second = operation({
    operation_id: '66666666-6666-4666-8666-666666666666',
    entity_type: 'observation',
    client_record_id: '77777777-7777-4777-8777-777777777777',
    payload: { plant_client_record_id: PLANT_CLIENT_ID },
  });

  await withApp(database, async base => {
    const response = await push(base, [operation(), second]);

    assert.equal(response.status, 200);
    assert.equal(response.body.summary.success, 2);
    assert.deepEqual(
      database.calls.map(call => call.params.p_entity_type),
      ['plant', 'observation']
    );
    assert.equal(
      database.calls[1].params.p_payload.plant_client_record_id,
      PLANT_CLIENT_ID
    );
  });
});

test('sync push rejects malformed operations without calling Supabase', async () => {
  const database = fakeSupabase();

  await withApp(database, async base => {
    const response = await push(base, [operation({ operation_id: 'not-a-uuid' })]);

    assert.equal(response.status, 200);
    assert.equal(response.body.results[0].status, 'failed');
    assert.equal(response.body.results[0].code, 'invalid_operation');
    assert.equal(database.calls.length, 0);
  });
});

test('sync push rejects empty updates that would only increase row_version', async () => {
  const database = fakeSupabase();

  await withApp(database, async base => {
    const response = await push(base, [operation({
      operation_type: 'update',
      base_version: 1,
      payload: {},
    })]);

    assert.equal(response.body.results[0].status, 'failed');
    assert.match(response.body.results[0].message, /editable fields/);
    assert.equal(database.calls.length, 0);
  });
});

test('sync push reports version conflicts without acknowledging success', async () => {
  const database = fakeSupabase({
    result: {
      operation_id: OPERATION_ID,
      status: 'conflict',
      code: 'version_conflict',
      row_version: 3,
    },
  });

  await withApp(database, async base => {
    const response = await push(base, [operation({
      operation_type: 'update',
      base_version: 2,
      payload: { description: 'Local edit' },
    })]);

    assert.equal(response.body.summary.conflict, 1);
    assert.equal(response.body.summary.success, 0);
    assert.equal(response.body.results[0].row_version, 3);
  });
});

test('temporary database errors return retry so the outbox keeps the operation', async () => {
  const database = fakeSupabase({ error: { code: '08006' } });

  await withApp(database, async base => {
    const response = await push(base, [operation()]);

    assert.equal(response.body.summary.retry, 1);
    assert.equal(response.body.results[0].code, 'server_unavailable');
  });
});

test('sync pull returns ordered changes and advances the cursor', async () => {
  const database = fakeSupabase({
    changes: [
      { sequence_cursor: 96, entity_type: 'plants', action: 'UPDATE' },
      { sequence_cursor: 97, entity_type: 'observations', action: 'INSERT' },
    ],
  });

  await withApp(database, async base => {
    const response = await requestJson(base, '/api/sync/pull?cursor=95&limit=100');
    const body = response.body;

    assert.equal(response.status, 200);
    assert.equal(body.changes.length, 2);
    assert.equal(body.next_cursor, 97);
    assert.equal(body.has_more, false);
    assert.deepEqual(database.calls[0], {
      name: 'pull_botanist_changes',
      params: { p_after_sequence: 95, p_limit: 100 },
    });
  });
});

test('sync pull validates cursor and limit before querying Supabase', async () => {
  const database = fakeSupabase();

  await withApp(database, async base => {
    const badCursor = await requestJson(base, '/api/sync/pull?cursor=-1');
    const badLimit = await requestJson(base, '/api/sync/pull?limit=501');

    assert.equal(badCursor.status, 400);
    assert.equal(badLimit.status, 400);
    assert.equal(database.calls.length, 0);
  });
});

// ---- Tags the server refuses (tag in use / plant locked) ----

function tagUpdate(overrides = {}) {
  return operation({
    operation_type: 'update',
    base_version: 3,
    payload: { qr_code_value: 'NIAH-PLT-00042' },
    ...overrides,
  });
}

// Pushes one operation against a fake database and returns the whole response.
async function pushOne(databaseOptions, op = tagUpdate()) {
  let response;
  await withApp(fakeSupabase(databaseOptions), async base => {
    response = await push(base, [op]);
  });
  return response;
}

test('sync push reports a tag another plant already has as a tag_in_use conflict', async () => {
  const response = await pushOne({
    error: {
      code: '23505',
      message: 'duplicate key value violates unique constraint "plants_qr_code_value_key"',
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.results[0], {
    operation_id: OPERATION_ID,
    status: 'conflict',
    code: 'tag_in_use',
    message: 'This tag is already attached to another plant',
  });
  assert.equal(response.body.summary.conflict, 1);
});

test('sync push leaves a duplicate client_record_id as a retry, not a tag problem', async () => {
  const { body } = await pushOne(
    {
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "plants_client_record_id_key"',
      },
    },
    operation({ payload: { ...operation().payload, qr_code_value: 'NIAH-PLT-00042' } })
  );

  assert.equal(body.results[0].status, 'retry');
  assert.equal(body.results[0].code, 'server_unavailable');
});

test('sync push reports a plant update refused by RLS as plant_locked', async () => {
  const { body } = await pushOne({
    error: { code: '42501', message: 'new row violates row-level security policy for table "plants"' },
  });

  assert.equal(body.results[0].status, 'conflict');
  assert.equal(body.results[0].code, 'plant_locked');
  assert.equal(body.results[0].message, "This plant can't be changed any more");
});

test('sync push reports a plant update hidden from the botanist as plant_locked', async () => {
  const { body } = await pushOne({
    result: {
      operation_id: OPERATION_ID,
      status: 'failed',
      code: 'not_found',
      message: 'Plant record not found',
    },
  });

  assert.equal(body.results[0].status, 'conflict');
  assert.equal(body.results[0].code, 'plant_locked');
});

test('sync push keeps an inactive account as permission_denied, not a locked plant', async () => {
  const { body } = await pushOne({
    error: { code: '42501', message: 'Botanist role required' },
  });

  assert.equal(body.results[0].status, 'failed');
  assert.equal(body.results[0].code, 'permission_denied');
});
