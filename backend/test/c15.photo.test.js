
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const PLANT = '22222222-2222-4222-8222-222222222222';

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
      req.profile = {
        role: 'botanist',
        account_status: 'active'
      };
      req.supabase = db;
      next();
    },
    requireRole: (...roles) => (req, res, next) => {
      if (!roles.includes(req.profile.role)) {
        return res.sendStatus(403);
      }
      next();
    }
  }
};

const plantRouter = require('../src/routes/plants');

function fakeDb({ owner = BOTANIST, insertError = null } = {}) {
  const calls = {
    uploads: [],
    inserts: [],
    removes: []
  };

  return {
    calls,

    from(table) {
      if (table === 'plants') {
        return {
          select() {
            return {
              eq() { return this; },
              async maybeSingle() {
                return {
                  data: { id: PLANT, registered_by: owner },
                  error: null
                };
              }
            };
          }
        };
      }

      if (table === 'plant_media') {
        return {
          insert(row) {
            calls.inserts.push(row);

            return {
              select() {
                return {
                  async single() {
                    if (insertError) {
                      return { data: null, error: insertError };
                    }

                    return {
                      data: {
                        id: '33333333-3333-4333-8333-333333333333',
                        ...row
                      },
                      error: null
                    };
                  }
                };
              }
            };
          }
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },

    storage: {
      from(bucket) {
        assert.equal(bucket, 'plant-media');

        return {
          async upload(filePath, buffer, options) {
            calls.uploads.push({
              filePath,
              buffer,
              options
            });
            return { error: null };
          },

          async remove(paths) {
            calls.removes.push(paths);
            return { error: null };
          }
        };
      }
    }
  };
}

async function withApp(run) {
  const app = express();

  app.use('/api/plants', plantRouter);

  const server = await new Promise(resolve => {
    const instance = app.listen(
      0,
      '127.0.0.1',
      () => resolve(instance)
    );
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error =>
        error ? reject(error) : resolve()
      );
    });
  }
}

async function uploadPhoto(base, photoType = 'leaf') {
  const form = new FormData();

  form.set('photo_type', photoType);

  form.set(
    'photo',
    new Blob(
      [Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
      { type: 'image/jpeg' }
    ),
    'leaf.jpg'
  );

  const response = await fetch(
    `${base}/api/plants/${PLANT}/photo`,
    {
      method: 'POST',
      body: form
    }
  );

  return {
    status: response.status,
    body: await response.json()
  };
}

test('C15: uploads image and saves plant_media row', async () => {
  db = fakeDb();

  await withApp(async base => {
    const result = await uploadPhoto(base, 'leaf');

    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(db.calls.uploads.length, 1);
    assert.equal(db.calls.inserts.length, 1);

    const saved = db.calls.inserts[0];

    assert.equal(saved.plant_id, PLANT);
    assert.equal(saved.uploaded_by, BOTANIST);
    assert.equal(saved.photo_type, 'leaf');
    assert.equal(saved.media_type, 'image');
    assert.equal(saved.is_primary, false);

    assert.equal(
      saved.file_path,
      db.calls.uploads[0].filePath
    );
  });
});

test('C15: rejects uploads by non-owner', async () => {
  db = fakeDb({
    owner: '99999999-9999-4999-8999-999999999999'
  });

  await withApp(async base => {
    const result = await uploadPhoto(base);

    assert.equal(result.status, 403);
    assert.equal(db.calls.uploads.length, 0);
    assert.equal(db.calls.inserts.length, 0);
  });
});

test('C15: rejects invalid photo category', async () => {
  db = fakeDb();

  await withApp(async base => {
    const result = await uploadPhoto(base, 'root');

    assert.equal(result.status, 400);
    assert.equal(db.calls.uploads.length, 0);
    assert.equal(db.calls.inserts.length, 0);
  });
});

test('C15: removes image if database insert fails', async () => {
  db = fakeDb({
    insertError: { message: 'Simulated insert failure' }
  });

  await withApp(async base => {
    const result = await uploadPhoto(base);

    assert.equal(result.status, 500);
    assert.equal(db.calls.uploads.length, 1);
    assert.equal(db.calls.removes.length, 1);

    assert.deepEqual(
      db.calls.removes[0],
      [db.calls.uploads[0].filePath]
    );
  });
});
