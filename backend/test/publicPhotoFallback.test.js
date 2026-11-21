'use strict';

// The public copy of a plant's photo (visitors, other botanists) falls back to the main photo
// of the plant's first APPROVED observation when the plant has no plant_media photo: field
// plants registered in the app often have their photo only on their first record. The same
// rule is used by the refresh (and so by the officer approval hook) and the list thumbnails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { publicPhotoSource, refreshPublicPlantPhoto } = require('../src/services/publicPlantPhotos');
const { ownPlantThumbnails } = require('../src/services/plantThumbnails');
const { photoWithMetadata, metadataOf, hasMetadataBytes } = require('./helpers/testImages');

const TAG = 'NIAH-PLT-00077';

// A small in-memory database: eq / is / in filters, order and limit, like PostgREST.
function fakeDb(tables, { visible = true, original } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      const orders = [];
      let limit = Infinity;
      const chain = {
        select() { return chain; },
        eq(column, value) { filters.push((row) => row[column] === value); return chain; },
        is(column, value) { filters.push((row) => (row[column] ?? null) === value); return chain; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return chain; },
        order(column, { ascending = true } = {}) { orders.push([column, ascending]); return chain; },
        limit(count) { limit = count; return chain; },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
      };
      function run() {
        calls.push(['read', table]);
        const rows = (tables[table] || []).filter((row) => filters.every((f) => f(row)));
        rows.sort((a, b) => {
          for (const [column, ascending] of orders) {
            const x = a[column] === true ? 1 : a[column] === false ? 0 : a[column];
            const y = b[column] === true ? 1 : b[column] === false ? 0 : b[column];
            if (x < y) return ascending ? -1 : 1;
            if (x > y) return ascending ? 1 : -1;
          }
          return 0;
        });
        return rows.slice(0, limit);
      }
      return chain;
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      return { data: visible ? [{ qr_code_value: args.p_qr }] : [], error: null };
    },
    storage: {
      from(bucket) {
        return {
          async download(file) { calls.push(['download', bucket, file]); return { data: new Blob([original]), error: null }; },
          async upload(file, bytes, options) { calls.push(['upload', bucket, file, bytes, options]); return { error: null }; },
          async remove(files) { calls.push(['remove', bucket, files]); return { error: null }; },
          async createSignedUrls(paths) {
            calls.push(['sign', bucket, paths]);
            return { data: paths.map((p) => ({ path: p, signedUrl: `https://example.supabase.co/sign/${bucket}/${p}` })), error: null };
          },
        };
      },
    },
  };
}

const visits = [
  // Earlier but only waiting for review: its photo must never become public.
  { id: 'o0', plant_id: 'p1', observed_at: '2026-10-01T00:00:00Z', review_status: 'pending', deleted_at: null },
  { id: 'o1', plant_id: 'p1', observed_at: '2026-10-05T00:00:00Z', review_status: 'approved', deleted_at: null },
  { id: 'o2', plant_id: 'p1', observed_at: '2026-10-09T00:00:00Z', review_status: 'approved', deleted_at: null },
];
const visitMedia = [
  { id: 'v0', observation_id: 'o0', file_path: 'u/o0/pending.jpg', is_primary: true },
  { id: 'v1', observation_id: 'o1', file_path: 'u/o1/side.jpg', is_primary: false },
  { id: 'v2', observation_id: 'o1', file_path: 'u/o1/main.jpg', is_primary: true },
  { id: 'v3', observation_id: 'o2', file_path: 'u/o2/later.jpg', is_primary: true },
];

test('source: the plant\'s own main photo when it has one', async () => {
  const db = fakeDb({
    plant_media: [{ id: 'm1', plant_id: 'p1', file_path: 'u/p1/main.jpg', is_primary: true, deleted_at: null }],
    observations: visits,
    observation_media: visitMedia,
  });
  assert.deepEqual(await publicPhotoSource(db, 'p1'), { bucket: 'plant-media', filePath: 'u/p1/main.jpg' });
  assert.ok(!db.calls.some((c) => c[1] === 'observations'), 'observations are not read when not needed');
});

