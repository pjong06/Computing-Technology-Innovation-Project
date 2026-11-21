'use strict';

// "Show QR" for any approved plant: GET /api/plants/:id/qr and /qr/image.
// A plant's QR only encodes its public tag URL, which is printed on the plant, so active
// botanists and officers get it for any APPROVED plant with a real NIAH-PLT tag; the botanist
// who registered a plant gets it whatever its status. Everything else is 404, and the real
// auth middleware keeps out anonymous requests (401) and visitor accounts (403).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
process.env.PUBLIC_PLANT_BASE_URL = 'https://plants.example.test/p/';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const OFFICER = '33333333-3333-4333-8333-333333333333';
const VISITOR = '44444444-4444-4444-8444-444444444444';
const SUSPENDED = '55555555-5555-4555-8555-555555555555';

const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const PLANTS = {
  otherApproved: { id: id(1), qr_code_value: 'NIAH-PLT-00010', registered_by: OTHER, plant_status: 'approved', deleted_at: null },
  importedApproved: { id: id(2), qr_code_value: 'NIAH-PLT-00011', registered_by: null, plant_status: 'approved', deleted_at: null },
  otherPending: { id: id(3), qr_code_value: 'NIAH-PLT-00012', registered_by: OTHER, plant_status: 'pending', deleted_at: null },
  otherRejected: { id: id(4), qr_code_value: 'NIAH-PLT-00013', registered_by: OTHER, plant_status: 'rejected', deleted_at: null },
  deleted: { id: id(5), qr_code_value: 'NIAH-PLT-00014', registered_by: OTHER, plant_status: 'approved', deleted_at: '2026-11-20T00:00:00Z' },
  placeholder: { id: id(6), qr_code_value: `plant:${id(6)}`, registered_by: OTHER, plant_status: 'approved', deleted_at: null },
  noTag: { id: id(7), qr_code_value: null, registered_by: OTHER, plant_status: 'approved', deleted_at: null },
  ownPending: { id: id(8), qr_code_value: 'NIAH-PLT-00015', registered_by: ME, plant_status: 'pending', deleted_at: null },
  ownDeleted: { id: id(9), qr_code_value: 'NIAH-PLT-00016', registered_by: ME, plant_status: 'pending', deleted_at: '2026-11-20T00:00:00Z' },
};
const PROFILES = {
  [ME]: { id: ME, role: 'botanist', account_status: 'active' },
  [OFFICER]: { id: OFFICER, role: 'officer', account_status: 'active' },
  [VISITOR]: { id: VISITOR, role: 'visitor', account_status: 'active' },
  [SUSPENDED]: { id: SUSPENDED, role: 'botanist', account_status: 'suspended' },
};
const TOKENS = { 'botanist-token': ME, 'officer-token': OFFICER, 'visitor-token': VISITOR, 'suspended-token': SUSPENDED };

// Every plant read, so a test can show refused requests never reached the plants table.
const plantReads = [];

// The real auth middleware, with Supabase replaced: token -> user, and a per-user client
// that answers profiles and plants by id.
const configPath = require.resolve('../src/config/supabase');
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: {
    verifier: {
      auth: {
        async getUser(token) {
          const userId = TOKENS[token];
          return userId ? { data: { user: { id: userId } }, error: null } : { data: { user: null }, error: { message: 'bad token' } };
        },
      },
    },
    forUser() {
      return {
        from(table) {
          let wanted = null;
          const query = {
            select() { return query; },
            eq(_column, value) { wanted = value; return query; },
            async maybeSingle() {
              if (table === 'profiles') return { data: PROFILES[wanted] ?? null, error: null };
              plantReads.push(wanted);
              return { data: Object.values(PLANTS).find((plant) => plant.id === wanted) ?? null, error: null };
            },
          };
          return query;
        },
      };
    },
    publicClient: {},
  },
};
const claimsPath = require.resolve('../src/middleware/verifiedJwtClaims');
require.cache[claimsPath] = { id: claimsPath, filename: claimsPath, loaded: true, exports: { hasExpectedClaims: () => true } };

const plantRouter = require('../src/routes/plants');

