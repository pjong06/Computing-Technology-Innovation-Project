'use strict';

// Species are shown with a photo of one of their plants, not species reference photos;
// the officer species editor is in sections with "Photos from its plants" and Distribution.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { createKnowledgeRouter } = require('../src/routes/knowledge');
const { requireRole } = require('../src/middleware/auth');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';

// A fake Supabase client: every query on a table answers tables[table] (a value or a function
// of the recorded filters); every call is recorded.
function fakeDb(tables, { signError } = {}) {
  const calls = [];
  const signed = [];
  return {
    calls,
    signed,
    from(table) {
      const filters = [];
      const chain = {};
      for (const method of ['select', 'eq', 'in', 'is', 'or', 'order', 'range', 'limit', 'insert', 'update']) {
        chain[method] = (...args) => { calls.push([table, method, ...args]); filters.push([method, ...args]); return chain; };
      }
      const answer = () => {
        const value = tables[table];
        return Promise.resolve(typeof value === 'function' ? value(filters) : value ?? { data: [], error: null });
      };
      chain.maybeSingle = answer;
      chain.single = answer;
      chain.then = (resolve, reject) => answer().then(resolve, reject);
      return chain;
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths, ttl) {
            signed.push([bucket, paths, ttl]);
            if (signError) return { data: null, error: signError };
            return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}` })), error: null };
          },
        };
      },
    },
  };
}

// Plants newest first (as the query orders them) and their primary photos.
const PLANTS = [
  { id: 'p-new-nophoto', qr_code_value: 'NIAH-PLT-00030', species_id: S1 },
  { id: 'p-new', qr_code_value: 'NIAH-PLT-00020', species_id: S1 },
  { id: 'p-old', qr_code_value: 'NIAH-PLT-00010', species_id: S1 },
  { id: 'p-s2', qr_code_value: null, species_id: S2 },
];
const MEDIA = [
  { id: 'm-new', plant_id: 'p-new', file_path: 'user/p-new/a.jpg' },
  { id: 'm-old', plant_id: 'p-old', file_path: 'user/p-old/b.jpg' },
  { id: 'm-s2', plant_id: 'p-s2', file_path: 'user/p-s2/c.jpg' },
];

async function start(t, { publicDb, userDb, role = null }) {
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge', createKnowledgeRouter({
    supabase: publicDb,
    requireAuth(req, res, next) {
      if (!req.get('authorization')) return res.status(401).json({ message: 'Bearer token required' });
      if (!role) return res.status(403).json({ message: 'Active staff profile required' });
      req.user = { id: S1 };
      req.profile = { role };
      req.supabase = userDb;
      next();
    },
    requireRole,
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return async (urlPath, { token, method = 'GET', body } = {}) => {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/knowledge${urlPath}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
}

const speciesPage = { data: [{ id: S1, scientific_name: 'Nepenthes a', species_media: [] }, { id: S2, scientific_name: 'Nepenthes b', species_media: [] }], error: null, count: 2 };

test('without a staff login the catalogue has no plant photos and reads no plant data', async (t) => {
  const publicDb = fakeDb({ species: speciesPage, plants: { data: PLANTS, error: null } });
  const request = await start(t, { publicDb, userDb: null });
  const result = await request('/species');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map((s) => s.plant_photo), [null, null]);
  assert.ok(!publicDb.calls.some(([table]) => table === 'plants' || table === 'plant_media'));
  assert.deepEqual(publicDb.signed, []);
});

test('a refused login (e.g. a visitor account) is served as a public request, not refused', async (t) => {
  const publicDb = fakeDb({ species: speciesPage });
  const request = await start(t, { publicDb, userDb: null, role: null });
  const result = await request('/species', { token: 'visitor-token' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map((s) => s.plant_photo), [null, null]);
});

test('staff get one batched, signed plant photo per species: the newest approved plant with a photo', async (t) => {
  const publicDb = fakeDb({ species: speciesPage });
  const userDb = fakeDb({ plants: { data: PLANTS, error: null }, plant_media: { data: MEDIA, error: null } });
  const request = await start(t, { publicDb, userDb, role: 'botanist' });
  const result = await request('/species', { token: 'staff-token' });
  assert.equal(result.status, 200);
  const [first, second] = result.body.data;
  assert.deepEqual(first.plant_photo, {
    id: 'm-new', plant_id: 'p-new', tag: 'NIAH-PLT-00020',
    url: 'https://signed.example/user/p-new/a.jpg', expires_in: 600,
  });
  assert.equal(second.plant_photo.tag, null);
  // One query for the page's plants (approved, active, newest first), one for their primary
  // photos and one signing request: no per-species requests.
  const plantCalls = userDb.calls.filter(([table]) => table === 'plants');
  assert.ok(plantCalls.some(([, m, col, ids]) => m === 'in' && col === 'species_id' && ids.length === 2));
  assert.ok(plantCalls.some(([, m, col, v]) => m === 'eq' && col === 'plant_status' && v === 'approved'));
  assert.ok(plantCalls.some(([, m, col, v]) => m === 'is' && col === 'deleted_at' && v === null));
  assert.ok(plantCalls.some(([, m, col, o]) => m === 'order' && col === 'registered_at' && o.ascending === false));
  assert.ok(userDb.calls.some(([table, m, col, v]) => table === 'plant_media' && m === 'eq' && col === 'is_primary' && v === true));
  assert.equal(userDb.signed.length, 1);
  assert.equal(userDb.signed[0][0], 'plant-media');
  // Signed links only: never a storage path.
  assert.doesNotMatch(JSON.stringify(result.body), /file_path/);
});

test('a photo failure leaves the placeholder instead of failing the catalogue', async (t) => {
  const publicDb = fakeDb({ species: speciesPage });
  const userDb = fakeDb({ plants: { data: PLANTS, error: null }, plant_media: { data: MEDIA, error: null } },
    { signError: { message: 'storage down' } });
  const request = await start(t, { publicDb, userDb, role: 'officer' });
  const result = await request('/species', { token: 'staff-token' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map((s) => s.plant_photo), [null, null]);
});

test('the officer list and the species detail carry plant_photo too', async (t) => {
  const species = { data: [{ id: S1, scientific_name: 'Nepenthes a', species_media: [] }], error: null, count: 1 };
  const userDb = fakeDb({ species, plants: { data: PLANTS, error: null }, plant_media: { data: MEDIA, error: null } });
  const publicDb = fakeDb({ species: { data: { id: S1, scientific_name: 'Nepenthes a', species_media: [] }, error: null } });
  const request = await start(t, { publicDb, userDb, role: 'officer' });
  assert.equal((await request('/species/manage', { token: 'staff' })).body.data[0].plant_photo.id, 'm-new');
  assert.equal((await request(`/species/${S1}`, { token: 'staff' })).body.data.plant_photo.id, 'm-new');
  assert.equal((await request(`/species/${S1}`)).body.data.plant_photo, null);
});

test('the editor gets "Photos from its plants": newest first, at most 12, with the total', async (t) => {
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, qr_code_value: `NIAH-PLT-${String(100 - i).padStart(5, '0')}`, species_id: S1 }));
  const media = many.map((plant) => ({ id: `m-${plant.id}`, plant_id: plant.id, file_path: `u/${plant.id}.jpg` }));
  const userDb = fakeDb({
    species: { data: { id: S1, scientific_name: 'Nepenthes a', species_media: [], taxon_rank: 'genus' }, error: null },
    plants: { data: many, error: null },
    plant_media: { data: media, error: null },
  });
  const request = await start(t, { publicDb: fakeDb({}), userDb, role: 'officer' });
  const result = await request(`/species/${S1}/manage`, { token: 'staff' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.taxon_rank, 'genus');
  assert.equal(result.body.data.plant_photos.total, 15);
  assert.equal(result.body.data.plant_photos.items.length, 12);
  assert.equal(result.body.data.plant_photos.items[0].tag, 'NIAH-PLT-00100');
  assert.doesNotMatch(JSON.stringify(result.body), /file_path/);
});

test('"Identified to" is checked, saved, and skipped (not failed) before the migration', async (t) => {
  // Before the migration: any query naming taxon_rank fails like PostgREST does.
  const missing = { data: null, error: { code: 'PGRST204', message: "Could not find the 'taxon_rank' column of 'species'" } };
  const species = (filters) => {
    const names = JSON.stringify(filters);
    return /taxon_rank/.test(names) ? missing : { data: { id: S1, scientific_name: 'Shorea a' }, error: null };
  };
  const userDb = fakeDb({ species });
  const request = await start(t, { publicDb: fakeDb({}), userDb, role: 'officer' });

  assert.equal((await request('/species', { token: 's', method: 'POST', body: { scientific_name: 'Shorea a', taxon_rank: 'kingdom' } })).status, 400);
  const created = await request('/species', { token: 's', method: 'POST', body: { scientific_name: 'Shorea a', taxon_rank: 'genus' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.taxon_rank_saved, false);
  const updated = await request(`/species/${S1}`, { token: 's', method: 'PATCH', body: { common_name: 'X', taxon_rank: 'family' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.taxon_rank_saved, false);
  const onlyRank = await request(`/species/${S1}`, { token: 's', method: 'PATCH', body: { taxon_rank: 'family' } });
  assert.equal(onlyRank.status, 400);
  assert.match(onlyRank.body.message, /migration/);

  // After the migration the rank is written.
  const db2 = fakeDb({ species: { data: { id: S1, scientific_name: 'Shorea a', taxon_rank: 'genus' }, error: null } });
  const request2 = await start(t, { publicDb: fakeDb({}), userDb: db2, role: 'officer' });
  const saved = await request2(`/species/${S1}`, { token: 's', method: 'PATCH', body: { taxon_rank: 'genus' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.taxon_rank_saved, undefined);
  assert.ok(db2.calls.some(([table, m, row]) => table === 'species' && m === 'update' && row.taxon_rank === 'genus'));
});

test('the taxon_rank migration adds the column with its check and default, nothing else', () => {
  const sql = read('supabase/migrations/20261121140000_species_taxon_rank.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS taxon_rank text NOT NULL DEFAULT 'species'/);
  assert.match(sql, /CHECK \(taxon_rank IN \('species', 'genus', 'family', 'other'\)\)/);
  assert.doesNotMatch(sql, /POLICY|GRANT|DROP|DELETE|species_media/i);
});

test('the editor is in sections, with no species photo upload and a separate Archive', () => {
  const html = read('frontend/editor.html');
  const js = read('frontend/js/editor.js');
  const order = ['Identity', 'Classification and protection', 'About this species', 'Photos from its plants', 'Distribution']
    .map((title) => html.indexOf(`<h2>${title}</h2>`));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), 'sections in order');
  assert.match(html, /<span class="label-text">Scientific name <span class="required"[^>]*>\*<\/span><\/span><input id="f-sci"/);
  assert.match(html, /<select id="f-rank">\s*<option value="species">Species<\/option>\s*<option value="genus">Genus<\/option>\s*<option value="family">Family<\/option>\s*<option value="other">Other<\/option>/);
  assert.match(html, /<select id="f-fam">/);
  assert.match(html, /Vulnerable, Endangered or Critically Endangered hides plant locations on public QR pages\./);
  // No photo upload and no species photo (or its credit) on the editor.
  assert.doesNotMatch(html + js, /type="file"|previewPhoto|uploadPhoto|\/photos'|photo-preview|makePhotoCreditInfo|speciesPhoto\(/);
  // Archive: separate, danger style, confirmed, the existing archive endpoint.
  assert.match(html, /<span class="spacer"><\/span>\s*<button class="btn red" id="archive-button" hidden/);
  assert.match(js, /const sure = confirm\('Archive '/);
  assert.match(js, /api\('\/knowledge\/species\/' \+ editingId, \{ method: 'DELETE' \}\)/);
  // Distribution: officer endpoints, and "View all N plants" filtered by species.
  assert.match(js, /api\('\/officer\/map\/plants'\)/);
  assert.match(js, /link\.href = 'plants\.html\?species=' \+ encodeURIComponent\(editingId\);/);
  assert.match(js, /'View all ' \+ total \+ ' plant'/);
  // Botanists propose: no rank, status, photos or distribution.
  assert.match(js, /document\.getElementById\('rank-label'\)\.hidden = true;/);
  assert.match(js, /if \(isBotanistUser\) \{\s*editingId = '';\s*\}/);
  // Every id the script reads exists on the page.
  for (const id of new Set(Array.from(js.matchAll(/getElementById\('([^']+)'\)/g), (m) => m[1]))) {
    assert.match(html, new RegExp(`id="${id}"`), `editor.html has #${id}`);
  }
});

