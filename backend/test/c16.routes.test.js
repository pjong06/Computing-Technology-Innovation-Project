'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
// Fixture-only public origin; no network request is made to this host.
process.env.PUBLIC_PLANT_BASE_URL = 'https://example.test/p';
process.env.PUBLIC_PLANT_BASE_URL = 'https://plants.example.test/p/';

// Replace auth only within this isolated test process. Do not change auth.js.
const authPath = require.resolve('../src/middleware/auth');
let currentDb;
// Role of the signed-in test user. Tests that need an officer set it and reset it
// afterwards (see withRole).
let currentRole = 'botanist';
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth: (req, _res, next) => {
      req.user = { id: '11111111-1111-4111-8111-111111111111' };
      req.profile = { role: currentRole, account_status: 'active' };
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
  // Every update() and delete() call is recorded here, so a test can prove that
  // nothing was written when access was denied.
  const writes = [];

  function plantRow() {
    if (options.ownedPlant) {
      return {
        id: '22222222-2222-4222-8222-222222222222',
        qr_code_value: 'NIAH-PLT-00001',
        registered_by: '11111111-1111-4111-8111-111111111111'
      };
    }
    if (options.otherOwnersPlant) {
      // Registered by a different botanist than the signed-in test user.
      return {
        id: '22222222-2222-4222-8222-222222222222',
        qr_code_value: 'NIAH-PLT-00002',
        registered_by: '99999999-9999-4999-8999-999999999999'
      };
    }
    return null;
  }

  // Chain returned by update()/delete(): supports .eq().select().maybeSingle().
  // A write to an existing plant resolves with the changed row, like Supabase does;
  // anything else resolves with no row.
  function writeChain(table, row) {
    const plant = table === 'plants' ? plantRow() : null;
    return {
      eq() { return this; },
      select() { return this; },
      maybeSingle: async () => ({ data: plant ? { ...plant, ...row } : null, error: null })
    };
  }

  return {
    inserts,
    writes,
    from(table) {
      return {
        select() {
          return {
            eq() { return this; },
            maybeSingle: async () => ({
              data: table === 'plants' ? plantRow() : null,
              error: null
            })
          };
        },
        update(row) {
          writes.push({ table, op: 'update', row });
          return writeChain(table, row);
        },
        delete() {
          writes.push({ table, op: 'delete', row: null });
          return writeChain(table, {});
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

// Runs a test as a different role, then always switches back to botanist so the
// next test isn't affected even if this one fails.
async function withRole(role, run) {
  currentRole = role;
  try {
    await run();
  } finally {
    currentRole = 'botanist';
  }
}

// PATCH then DELETE the test plant; returns both responses with parsed bodies.
async function updateThenDeletePlant(base) {
  const url = `${base}/api/plants/22222222-2222-4222-8222-222222222222`;

  const updateResponse = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'Updated description' })
  });
  const deleteResponse = await fetch(url, { method: 'DELETE' });

  return {
    update: { status: updateResponse.status, body: await updateResponse.json() },
    remove: { status: deleteResponse.status, body: await deleteResponse.json() }
  };
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

test("7.9: botanist cannot update another botanist's plant (403)", async () => {
  currentDb = fakeSupabase({ otherOwnersPlant: true });

  await withApp(async base => {
    const response = await fetch(
      `${base}/api/plants/22222222-2222-4222-8222-222222222222`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'Updated description' })
      }
    );

    assert.equal(response.status, 403);
    assert.equal(currentDb.writes.length, 0);
  });
});

test("7.9: botanist cannot delete another botanist's plant (403)", async () => {
  currentDb = fakeSupabase({ otherOwnersPlant: true });

  await withApp(async base => {
    const response = await fetch(
      `${base}/api/plants/22222222-2222-4222-8222-222222222222`,
      { method: 'DELETE' }
    );

    assert.equal(response.status, 403);
    assert.equal(currentDb.writes.length, 0);
  });
});

test('7.9: botanist can update and delete their own plant', async () => {
  currentDb = fakeSupabase({ ownedPlant: true });

  await withApp(async base => {
    const { update, remove } = await updateThenDeletePlant(base);

    assert.equal(update.status, 200);
    assert.equal(update.body.plant.description, 'Updated description');
    assert.equal(remove.status, 200);
    assert.equal(remove.body.plant_id, '22222222-2222-4222-8222-222222222222');

    // One update to the plant, then the delete removes its observations and the plant.
    assert.deepEqual(
      currentDb.writes.map(w => `${w.op}:${w.table}`),
      ['update:plants', 'delete:observations', 'delete:plants']
    );
  });
});

test("7.9: officer can update and delete any botanist's plant", async () => {
  currentDb = fakeSupabase({ otherOwnersPlant: true });

  await withRole('officer', () =>
    withApp(async base => {
      const { update, remove } = await updateThenDeletePlant(base);

      assert.equal(update.status, 200);
      assert.equal(update.body.plant.description, 'Updated description');
      assert.equal(remove.status, 200);
      assert.equal(remove.body.plant_id, '22222222-2222-4222-8222-222222222222');

      assert.deepEqual(
        currentDb.writes.map(w => `${w.op}:${w.table}`),
        ['update:plants', 'delete:observations', 'delete:plants']
      );
    })
  );
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
