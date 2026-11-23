'use strict';

// Visitors see a plant's own main photo: a stripped public copy (public-plant-photos
// bucket), served by GET /p/:tag/photo only while the plant is on the public QR page.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { createPublicPlantsRouter, createPublicQrHandler } = require('../src/routes/publicPlants');
const { refreshPublicPlantPhoto } = require('../src/services/publicPlantPhotos');
const { photoWithMetadata, metadataOf, hasMetadataBytes } = require('./helpers/testImages');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const TAG = 'NIAH-PLT-00042';

// A public client: the QR function says which tags are public; the public bucket holds copies.
function publicClient({ publicTags = [TAG], pendingTags = [], copies = {}, rpcError = null } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (rpcError) return { data: null, error: rpcError };
      if (name === 'public_plant_by_qr_v2') {
        return { data: publicTags.includes(args.p_qr) ? [{ plant_id: 'p1', qr_code_value: args.p_qr, scientific_name: 'Nepenthes a', conservation_status: 'LC' }] : [], error: null };
      }
      if (name === 'public_plant_tag_is_pending') return { data: pendingTags.includes(args.p_qr), error: null };
      return { data: null, error: { code: 'PGRST202' } };
    },
    from(table) { calls.push(['from', table]); throw new Error(`no table reads expected (${table})`); },
    storage: {
      from(bucket) {
        calls.push(['bucket', bucket]);
        return {
          async download(file) {
            calls.push(['download', bucket, file]);
            if (bucket !== 'public-plant-photos' || !copies[file]) return { data: null, error: new Error('not found') };
            return { data: new Blob([copies[file]]), error: null };
          },
          async list(prefix, options) {
            calls.push(['list', bucket, options?.search]);
            const names = Object.keys(copies).filter((name) => name.startsWith(options?.search || ''));
            return { data: names.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };
}

async function start(t, router) {
  const app = express();
  app.set('trust proxy', false);
  app.use(router);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('a public plant photo is a fresh JPEG (max 1200 px) without EXIF, GPS, XMP or ICC, cached for a day', async (t) => {
  // Even if a copy in the bucket still had metadata, visitors get clean pixels.
  const stored = await photoWithMetadata({ width: 1600, height: 900 });
  assert.ok(hasMetadataBytes(stored), 'the test photo starts with metadata');
  const client = publicClient({ copies: { [`${TAG}.jpg`]: stored } });
  const url = await start(t, createPublicPlantsRouter({ client }));
  const response = await fetch(`${url}/p/${TAG}/photo`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
  const bytes = Buffer.from(await response.arrayBuffer());
  const meta = await metadataOf(bytes);
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 1200);
  assert.equal(meta.exif, undefined, 'no EXIF, so no GPS');
  assert.equal(meta.xmp, undefined);
  assert.equal(meta.icc, undefined);
  assert.equal(meta.iptc, undefined);
  assert.equal(hasMetadataBytes(bytes), false);
  // Only the public copy is read: never the private plant-media bucket or plant tables.
  assert.ok(client.calls.every(([kind, name]) => kind !== 'bucket' || name === 'public-plant-photos'));
  assert.ok(!client.calls.some(([kind]) => kind === 'from'));
});

test('pending, rejected, deleted or unknown plants, bad tags and missing copies get 404', async (t) => {
  const photo = await photoWithMetadata();
  const client = publicClient({
    publicTags: [TAG],
    pendingTags: ['NIAH-PLT-00043'],
    // Copies left behind for plants that are no longer public must not be served.
    copies: { [`${TAG}.jpg`]: photo, 'NIAH-PLT-00043.jpg': photo, 'NIAH-PLT-00044.jpg': photo },
  });
  const url = await start(t, createPublicPlantsRouter({ client }));
  for (const tag of ['NIAH-PLT-00043', 'NIAH-PLT-00044', 'NIAH-PLT-99999', 'not-a-tag', 'plant:abc']) {
    const response = await fetch(`${url}/p/${encodeURIComponent(tag)}/photo`);
    assert.equal(response.status, 404, tag);
    assert.notEqual(response.headers.get('content-type'), 'image/jpeg', tag);
  }
  // A public plant without a copy: 404 too.
  const noCopy = await start(t, createPublicPlantsRouter({ client: publicClient({ copies: {} }) }));
  assert.equal((await fetch(`${noCopy}/p/${TAG}/photo`)).status, 404);
});

test('the photo shares the visitor rate limit with the plant page', async (t) => {
  const client = publicClient({ copies: { [`${TAG}.jpg`]: await photoWithMetadata({ width: 40, height: 30 }) } });
  const url = await start(t, createPublicPlantsRouter({ client }));
  for (let i = 0; i < 30; i += 1) assert.equal((await fetch(`${url}/p/${TAG}`)).status, 200);
  for (let i = 0; i < 30; i += 1) assert.equal((await fetch(`${url}/p/${TAG}/photo`)).status, 200);
  const limited = await fetch(`${url}/p/${TAG}/photo`);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.equal((await fetch(`${url}/p/${TAG}`)).status, 429);
});

test('public responses carry the photo address, never a storage path or signed link', async (t) => {
  const client = publicClient({ copies: { [`${TAG}.jpg`]: await photoWithMetadata({ width: 40, height: 30 }) } });
  const router = createPublicPlantsRouter({ client });
  router.get('/api/public/plants/by-qr', createPublicQrHandler(client));
  const url = await start(t, router);

  const page = await (await fetch(`${url}/p/${TAG}`)).text();
  assert.match(page, new RegExp(`<img src="/p/${TAG}/photo"`));
  const api = await (await fetch(`${url}/api/public/plants/by-qr?code=${TAG}`)).json();
  assert.equal(api.data.photo_url, `/p/${TAG}/photo`);
  for (const text of [page, JSON.stringify(api)]) {
    assert.doesNotMatch(text, /public-plant-photos|plant-media|storage\/v1|token=|signedUrl|\.jpg|file_path/);
  }

  // No copy: no photo on the page and photo_url null.
  const bare = publicClient({ copies: {} });
  const router2 = createPublicPlantsRouter({ client: bare });
  router2.get('/api/public/plants/by-qr', createPublicQrHandler(bare));
  const url2 = await start(t, router2);
  assert.doesNotMatch(await (await fetch(`${url2}/p/${TAG}`)).text(), /<img src="\/p\//);
  assert.equal((await (await fetch(`${url2}/api/public/plants/by-qr?code=${TAG}`)).json()).data.photo_url, null);
});

// ---- Publishing the copy (as the officer) ----

function officerClient({ visible = true, primary = 'u/p1/a.jpg', original } = {}) {
  const calls = [];
  const chain = (result) => {
    const c = {};
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) c[m] = (...a) => { calls.push([m, ...a]); return c; };
    c.maybeSingle = async () => result;
    c.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
    return c;
  };
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      if (table === 'plants') return chain({ data: { id: 'p1', qr_code_value: TAG }, error: null });
      if (table === 'plant_media') return chain({ data: primary ? [{ id: 'm1', file_path: primary }] : [], error: null });
      // No approved observation photo either (publicPhotoSource's fallback).
      if (table === 'observations' || table === 'observation_media') return chain({ data: [], error: null });
      throw new Error(table);
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
        };
      },
    },
  };
}