async function withApp(run) {
  const app = express();
  app.use('/api/plants', plantRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const get = (base, path, token) =>
  fetch(base + path, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

async function expectPng(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  const png = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  // The same label as before: 1000 px wide, room for the tag text under the QR.
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1000);
  assert.ok(meta.height > 1000);
}

test("another botanist's approved plant: PNG label and QR data for botanists and officers", async () => {
  await withApp(async (base) => {
    for (const token of ['botanist-token', 'officer-token']) {
      for (const plant of [PLANTS.otherApproved, PLANTS.importedApproved]) {
        const image = await get(base, `/api/plants/${plant.id}/qr/image`, token);
        await expectPng(image);
        assert.match(image.headers.get('content-disposition'), new RegExp(`filename="${plant.qr_code_value}\\.png"`));

        const data = await get(base, `/api/plants/${plant.id}/qr`, token);
        assert.equal(data.status, 200);
        const body = await data.json();
        assert.equal(body.qr_value, plant.qr_code_value);
        assert.equal(body.public_url, `https://plants.example.test/p/${plant.qr_code_value}`);
        assert.match(body.qr_code, /^data:image\/png;base64,/);
      }
    }
  });
});

test('own plants: any review status, as before', async () => {
  await withApp(async (base) => {
    await expectPng(await get(base, `/api/plants/${PLANTS.ownPending.id}/qr/image`, 'botanist-token'));
    assert.equal((await get(base, `/api/plants/${PLANTS.ownPending.id}/qr`, 'botanist-token')).status, 200);
  });
});

test("other botanists' pending or rejected plants and deleted plants stay 404", async () => {
  await withApp(async (base) => {
    for (const token of ['botanist-token', 'officer-token']) {
      for (const plant of [PLANTS.otherPending, PLANTS.otherRejected, PLANTS.deleted]) {
        for (const suffix of ['qr/image', 'qr']) {
          const response = await get(base, `/api/plants/${plant.id}/${suffix}`, token);
          assert.equal(response.status, 404, `${plant.qr_code_value} ${suffix} as ${token}`);
          assert.notEqual(response.headers.get('content-type'), 'image/png');
          assert.equal((await response.json()).message, 'Plant not found');
        }
      }
    }
    // Deleted is deleted, even for the botanist who registered it.
    assert.equal((await get(base, `/api/plants/${PLANTS.ownDeleted.id}/qr/image`, 'botanist-token')).status, 404);
    // A plant that doesn't exist.
    assert.equal((await get(base, `/api/plants/${id(99)}/qr/image`, 'botanist-token')).status, 404);
  });
});

test('placeholder tag or no tag: 404 "No tag attached yet"', async () => {
  await withApp(async (base) => {
    for (const plant of [PLANTS.placeholder, PLANTS.noTag]) {
      for (const suffix of ['qr/image', 'qr']) {
        const response = await get(base, `/api/plants/${plant.id}/${suffix}`, 'botanist-token');
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { message: 'No tag attached yet', code: 'no_tag' });
      }
    }
  });
});

test('anonymous 401; visitor accounts and suspended staff refused before any plant is read', async () => {
  await withApp(async (base) => {
    plantReads.length = 0;
    const plantPath = `/api/plants/${PLANTS.otherApproved.id}/qr/image`;
    assert.equal((await get(base, plantPath)).status, 401);
    assert.equal((await get(base, plantPath, 'not-a-real-token')).status, 401);
    // Signed in, but not active staff: the auth middleware answers 403 for every staff route.
    assert.equal((await get(base, plantPath, 'visitor-token')).status, 403);
    assert.equal((await get(base, plantPath, 'suspended-token')).status, 403);
    assert.equal((await get(base, `/api/plants/${PLANTS.otherApproved.id}/qr`, 'visitor-token')).status, 403);
    assert.deepEqual(plantReads, [], 'no plant was looked up');
  });
});

test('an invalid plant id is refused before the database', async () => {
  await withApp(async (base) => {
    plantReads.length = 0;
    assert.equal((await get(base, '/api/plants/not-a-uuid/qr/image', 'botanist-token')).status, 400);
    assert.deepEqual(plantReads, []);
  });
});