test('catalogue cards show a plant photo with "From plant <tag>", else the placeholder', () => {
  const js = read('frontend/js/species.js');
  assert.match(js, /img\.src = plantPhoto \? plantPhoto\.url : PICTURE_BLANK;/);
  assert.match(js, /caption\.textContent = 'From plant ' \+ displayTag\(plantPhoto\.tag/);
  assert.doesNotMatch(js, /speciesPhoto\(|species_media/);
  const app = read('niah-biotrack/src/store/useSpeciesStore.ts');
  assert.match(app, /list\.map\(\(item\) => \[item\.id, item\.plant_photo \?\? null\]\)/);
  assert.doesNotMatch(app, /cachePrimarySpeciesImage|imageUrisBySpeciesId/);
  for (const screen of ['app/(tabs)/home.tsx', 'app/(tabs)/plants.tsx', 'app/species-reference/[id].tsx', 'app/plant-info.tsx']) {
    assert.match(read(`niah-biotrack/${screen}`), /plantPhotoCaption\(/, screen);
  }
  // Plant pages: no species photo fallback.
  // (It reads the species store only for "About this species" text, never a species photo.)
  assert.doesNotMatch(read('niah-biotrack/app/plant-detail.tsx'), /plantPhotosBySpeciesId|imageUrisBySpeciesId|species_media|Species photo/);
  assert.doesNotMatch(read('niah-biotrack/app/(tabs)/records.tsx'), /plantPhotosBySpeciesId|imageUrisBySpeciesId/);
});
