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
  assert.doesNotMatch(calls.find(c => c[0] === 'select')[1], /reference_(?:image|observation)_/);
  assert.match(calls.find(c => c[0] === 'select')[1], /source,\s*licence_code,\s*attribution,\s*photographer,\s*source_url/);
});

test('species responses remove a trailing legacy observation source', async t => {
  const legacySource = 'Species description.\nSource: iNaturalist observation https://www.inaturalist.org/observations/123';
  const { request } = await setup(t, {
    data: { id: ID, description: legacySource, species_media: [] },
    error: null,
  });
  const detail = await request(`/species/${ID}`);
  assert.equal(detail.body.data.description, 'Species description.');
});

test('officer species reads and writes select only editor fields', async t => {
  for (const [path, method, body] of [
    [`/species/${ID}/manage`, 'GET'],
    ['/species', 'POST', { scientific_name: 'Shorea example' }],
    [`/species/${ID}`, 'PATCH', { common_name: 'Example' }],
  ]) {
    const { request, calls } = await setup(t, {
      data: { id: ID, scientific_name: 'Shorea example', description: 'Species description.', species_media: [] },
      error: null,
    });
    assert.ok([200, 201].includes((await request(path, method, body)).status));
    const columns = calls.find(call => call[0] === 'select')[1];
    assert.doesNotMatch(columns, /\*/);
    assert.doesNotMatch(columns, /reference_(?:image|observation)_/);
    assert.match(columns, /scientific_name/);
  }
});

test('public species photo responses include attribution fields without internal paths', async t => {
  const photo = {
    file_path: `${ID}/reference.jpg`,
    source: 'inaturalist',
    licence_code: 'cc-by',
    attribution: 'Photographer Name',
    photographer: 'Photographer Name',
    source_url: 'https://www.inaturalist.org/photos/123',
    uploaded_by: ID,
  };
  const { request, calls } = await setup(t, { data: photo, error: null });
  const response = await request(`/species/${ID}/photos/${ID}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    url: 'https://signed.example/photo.jpg',
    expires_in: 60,
    source: 'inaturalist',
    licence_code: 'cc-by',
    attribution: 'Photographer Name',
    photographer: 'Photographer Name',
    source_url: 'https://www.inaturalist.org/photos/123',
  });
  assert.match(calls.find(call => call[0] === 'select')[1], /source, licence_code, attribution, photographer, source_url/);
});

test('public species photos are ordered with SFC photos before references', async t => {
  const photos = [
    { id: 'reference', source: 'inaturalist', is_primary: true, licence_code: 'cc-by' },
    { id: 'sfc', source: 'sfc', is_primary: false, licence_code: null },
  ];
  const { request, calls } = await setup(t, {
    data: [{ id: ID, species_media: photos }],
    error: null,
    count: 1,
  });
  const response = await request('/species');

  assert.deepEqual(response.body.data[0].species_media.map(photo => photo.source), ['sfc', 'inaturalist']);
  const columns = calls.find(call => call[0] === 'select')[1];
  assert.match(columns, /species_media\(id, is_primary, source, licence_code, attribution, photographer, source_url\)/);
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
  const database = {
    from(table) { calls.push(['from', table]); return query; },
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(filePath, expiresIn) {
            calls.push(['createSignedUrl', bucket, filePath, expiresIn]);
            return { data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null };
          },
        };
      },
    },
  };
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
    const isFormData = body instanceof FormData;

    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/knowledge${path}`,
      {
        method,
        ...(body === undefined
          ? {}
          : isFormData
            ? { body }
            : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      }
    );

    return {
      status: response.status,
      body: await response.json(),
    };
  }
  return { calls, request, database };
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

test('officer photo upload rejects files larger than 5 MiB', async t => {
  const { request, calls } = await setup(t);
  const form = new FormData();

  form.append(
    'photo',
    new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], {
      type: 'image/jpeg',
    }),
    'oversized.jpg'
  );

  const response = await request(
    `/species/${ID}/photos`,
    'POST',
    form
  );

  assert.equal(response.status, 413);
  assert.deepEqual(response.body, {
    message: 'The photo must be 5 MB or smaller.',
  });
  assert.equal(calls.length, 0);
});

test('officer photo upload rejects multiple files', async t => {
  const { request, calls } = await setup(t);
  const form = new FormData();

  for (const name of ['first.jpg', 'second.jpg']) {
    form.append(
      'photo',
      new Blob(['test image'], { type: 'image/jpeg' }),
      name
    );
  }

  const response = await request(
    `/species/${ID}/photos`,
    'POST',
    form
  );

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    message: 'Upload one photo using the photo field, without extra fields.',
  });
  assert.equal(calls.length, 0);
});