test('an officer action publishes a stripped 1200 px copy named after the tag', async () => {
  const supabase = officerClient({ original: await photoWithMetadata({ width: 1600, height: 900 }) });
  assert.equal(await refreshPublicPlantPhoto(supabase, 'p1'), 'published');
  assert.deepEqual(supabase.calls.find(([k]) => k === 'download').slice(0, 3), ['download', 'plant-media', 'u/p1/a.jpg']);
  const [, bucket, file, bytes, options] = supabase.calls.find(([k]) => k === 'upload');
  assert.equal(bucket, 'public-plant-photos');
  assert.equal(file, `${TAG}.jpg`);
  assert.deepEqual(options, { contentType: 'image/jpeg', upsert: true });
  const meta = await metadataOf(bytes);
  assert.equal(meta.width, 1200);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  assert.equal(hasMetadataBytes(bytes), false);
});

test('a plant that is not public (or has no main photo) loses its copy; failures never throw', async () => {
  const hidden = officerClient({ visible: false });
  assert.equal(await refreshPublicPlantPhoto(hidden, 'p1'), 'removed');
  assert.deepEqual(hidden.calls.find(([k]) => k === 'remove'), ['remove', 'public-plant-photos', [`${TAG}.jpg`]]);
  assert.ok(!hidden.calls.some(([k]) => k === 'download'));

  const noPhoto = officerClient({ primary: null });
  assert.equal(await refreshPublicPlantPhoto(noPhoto, 'p1'), 'removed');

  const broken = officerClient({ original: Buffer.from('not an image') });
  assert.equal(await refreshPublicPlantPhoto(broken, 'p1'), 'skipped');
  assert.ok(!broken.calls.some(([k]) => k === 'upload'));
});

