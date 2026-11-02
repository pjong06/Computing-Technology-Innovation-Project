'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
// Fixture-only public origin; no real network request is made to this host.
process.env.PUBLIC_PLANT_BASE_URL = 'https://example.test/p';

// Replace auth only within this isolated test process. Do not change auth.js.
const authPath = require.resolve('../src/middleware/auth');
let currentDb;
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth: (req, _res, next) => {
      req.user = { id: '11111111-1111-4111-8111-111111111111' };
      req.profile = { role: 'botanist', account_status: 'active' };
      req.supabase = currentDb;
      next();
    },
    requireRole: (...roles) => (req, res, next) =>
      roles.includes(req.profile.role)
        ? next()
        : res.status(403).json({ message: 'Insufficient permissions' })
  }
};

const plantRouter = require('../src/routes/plants');
const observationRouter = require('../src/routes/observations');


function fakeSupabase(options = {}) {
  const inserts = [];

  return {
    inserts,
    from(table) {
      return {
        select() {
          return {
            eq() { return this; },
            maybeSingle: async () => ({
              data: table === 'plants' && options.ownedPlant
                ? {
                    id: '22222222-2222-4222-8222-222222222222',
                    qr_code_value: 'NIAH-PLT-00001',
                    registered_by: '11111111-1111-4111-8111-111111111111'
                  }
                : null,
              error: null
            })
          };
        },
        insert(row) {
          inserts.push({ table, row });
          return {
            select() {
              return {
                single: async () => ({
                  data: {
                    id: '22222222-2222-4222-8222-222222222222',
                    ...row
                  },
                  error: null
                })
              };
            }
          };
        }
      };
    }
  };
}


async function withApp(run) {
  const app = express();
  app.use(express.json());
  app.use('/api/plants', plantRouter);
  app.use('/api/observations', observationRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    );
  }
}

async function post(base, endpoint, payload) {
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
}


test('C16: mobile plant fields are stored correctly', async () => {
  currentDb = fakeSupabase();

  await withApp(async base => {
    const response = await post(base, '/api/plants', {
      latitude: 3.8176,
      longitude: 113.781,
      location_name: 'Niah Cave entrance',
      morphology: 'Large green leaves with a woody stem',
      description: 'Young plant growing near the cave entrance',
      gps_accuracy_m: 5,
      client_record_id: '33333333-3333-4333-8333-333333333333'
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(currentDb.inserts.length, 1);

    const saved = currentDb.inserts[0];

    assert.equal(saved.table, 'plants');

    assert.equal(
      saved.row.location_description,
      'Niah Cave entrance'
    );

    assert.equal(
      saved.row.morphology,
      'Large green leaves with a woody stem'
    );

    assert.equal(
      saved.row.description,
      'Young plant growing near the cave entrance'
    );
  });
});


test('C16: observation stores health, life stage and measurement text', async () => {
  currentDb = fakeSupabase();
  await withApp(async base => {
    const response = await post(base, '/api/observations', {
      plant_id: '44444444-4444-4444-8444-444444444444',
      observed_at: '2026-10-31T02:00:00.000Z',
health_status: 'healthy',
life_stage: 'flowering',
height_cm: 250,
diameter_cm: 20,
measurement: '2.5 m tall',
      notes: 'Leaves present'
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(currentDb.inserts.length, 1);
    const saved = currentDb.inserts[0];
    assert.equal(saved.table, 'observations');
assert.equal(saved.row.height_cm, 250);
assert.equal(saved.row.diameter_cm, 20);
    assert.equal(saved.row.notes, 'Measurement: 2.5 m tall\n\nLeaves present');
    assert.match(saved.row.client_record_id, /^[0-9a-f-]{36}$/i);
    assert.equal(saved.row.observer_id, '11111111-1111-4111-8111-111111111111');
  });
});

test('C16: invalid observation notes return HTTP 400 without inserting', async () => {
  currentDb = fakeSupabase();
  await withApp(async base => {
    const response = await post(base, '/api/observations', {
      plant_id: '44444444-4444-4444-8444-444444444444',
      notes: { unexpected: 'object' }
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(currentDb.inserts.length, 0);
  });
});

test('C16: invalid plant coordinates return HTTP 400 without inserting', async () => {
  currentDb = fakeSupabase();
  await withApp(async base => {
    const response = await post(base, '/api/plants', {
      latitude: 120,
      longitude: 113.781,
      location_name: 'Invalid GPS'
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(currentDb.inserts.length, 0);
  });
});

test('7.9: plant PUT is denied with HTTP 403', async () => {
  currentDb = fakeSupabase();

  await withApp(async base => {
    const response = await fetch(
      `${base}/api/plants/22222222-2222-4222-8222-222222222222`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scientific_name: 'Updated plant'
        })
      }
    );

    assert.equal(response.status, 403);
    assert.equal(currentDb.inserts.length, 0);
  });
});

test('7.9: plant DELETE is denied with HTTP 403', async () => {
  currentDb = fakeSupabase();

  await withApp(async base => {
    const response = await fetch(
      `${base}/api/plants/22222222-2222-4222-8222-222222222222`,
      { method: 'DELETE' }
    );

    assert.equal(response.status, 403);
    assert.equal(currentDb.inserts.length, 0);
  });
});

test('7.9: QR lookup returns 404 for a plant not owned by the botanist', async () => {
  currentDb = fakeSupabase();

  await withApp(async base => {
    const response = await getQrResponse(
      base,
      '22222222-2222-4222-8222-222222222222'
    );

    assert.equal(response.status, 404);
    assert.equal(response.body.message, 'Plant not found');
  });
});

async function getQrResponse(base, plantId) {
  const response = await fetch(
    `${base}/api/plants/${plantId}/qr`
  );

  return {
    status: response.status,
    body: await response.json()
  };
}


test('7.9: owned plant QR lookup returns the correct tag', async () => {
  currentDb = fakeSupabase({ ownedPlant: true });

  await withApp(async base => {
    const response = await fetch(
      `${base}/api/plants/22222222-2222-4222-8222-222222222222/qr`
    );

    assert.equal(response.status, 200);

    const body = await response.json();

    assert.equal(body.qr_value, 'NIAH-PLT-00001');
    assert.match(body.qr_code, /^data:image\/png;base64,/);
  });
});

test('7.9: owned plant QR image returns PNG', async () => {
  currentDb = fakeSupabase({ ownedPlant: true });

  await withApp(async base => {
    const response = await fetch(
      `${base}/api/plants/22222222-2222-4222-8222-222222222222/qr/image`
    );

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type'),
      /^image\/png/
    );

    const image = Buffer.from(await response.arrayBuffer());

    // PNG file signature
    assert.deepEqual(
      [...image.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10]
    );
  });
});