test('officer can upload one valid photo below 5 MiB', async t => {
  const sharp = require('sharp');

  // Simulate an approved species.
  const { request, calls, database } = await setup(t, {
    data: { id: ID, verification_status: 'approved' },
    error: null,
  });

  const uploads = [];

  // Simulate Storage without uploading to real Supabase.
  database.storage = {
    from(bucketName) {
      assert.equal(bucketName, 'species-media');

      return {
        async upload(filePath, buffer, options) {
          uploads.push({ filePath, buffer, options });
          return { error: null };
        },
      };
    },
  };

  // Generate a real, valid JPEG in memory.
  const image = await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 3,
      background: { r: 30, g: 140, b: 60 },
    },
  })
    .jpeg()
    .toBuffer();

  assert.ok(image.length < 5 * 1024 * 1024);

  const form = new FormData();
  form.append(
    'photo',
    new Blob([image], { type: 'image/jpeg' }),
    'valid-photo.jpg'
  );

  const response = await request(
    `/species/${ID}/photos`,
    'POST',
    form
  );

  assert.equal(response.status, 201);

  // Verify that exactly one processed image was uploaded.
  assert.equal(uploads.length, 1);

  const uploaded = uploads[0];
  assert.ok(uploaded.filePath.startsWith(`${ID}/`));
  assert.ok(uploaded.filePath.endsWith('.jpg'));
  assert.equal(uploaded.options.contentType, 'image/jpeg');
  assert.equal(uploaded.options.upsert, false);

  const metadata = await sharp(uploaded.buffer).metadata();
  assert.equal(metadata.format, 'jpeg');

  // Verify that the photo metadata was saved.
  assert.ok(
    calls.some(call =>
      call[0] === 'from' && call[1] === 'species_media'
    )
  );

  const insert = calls.find(call => call[0] === 'insert');
  assert.ok(insert);
  assert.equal(insert[1].species_id, ID);
  assert.equal(insert[1].uploaded_by, ID);
  assert.equal(insert[1].file_path, uploaded.filePath);
  assert.equal(insert[1].media_type, 'image/jpeg');
});

test('officer photo upload rejects additional text fields', async t => {
  const { request, calls } = await setup(t);
  const form = new FormData();

  form.append('caption', 'Unexpected field');

  const response = await request(
    `/species/${ID}/photos`,
    'POST',
    form
  );

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    message: 'Upload one photo using the photo field, without extra fields.',
  });
  assert.equal(calls.length, 0);
});

test('species photos reject unsupported MIME types before database or Storage access', async t => {
  const { request, calls } = await setup(t);
  for (const type of ['text/plain', 'image/svg+xml', 'image/gif', 'application/octet-stream']) {
    const form = new FormData();
    form.append('photo', new Blob(['not an allowed image'], { type }), 'photo.bin');
    const response = await request(`/species/${ID}/photos`, 'POST', form);
    assert.equal(response.status, 400);
    assert.match(response.body.message, /JPEG, PNG or WebP/);
  }
  assert.equal(calls.length, 0);
});

test('species photos reject spoofed types, mismatched formats and corrupt WebP without uploading', async t => {
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#228844' } }).png().toBuffer();
  const { request, calls, database } = await setup(t, { data: { id: ID, verification_status: 'approved' }, error: null });
  database.storage = { from() { assert.fail('Rejected photos must never access Storage'); } };
  for (const [type, buffer] of [
    ['image/jpeg', Buffer.from('not an image')],
    ['image/png', Buffer.from('not an image')],
    ['image/webp', Buffer.from('RIFF0000WEBPinvalid')],
    ['image/jpeg', png],
  ]) {
    const form = new FormData();
    form.append('photo', new Blob([buffer], { type }), 'photo.jpg');
    const response = await request(`/species/${ID}/photos`, 'POST', form);
    assert.equal(response.status, 400);
    assert.match(response.body.message, /Invalid photo|content must match/);
  }
  assert.equal(calls.some(call => call[0] === 'insert'), false);
});

for (const format of ['png', 'webp']) {
  test(`officer can upload a real ${format} photo and store processed JPEG`, async t => {
    const sharp = require('sharp');
    const { request, calls, database } = await setup(t, { data: { id: ID, verification_status: 'approved' }, error: null });
    const uploads = [];
    database.storage = { from(bucket) {
      assert.equal(bucket, 'species-media');
      return { async upload(filePath, buffer, options) {
        uploads.push({ filePath, buffer, options });
        return { error: null };
      } };
    } };
    const buffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#228844' } })
      .toFormat(format).toBuffer();
    const form = new FormData();
    form.append('photo', new Blob([buffer], { type: `image/${format}` }), `plant.${format}`);
    const response = await request(`/species/${ID}/photos`, 'POST', form);
    assert.equal(response.status, 201);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].options.contentType, 'image/jpeg');
    assert.equal(uploads[0].options.upsert, false);
    assert.equal((await sharp(uploads[0].buffer).metadata()).format, 'jpeg');
    assert.ok(calls.some(call => call[0] === 'insert'));
  });
}

// ---- Officer species list: every state, with family and photos ----

test('/species/manage can filter by review state and name, and returns family and photos', async t => {
  const { request, calls } = await setup(t, { data: [], error: null, count: 0 });
  const response = await request('/species/manage?status=archived&q=Nepenthes');
  assert.equal(response.status, 200);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'verification_status' && c[2] === 'archived'));
  assert.ok(calls.some(c => c[0] === 'or' && c[1].includes('scientific_name.ilike.%Nepenthes%')));
  const columns = calls.find(c => c[0] === 'select')[1];
  assert.match(columns, /taxonomy\(family, genus\)/);
  assert.match(columns, /species_media\(id, is_primary, source, licence_code, attribution, photographer, source_url\)/);
  assert.match(columns, /conservation_status/);
});

test('/species/manage without filters lists every state', async t => {
  const { request, calls } = await setup(t, { data: [], error: null, count: 0 });
  assert.equal((await request('/species/manage')).status, 200);
  assert.ok(!calls.some(c => c[0] === 'eq' && c[1] === 'verification_status'));
});

test('/species/manage rejects unknown states and unsafe searches before database access', async t => {
  const { request, calls } = await setup(t);
  for (const params of ['status=deleted', 'status=approved&status=pending', 'q=a,b', 'q=%25']) {
    assert.equal((await request(`/species/manage?${params}`)).status, 400, params);
  }
  assert.equal(calls.length, 0);
});

test('/species/manage is for officers only', async t => {
  const { request, calls } = await setup(t, undefined, 'botanist');
  assert.equal((await request('/species/manage')).status, 403);
  assert.equal(calls.length, 0);
});