test('officer decisions, visibility changes and deletes keep the copy in step', () => {
  const reviews = read('backend/src/routes/officerReviews.js');
  assert.equal((reviews.match(/await refreshPublicPlantPhoto\(req\.supabase, observation\.plant_id\);/g) || []).length, 2);
  const plants = read('backend/src/routes/plants.js');
  assert.match(plants, /if \(req\.profile\.role === "officer"\) \{[\s\S]*?publicTag = tagRow\?\.qr_code_value/);
  assert.match(plants, /await removePublicPlantPhotoByTag\(req\.supabase, publicTag\)/);
  const officerPlants = read('backend/src/routes/officerPlants.js');
  assert.match(officerPlants, /router\.post\("\/public-photos\/refresh"/);
});

test('the migration opens only the public copies bucket; originals stay staff-only', () => {
  const sql = read('supabase/migrations/20261121150000_public_plant_photos.sql');
  assert.match(sql, /VALUES \('public-plant-photos', 'public-plant-photos', false, 5242880, ARRAY\['image\/jpeg'\]\)/);
  assert.match(sql, /FOR SELECT\s+TO anon, authenticated\s+USING \(bucket_id = 'public-plant-photos'\);/);
  assert.match(sql, /FOR ALL\s+TO authenticated\s+USING \(\s*bucket_id = 'public-plant-photos'\s+AND \(SELECT public\.current_app_role\(\)\) = 'officer'/);
  assert.match(sql, /name ~ '\^NIAH-PLT-\[0-9\]\{5\}\\\.jpg\$'/);
  // No statement touches the private bucket, plant_media, or the service role (comments aside).
  const statements = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(statements, /'plant-media'|plant_media|service_role/);
  // The species helper is a narrow definer function: same public rule, only ids and tags.
  assert.match(sql, /RETURNS TABLE \(species_id uuid, qr_code_value text\)/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  for (const rule of [/p\.plant_status = 'approved'/, /p\.deleted_at IS NULL/, /s\.verification_status = 'approved'/,
    /o\.review_status = 'approved'/, /o\.deleted_at IS NULL/]) assert.match(sql, rule);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.public_species_photo_tags\(uuid\[\]\) TO anon, authenticated;/);
  // The backend still has no service role key.
  assert.doesNotMatch(read('backend/src/config/supabase.js'), /SERVICE_ROLE/i);
});

test('staff screens keep their own photos; visitor screens use the public photo', () => {
  for (const screen of ['app/(tabs)/home.tsx', 'app/(tabs)/plants.tsx', 'app/plant-info.tsx']) {
    const code = read(`niah-biotrack/${screen}`);
    // Only the public copy: thumbnailSources with a publicPath and no signed thumbnail.
    assert.match(code, /thumbnailSources\(\{ publicPath: photo\?\.url, baseUrl: BASE_URL/, screen);
    assert.doesNotMatch(code, /signed:|ownThumbnails|usePlantListStore/, screen);
    assert.doesNotMatch(code, /plantPhotosBySpeciesId/, screen);
  }
  assert.match(read('niah-biotrack/app/species-reference/[id].tsx'), /plantPhotosBySpeciesId/);
});