test('source: no plant photo -> the main photo of the FIRST APPROVED observation (never a pending one)', async () => {
  const db = fakeDb({ plant_media: [], observations: visits, observation_media: visitMedia });
  assert.deepEqual(await publicPhotoSource(db, 'p1'), { bucket: 'observation-media', filePath: 'u/o1/main.jpg' });

  // A deleted plant photo doesn't count; an approved observation without a photo: none.
  const deletedPhoto = fakeDb({
    plant_media: [{ id: 'm1', plant_id: 'p1', file_path: 'u/p1/gone.jpg', is_primary: true, deleted_at: '2026-11-01T00:00:00Z' }],
    observations: [visits[1]],
    observation_media: [],
  });
  assert.equal(await publicPhotoSource(deletedPhoto, 'p1'), null);
  // Only pending observations: nothing public.
  assert.equal(await publicPhotoSource(fakeDb({ plant_media: [], observations: [visits[0]], observation_media: visitMedia }), 'p1'), null);
  // A deleted approved observation is skipped.
  const deletedVisit = fakeDb({
    plant_media: [],
    observations: [{ ...visits[1], deleted_at: '2026-11-01T00:00:00Z' }, visits[2]],
    observation_media: visitMedia,
  });
  assert.deepEqual(await publicPhotoSource(deletedVisit, 'p1'), { bucket: 'observation-media', filePath: 'u/o2/later.jpg' });
});

test('refresh (and the officer approval hook): the observation photo is published, stripped and resized', async () => {
  const original = await photoWithMetadata({ width: 1600, height: 900 });
  const db = fakeDb({
    plants: [{ id: 'p1', qr_code_value: TAG }],
    plant_media: [],
    observations: visits,
    observation_media: visitMedia,
  }, { original });
  assert.equal(await refreshPublicPlantPhoto(db, 'p1'), 'published');
  assert.deepEqual(db.calls.find((c) => c[0] === 'download').slice(0, 3), ['download', 'observation-media', 'u/o1/main.jpg']);
  const [, bucket, file, bytes] = db.calls.find((c) => c[0] === 'upload');
  assert.equal(bucket, 'public-plant-photos');
  assert.equal(file, `${TAG}.jpg`);
  const meta = await metadataOf(bytes);
  assert.equal(meta.width, 1200);
  assert.equal(meta.exif, undefined);
  assert.equal(hasMetadataBytes(bytes), false);

  // No photo anywhere: the copy is removed, nothing downloaded.
  const none = fakeDb({ plants: [{ id: 'p1', qr_code_value: TAG }], plant_media: [], observations: [visits[0]], observation_media: visitMedia }, { original });
  assert.equal(await refreshPublicPlantPhoto(none, 'p1'), 'removed');
  assert.ok(!none.calls.some((c) => c[0] === 'download'));

  // The approval hook and the officer's bulk refresh both go through refreshPublicPlantPhoto.
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.equal((read('src/routes/officerReviews.js').match(/await refreshPublicPlantPhoto\(req\.supabase, observation\.plant_id\);/g) || []).length, 2);
  assert.match(read('src/routes/officerPlants.js'), /await refreshPublicPlantPhoto\(req\.supabase, plant\.id\)/);
  assert.match(read('src/services/publicPlantPhotos.js'), /const source = await publicPhotoSource\(supabase, plantId\);/);
});

test('list thumbnails: own plant without a plant photo -> first approved observation, else its first observation', async () => {
  const db = fakeDb({
    plant_media: [],
    observations: [
      ...visits,
      // p2 has only an observation waiting for review: the owner still sees its photo.
      { id: 'q1', plant_id: 'p2', observed_at: '2026-10-01T00:00:00Z', review_status: 'pending', deleted_at: null },
    ],
    observation_media: [...visitMedia, { id: 'w1', observation_id: 'q1', file_path: 'u/q1/own.jpg', is_primary: true }],
  });
  const thumbs = await ownPlantThumbnails(db, [{ id: 'p1' }, { id: 'p2' }]);
  assert.equal(thumbs.get('p1').key, 'observation-media-v2');
  assert.match(thumbs.get('p1').url, /observation-media\/u\/o1\/main\.jpg$/);
  assert.equal(thumbs.get('p2').key, 'observation-media-w1');
});
