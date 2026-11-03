'use strict';

// Plant photos (retry-safe, locked after submission) and visit photos
// (POST /api/observations/:id/photo). Same set-up as c15.photo.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const PLANT = '22222222-2222-4222-8222-222222222222';
const OBSERVATION = '44444444-4444-4444-8444-444444444444';
const PHOTO = '55555555-5555-4555-8555-555555555555';

let db;

// Mock authentication for tests only.
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth(req, res, next) {
      req.user = { id: BOTANIST };
      req.profile = { role: 'botanist', account_status: 'active' };
      req.supabase = db;
      next();
    },
    requireRole: (...roles) => (req, res, next) => {
      if (!roles.includes(req.profile.role)) return res.sendStatus(403);
      next();
    },
  },
};

const plantRouter = require('../src/routes/plants');
const observationRouter = require('../src/routes/observations');

// A fake Supabase. `rows` gives what each table's lookup returns; `existingMedia` is a
// photo already saved with this client_photo_id; insert/upload results can fail.
function fakeDb({
  plant = { id: PLANT, registered_by: BOTANIST, plant_status: 'pending' },
  observation = { id: OBSERVATION, observer_id: BOTANIST, review_status: 'draft', deleted_at: null },
  existingMedia = null,
  insertErrors = [],
  uploadError = null,
} = {}) {
  const calls = { uploads: [], inserts: [], removes: [], buckets: [] };
  const lookups = { plants: plant, observations: observation };

  function lookupChain(result) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      async maybeSingle() { return { data: result(), error: null }; },
    };
    return chain;
  }

  return {
    calls,
    from(table) {
      if (table in lookups) return lookupChain(() => lookups[table]);
      if (table === 'plant_media' || table === 'observation_media') {
        const chain = lookupChain(() => existingMedia);
        chain.insert = row => {
          calls.inserts.push({ table, row });
          return {
            select() {
              return {
                async single() {
                  const error = insertErrors.shift() || null;
                  if (error) {
                    // A finished parallel attempt is visible to the next lookup.
                    if (error.code === '23505') existingMedia = { id: 'raced', ...row };
                    return { data: null, error };
                  }
                  return { data: { id: '33333333-3333-4333-8333-333333333333', ...row }, error: null };
                },
              };
            },
          };
        };
        return chain;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from(bucket) {
        calls.buckets.push(bucket);
        return {
          async upload(filePath, buffer, options) {
            calls.uploads.push({ bucket, filePath, options });
            return { error: uploadError };
          },
          async remove(paths) {
            calls.removes.push({ bucket, paths });
            return { error: null };
          },
        };
      },
    },
  };
}

async function withApp(run) {
  const app = express();
  app.use('/api/plants', plantRouter);
  app.use('/api/observations', observationRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

async function post(base, path, fields, withFile = true) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (withFile) {
    form.set('photo', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'p.jpg');
  }
  const response = await fetch(`${base}${path}`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json() };
}

const plantPhoto = (base, fields) => post(base, `/api/plants/${PLANT}/photo`, { photo_type: 'leaf', ...fields });
const visitPhoto = (base, fields, withFile) =>
  post(base, `/api/observations/${OBSERVATION}/photo`, { client_photo_id: PHOTO, ...fields }, withFile);

// ---- Plant photos ----

test('plant photo stores the phone photo ID so it can be found on retry', async () => {
  db = fakeDb();
  await withApp(async base => {
    const result = await plantPhoto(base, { client_photo_id: PHOTO });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(db.calls.inserts[0].row.client_record_id, PHOTO);
  });
});

test('a retried plant photo returns the saved row and uploads nothing', async () => {
  db = fakeDb({ existingMedia: { id: 'saved', client_record_id: PHOTO } });
  await withApp(async base => {
    const result = await plantPhoto(base, { client_photo_id: PHOTO });
    assert.equal(result.status, 200);
    assert.equal(result.body.media.id, 'saved');
    assert.equal(db.calls.uploads.length, 0);
  });
});

test('an invalid plant photo ID is refused before upload', async () => {
  db = fakeDb();
  await withApp(async base => {
    assert.equal((await plantPhoto(base, { client_photo_id: 'nope' })).status, 400);
    assert.equal(db.calls.uploads.length, 0);
  });
});

test('photos on a plant that is no longer pending are locked (409)', async () => {
  db = fakeDb({ plant: { id: PLANT, registered_by: BOTANIST, plant_status: 'approved' } });
  await withApp(async base => {
    const result = await plantPhoto(base, { client_photo_id: PHOTO });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'photos_locked');
    assert.equal(db.calls.uploads.length, 0);
  });
});

