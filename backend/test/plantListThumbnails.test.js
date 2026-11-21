'use strict';

// GET /api/plants carries a thumbnail for every row, batched for the page: own plants get a
// short-lived signed link to their main photo (or first observation's photo), others' public
// plants the public copy. The public copy has a small size for lists (?size=thumb).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const sharp = require('sharp');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');
const { ownPlantThumbnails } = require('../src/services/plantThumbnails');
const { createPublicPlantsRouter } = require('../src/routes/publicPlants');
const { photoWithMetadata } = require('./helpers/testImages');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

let db;
mockAuth(() => ({ userId: ME, role: 'botanist', db }));
const plantRouter = require('../src/routes/plants');

// A database with plants, plant photos, observations and their photos. Records each call.
function fakeDb({ plants = [], plantMedia = [], observations = [], observationMedia = [], publicTags = [], copies = [] } = {}) {
  const calls = [];
  const tables = { plants, plant_media: plantMedia, observations, observation_media: observationMedia };
  return {
    calls,
    from(table) {
      const filters = [];
      const chain = {};
      chain.select = (columns) => { calls.push([table, 'select', columns]); return chain; };
      for (const m of ['order', 'range', 'eq']) chain[m] = (...args) => { calls.push([table, m, ...args]); return chain; };
      chain.in = (column, values) => { calls.push([table, 'in', column, values]); filters.push((row) => values.includes(row[column])); return chain; };
      chain.is = (column, value) => { calls.push([table, 'is', column, value]); filters.push((row) => (row[column] ?? null) === value); return chain; };
      chain.then = (resolve, reject) => {
        const rows = (tables[table] || []).filter((row) => filters.every((f) => f(row)));
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
      };
      return chain;
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      return { data: publicTags.includes(args.p_qr) ? [{ qr_code_value: args.p_qr }] : [], error: null };
    },
    storage: {
      from(bucket) {
        return {
          async list() { calls.push(['list', bucket]); return { data: copies.map((name) => ({ name })), error: null }; },
          async createSignedUrls(paths, ttl) {
            calls.push(['sign', bucket, paths, ttl]);
            return { data: paths.map((p) => ({ path: p, signedUrl: `https://example.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=t` })), error: null };
          },
        };
      },
    },
  };
}

const plant = (id, by, extra = {}) => ({ id, qr_code_value: `NIAH-PLT-000${id.slice(-2)}`, plant_status: 'approved', registered_by: by, species_id: null, registered_at: '2026-11-20T00:00:00Z', deleted_at: null, ...extra });

