'use strict';

// Each refused sync operation is logged once at info level (so Render shows it): what it
// was, the answer's code and the record's IDs. Never the user, payload, message or token.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const syncRouter = require('../src/routes/sync');

const USER = '55555555-5555-4555-8555-555555555555';
const OPERATION = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';

async function push(rpcAnswer, operations) {
  const app = express();
  app.use(express.json());
  app.use('/api/sync', (req, _res, next) => {
    req.user = { id: USER };
    req.headers.authorization = 'Bearer SECRET_TOKEN';
    req.supabase = { rpc: async () => rpcAnswer };
    next();
  }, syncRouter);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations }),
    });
    return response.json();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function captureInfo(run) {
  const lines = [];
  const original = console.info;
  console.info = (...args) => lines.push(args);
  try {
    await run();
  } finally {
    console.info = original;
  }
  return lines;
}

const tagUpdate = {
  operation_id: OPERATION,
  entity_type: 'plant',
  operation_type: 'update',
  client_record_id: CLIENT,
  base_version: 3,
  payload: { qr_code_value: 'NIAH-PLT-00042', location_description: 'Near Siti\'s camp' },
};

test('a refused operation is logged at info with type, code and record id only', async () => {
  const lines = await captureInfo(() => push(
    { data: null, error: { code: '42501', message: 'Tag is not reserved by this botanist' } },
    [tagUpdate]
  ));
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0], 'Sync operation refused');
  assert.deepEqual(lines[0][1], {
    entity_type: 'plant',
    operation_type: 'update',
    status: 'conflict',
    code: 'tag_not_yours',
    operation_id: OPERATION,
    client_record_id: CLIENT,
  });
  const logged = JSON.stringify(lines);
  for (const secret of [USER, 'SECRET_TOKEN', 'NIAH-PLT-00042', 'Siti', 'not reserved']) {
    assert.ok(!logged.includes(secret), `${secret} is not logged`);
  }
});

test('every kind of refusal is logged (plant_locked, version conflict, retry); a success is not', async () => {
  const cases = [
    [{ data: { operation_id: OPERATION, status: 'failed', code: 'not_found', message: 'Plant record not found' }, error: null }, 'plant_locked'],
    [{ data: { operation_id: OPERATION, status: 'conflict', code: 'version_conflict', message: 'Plant changed on the server' }, error: null }, 'version_conflict'],
    [{ data: null, error: { code: 'XX000', message: 'boom' } }, 'server_unavailable'],
  ];
  for (const [answer, code] of cases) {
    const originalError = console.error;
    console.error = () => {};
    let lines;
    try {
      lines = await captureInfo(() => push(answer, [tagUpdate]));
    } finally {
      console.error = originalError;
    }
    assert.equal(lines.length, 1, code);
    assert.equal(lines[0][1].code, code);
  }
  const success = await captureInfo(() => push(
    { data: { operation_id: OPERATION, status: 'success', server_id: CLIENT, row_version: 4 }, error: null },
    [tagUpdate]
  ));
  assert.equal(success.length, 0);
});

test('odd values from a client are logged as "unknown", never as given', async () => {
  const lines = await captureInfo(() => push(
    { data: null, error: null },
    [{ ...tagUpdate, operation_id: 'not-a-uuid <script>', entity_type: 'plant\nFAKE LOG LINE' }]
  ));
  assert.equal(lines.length, 1);
  assert.equal(lines[0][1].operation_id, 'unknown');
  assert.equal(lines[0][1].entity_type, 'unknown');
  assert.equal(lines[0][1].code, 'invalid_operation');
});