test('a storage RLS refusal on a plant photo becomes "locked", not a server error', async () => {
  db = fakeDb({ uploadError: { statusCode: '403', message: 'new row violates row-level security policy' } });
  await withApp(async base => {
    const result = await plantPhoto(base, { client_photo_id: PHOTO });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'photos_locked');
  });
});

// ---- Visit photos ----

test('a visit photo goes to the observer\'s own folder and an observation_media row', async () => {
  db = fakeDb();
  await withApp(async base => {
    const result = await visitPhoto(base, { caption: ' Flower close-up ' });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const upload = db.calls.uploads[0];
    assert.equal(upload.bucket, 'observation-media');
    assert.match(upload.filePath, new RegExp(`^${BOTANIST}/${OBSERVATION}/[0-9a-f-]{36}\\.jpg$`));
    assert.deepEqual(db.calls.inserts[0], {
      table: 'observation_media',
      row: {
        observation_id: OBSERVATION,
        uploaded_by: BOTANIST,
        file_path: upload.filePath,
        media_type: 'image',
        caption: 'Flower close-up',
        client_record_id: PHOTO,
      },
    });
  });
});

test('a retried visit photo returns the saved row and uploads nothing', async () => {
  db = fakeDb({ existingMedia: { id: 'saved', client_record_id: PHOTO } });
  await withApp(async base => {
    const result = await visitPhoto(base, {});
    assert.equal(result.status, 200);
    assert.equal(result.body.media.id, 'saved');
    assert.equal(db.calls.uploads.length, 0);
  });
});

for (const status of ['pending', 'approved']) {
  test(`visit photos are locked once the visit is ${status}`, async () => {
    db = fakeDb({ observation: { id: OBSERVATION, observer_id: BOTANIST, review_status: status, deleted_at: null } });
    await withApp(async base => {
      const result = await visitPhoto(base, {});
      assert.equal(result.status, 409);
      assert.equal(result.body.message, "Photos can't be added after submission");
      assert.equal(db.calls.uploads.length, 0);
    });
  });
}

test('a rejected visit can get photos again', async () => {
  db = fakeDb({ observation: { id: OBSERVATION, observer_id: BOTANIST, review_status: 'rejected', deleted_at: null } });
  await withApp(async base => {
    assert.equal((await visitPhoto(base, {})).status, 201);
  });
});

test('only the observer can add visit photos; unknown or deleted visits are 404', async () => {
  db = fakeDb({ observation: { id: OBSERVATION, observer_id: OTHER, review_status: 'draft', deleted_at: null } });
  await withApp(async base => assert.equal((await visitPhoto(base, {})).status, 403));
  db = fakeDb({ observation: null });
  await withApp(async base => assert.equal((await visitPhoto(base, {})).status, 404));
  db = fakeDb({ observation: { id: OBSERVATION, observer_id: BOTANIST, review_status: 'draft', deleted_at: '2026-11-01' } });
  await withApp(async base => assert.equal((await visitPhoto(base, {})).status, 404));
  assert.equal(db.calls.uploads.length, 0);
});

test('invalid visit photo requests never upload', async () => {
  db = fakeDb();
  await withApp(async base => {
    assert.equal((await post(base, '/api/observations/bad/photo', { client_photo_id: PHOTO })).status, 400);
    assert.equal((await visitPhoto(base, { client_photo_id: 'bad' })).status, 400);
    assert.equal((await visitPhoto(base, {}, false)).status, 400); // no file
    assert.equal((await visitPhoto(base, { caption: 'x'.repeat(501) })).status, 400);
    assert.equal(db.calls.uploads.length, 0);
  });
});

test('a failed visit photo row removes the stored file', async () => {
  db = fakeDb({ insertErrors: [{ code: 'XX000', message: 'SECRET_DATABASE_DETAILS' }] });
  await withApp(async base => {
    const result = await visitPhoto(base, {});
    assert.equal(result.status, 500);
    assert.ok(!JSON.stringify(result.body).includes('SECRET'));
    assert.deepEqual(db.calls.removes, [{ bucket: 'observation-media', paths: [db.calls.uploads[0].filePath] }]);
  });
});

test('two attempts racing with the same photo ID end with one saved row (200)', async () => {
  db = fakeDb({ insertErrors: [{ code: '23505', message: 'duplicate key' }] });
  await withApp(async base => {
    const result = await visitPhoto(base, {});
    assert.equal(result.status, 200);
    assert.equal(result.body.media.id, 'raced');
    assert.equal(db.calls.removes.length, 1); // the duplicate file is removed
  });
});

test('a storage RLS refusal on a visit photo becomes "locked"', async () => {
  db = fakeDb({ uploadError: { statusCode: '403', message: 'new row violates row-level security policy' } });
  await withApp(async base => {
    const result = await visitPhoto(base, {});
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'photos_locked');
  });
});