test('own plants get a signed thumbnail in the list itself; others\' public plants get the public copy', async () => {
  db = fakeDb({
    plants: [
      plant('p01', ME), // main photo
      plant('p02', ME), // no plant photo: its first observation's photo
      plant('p03', ME), // no photo at all
      plant('p04', OTHER), // public, with a copy
      plant('p05', OTHER), // not public
    ],
    plantMedia: [
      { id: 'm1', plant_id: 'p01', file_path: 'u/p01/other.jpg', is_primary: false, deleted_at: null },
      { id: 'm2', plant_id: 'p01', file_path: 'u/p01/main.jpg', is_primary: true, deleted_at: null },
      { id: 'm3', plant_id: 'p03', file_path: 'u/p03/gone.jpg', is_primary: true, deleted_at: '2026-11-20T00:00:00Z' },
      { id: 'm9', plant_id: 'p05', file_path: 'u/p05/secret.jpg', is_primary: true, deleted_at: null },
    ],
    observations: [
      { id: 'o2', plant_id: 'p02', observed_at: '2026-11-02T00:00:00Z', deleted_at: null },
      { id: 'o1', plant_id: 'p02', observed_at: '2026-11-01T00:00:00Z', deleted_at: null },
    ],
    observationMedia: [
      { id: 'om2', observation_id: 'o2', file_path: 'u/o2/later.jpg', is_primary: true },
      { id: 'om1', observation_id: 'o1', file_path: 'u/o1/first.jpg', is_primary: false },
    ],
    publicTags: ['NIAH-PLT-00004'],
    copies: ['NIAH-PLT-00004.jpg'],
  });
  const result = await callRoute('/api/plants', plantRouter, { path: '/?page=1' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const byId = Object.fromEntries(result.body.data.map((row) => [row.id, row]));

  assert.match(byId.p01.thumbnail_url, /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/sign\/plant-media\/u\/p01\/main\.jpg\?token=t$/);
  assert.equal(byId.p01.thumbnail_key, 'plant-media-m2');
  assert.ok(Date.parse(byId.p01.thumbnail_expires_at) > Date.now());
  assert.match(byId.p02.thumbnail_url, /observation-media\/u\/o1\/first\.jpg/);
  assert.equal(byId.p02.thumbnail_key, 'observation-media-om1');
  assert.equal(byId.p03.thumbnail_url, null, 'deleted photos are not used');
  for (const own of ['p01', 'p02', 'p03']) assert.equal(byId[own].photo_url, null);
  // Others: the public copy only, never a signed link to their photo.
  assert.equal(byId.p04.photo_url, '/p/NIAH-PLT-00004/photo');
  for (const other of ['p04', 'p05']) {
    assert.equal(byId[other].thumbnail_url, null);
    assert.equal(byId[other].thumbnail_key, null);
  }
  assert.doesNotMatch(JSON.stringify(result.body), /secret\.jpg|"file_path"|registered_by/);
  // Coordinates only inside "details" (approved plants, staff), never as top-level fields.
  for (const row of result.body.data) assert.ok(!('latitude' in row) && !('longitude' in row) && !('location' in row), row.id);

  // Batched: one query per table and one signing call per bucket for the whole page; the
  // others' photos are never read.
  const mediaQueries = db.calls.filter((c) => c[0] === 'plant_media' && c[1] === 'select');
  assert.equal(mediaQueries.length, 1);
  const mediaIn = db.calls.find((c) => c[0] === 'plant_media' && c[1] === 'in');
  assert.deepEqual(mediaIn[3].sort(), ['p01', 'p02', 'p03']);
  const signs = db.calls.filter((c) => c[0] === 'sign');
  assert.deepEqual(signs.map((c) => c[1]).sort(), ['observation-media', 'plant-media']);
  assert.deepEqual(signs.find((c) => c[1] === 'plant-media')[2], ['u/p01/main.jpg']);
  assert.equal(db.calls.filter((c) => c[0] === 'observation_media' && c[1] === 'select').length, 1);
});

test('the list leaves out deleted plants', async () => {
  db = fakeDb({ plants: [plant('p01', ME), plant('p02', ME, { deleted_at: '2026-11-20T00:00:00Z' })] });
  const result = await callRoute('/api/plants', plantRouter, { path: '/?page=1' });
  assert.deepEqual(result.body.data.map((row) => row.id), ['p01']);
  assert.ok(db.calls.some((c) => c[0] === 'plants' && c[1] === 'is' && c[2] === 'deleted_at' && c[3] === null));
});

test('thumbnail errors never break the list: rows just get no thumbnail', async () => {
  const broken = {
    from() { return { select() { return this; }, in() { return this; }, is() { return Promise.resolve({ data: null, error: { message: 'boom' } }); } }; },
    storage: { from() { return {}; } },
  };
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual([...(await ownPlantThumbnails(broken, [{ id: 'p01' }])).entries()], []);
  } finally {
    console.error = original;
  }
  assert.deepEqual([...(await ownPlantThumbnails(broken, [])).entries()], []);
});

test('public copy for lists: ?size=thumb is at most 300 px; anything else is the full 1200 px', async (t) => {
  const photo = await photoWithMetadata({ width: 1600, height: 1200 });
  const client = {
    async rpc(name, args) {
      if (name === 'public_plant_by_qr_v2') return { data: [{ plant_id: 'p1', qr_code_value: args.p_qr, scientific_name: 'X', conservation_status: 'EN' }], error: null };
      return { data: false, error: null };
    },
    from() { throw new Error('no table reads'); },
    storage: { from() { return { async download() { return { data: new Blob([photo]), error: null }; } }; } },
  };
  const app = express();
  app.use(createPublicPlantsRouter({ client }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}/p/NIAH-PLT-00042/photo`;
  const sizeOf = async (address) => {
    const response = await fetch(address);
    assert.equal(response.status, 200);
    return sharp(Buffer.from(await response.arrayBuffer())).metadata();
  };
  const thumb = await sizeOf(`${url}?size=thumb`);
  assert.equal(Math.max(thumb.width, thumb.height), 300);
  assert.equal(thumb.exif, undefined);
  assert.equal((await sizeOf(url)).width, 1200);
  assert.equal((await sizeOf(`${url}?size=huge`)).width, 1200);
});
