'use strict';

// Public photos for plants a botanist didn't register, tag normalising, the tag report
// script, and the "This plant" / "About this species" split.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-key';
const { mockAuth, callRoute } = require('./helpers/routeTestKit');
const { normalizePlantTag } = require('../src/services/qrService');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

let db;
mockAuth(() => ({ userId: ME, role: 'botanist', db }));
const plantRouter = require('../src/routes/plants');

// Plants: public = on the public QR page (public_plant_by_qr_v2); copies = files in the
// public-plant-photos bucket.
function fakeDb({ plants = [], single = null, publicTags = [], copies = [] }) {
  const calls = [];
  return {
    calls,
    from(table) {
      const chain = {};
      for (const m of ['select', 'eq', 'order', 'range', 'is', 'in']) {
        chain[m] = (...args) => { calls.push([table, m, ...args]); return chain; };
      }
      chain.maybeSingle = async () => ({ data: single, error: null });
      chain.then = (resolve, reject) => Promise.resolve({ data: plants, error: null, count: plants.length }).then(resolve, reject);
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
        };
      },
    },
  };
}

const plant = (id, tag, status, by) => ({ id, qr_code_value: tag, plant_status: status, registered_by: by, species_id: null, registered_at: '2026-11-20T00:00:00Z' });

test('plant list: photo_url only for others\' public plants with a copy; own plants and private ones get null', async () => {
  db = fakeDb({
    plants: [
      plant('p1', 'NIAH-PLT-00001', 'approved', OTHER),   // public, copy -> photo
      plant('p2', 'NIAH-PLT-00002', 'approved', ME),      // mine -> own photos
      plant('p3', 'NIAH-PLT-00003', 'approved', OTHER),   // copy but no longer public
      plant('p4', 'NIAH-PLT-00004', 'pending', OTHER),    // not approved
      plant('p5', 'plant:abc', 'approved', OTHER),        // no physical tag
      plant('p6', 'NIAH-PLT-00006', 'approved', OTHER),   // public, no copy
    ],
    publicTags: ['NIAH-PLT-00001', 'NIAH-PLT-00002', 'NIAH-PLT-00006'],
    copies: ['NIAH-PLT-00001.jpg', 'NIAH-PLT-00002.jpg', 'NIAH-PLT-00003.jpg', 'NIAH-PLT-00004.jpg'],
  });
  const result = await callRoute('/api/plants', plantRouter, { path: '/?page=1' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const byId = Object.fromEntries(result.body.data.map((row) => [row.id, row.photo_url]));
  // p4 (another botanist's plant that isn't approved) is not listed at all.
  assert.deepEqual(byId, { p1: '/p/NIAH-PLT-00001/photo', p2: null, p3: null, p5: null, p6: null });
  // Who registered a plant is used, not sent; no paths, no links to storage.
  assert.ok(result.body.data.every((row) => !('registered_by' in row)));
  assert.doesNotMatch(JSON.stringify(result.body), /storage|token=|\.jpg|signed/);
  // Coordinates of approved plants only inside "details" (staff), never as top-level fields.
  assert.ok(result.body.data.every((row) => !('latitude' in row) && !('location' in row)));
  // Only the plants with a copy were checked with the visitor page's rule.
  assert.deepEqual(db.calls.filter((c) => c[0] === 'rpc').map((c) => c[2].p_qr).sort(), ['NIAH-PLT-00001', 'NIAH-PLT-00003']);
});

test('tag lookup accepts lowercase and missing dashes, and adds photo_url for someone else\'s plant', async () => {
  db = fakeDb({
    single: { id: 'p1', qr_code_value: 'NIAH-PLT-00015', plant_status: 'approved', registered_by: OTHER, species: null },
    publicTags: ['NIAH-PLT-00015'],
    copies: ['NIAH-PLT-00015.jpg'],
  });
  const result = await callRoute('/api/plants', plantRouter, { path: '/tag/niahplt00015' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(db.calls.some((c) => c[0] === 'plants' && c[1] === 'eq' && c[2] === 'qr_code_value' && c[3] === 'NIAH-PLT-00015'));
  assert.equal(result.body.data.photo_url, '/p/NIAH-PLT-00015/photo');
  assert.equal(result.body.data.registered_by, undefined);

  db = fakeDb({ single: { id: 'p2', qr_code_value: 'NIAH-PLT-00016', plant_status: 'approved', registered_by: ME, species: null },
    publicTags: ['NIAH-PLT-00016'], copies: ['NIAH-PLT-00016.jpg'] });
  const own = await callRoute('/api/plants', plantRouter, { path: '/tag/NIAH-PLT-00016' });
  assert.equal(own.body.data.photo_url, null, 'own plants use their own photos');

  db = fakeDb({});
  assert.equal((await callRoute('/api/plants', plantRouter, { path: '/tag/plant%3Aabc' })).status, 400);
});

test('tag normalising: any case, missing or other separators, scanned URLs; nothing else', async () => {
  for (const typed of ['niahplt00015', 'NIAH-PLT-00015', ' niah plt 00015 ', 'niah_plt-00015', 'https://x/p/niah-plt-00015']) {
    assert.equal(normalizePlantTag(typed), 'NIAH-PLT-00015', typed);
  }
  for (const typed of ['plant:abc', 'NIAH-PLT-15', 'NIAHPLT000150', '', null]) assert.equal(normalizePlantTag(typed), null, String(typed));
  // The app uses the same rule.
  const app = await import(pathToFileURL(path.join(repoRoot, 'niah-biotrack/src/utils/tagCode.ts')).href);
  for (const typed of ['niahplt00015', 'NIAH PLT 00015', 'plant:abc', 'NIAHPLT000150']) {
    assert.equal(app.parseTagCode(typed), normalizePlantTag(typed), typed);
  }
});

test('tag report script: classifies odd tags and says why lookup fails; --apply is refused', async () => {
  const script = await import(pathToFileURL(path.join(repoRoot, 'scripts/plant-tags/assign-tags.mjs')).href);
  assert.equal(script.classifyTag('NIAH-PLT-00001').kind, 'ok');
  assert.equal(script.classifyTag('plant:7c8c0acc-eaa0-4fb6-8229-a28ab76481c5').kind, 'placeholder');
  assert.match(script.classifyTag('plant:x').why, /400 "Tag code must follow NIAH-PLT-00001 format"/);
  assert.equal(script.classifyTag('niah-plt-00007').kind, 'non-standard spelling');
  assert.equal(script.classifyTag('TAG-7').kind, 'other format');
  assert.equal(script.classifyTag(null).kind, 'no tag');
  const source = read('scripts/plant-tags/assign-tags.mjs');
  assert.match(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /if \(options\.apply\) \{\s*throw new Error\(\s*'--apply is not available/);
  assert.doesNotMatch(source, /dotenv|\.env['"]/);
});

test('app: public photos for others\' plants in the Plants tab, plant detail and Recent activity', () => {
  const records = read('niah-biotrack/app/(tabs)/records.tsx');
  assert.match(records, /photo: thumbnailSources\(\{ publicPath: plant\.photoUrl, baseUrl: BASE_URL \}\),/);
  assert.match(records, /publicPath: record\.otherBotanist \? record\.publicPhotoUrl : null,/);
  assert.match(records, /<PlantThumbnail\s+sources=\{item\.photo\}/);
  const detail = read('niah-biotrack/app/plant-detail.tsx');
  assert.match(detail, /publicPath: matched\.otherBotanist \? matched\.publicPhotoUrl : null,/);
  const activity = read('niah-biotrack/src/components/RecentActivity.tsx');
  assert.match(activity, /const publicPath = record\.otherBotanist \? record\.publicPhotoUrl : null;/);
  assert.match(read('niah-biotrack/src/services/tagLookup.ts'), /publicPhotoUrl: !data\.registered_by && typeof data\.photo_url === 'string' \? data\.photo_url : null,/);
  assert.match(read('niah-biotrack/src/services/approvedPlants.ts'), /photoUrl: typeof row\.photo_url === 'string' \? row\.photo_url : null,/);
});

test('"This plant" and "About this species": plant detail, app visitor page and web visitor page', () => {
  // The app's plant detail (redesigned): Measurements, Location, Field notes, Observations, in
  // that order, and no species card (the species page has the species facts).
  const detail = read('niah-biotrack/app/plant-detail.tsx');
  const order = ['>MEASUREMENTS<', '>LOCATION<', '>FIELD NOTES<', '>OBSERVATIONS<'].map((heading) => detail.indexOf(heading));
  assert.ok(order.every((index) => index > 0), 'every section heading is there');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections in order');
  for (const label of ['Location note', 'Coordinates', 'Height (m)', 'Diameter (cm)', 'Health', 'Life stage']) {
    assert.ok(detail.includes(`label="${label}"`), label);
  }
  assert.doesNotMatch(detail, /ABOUT THIS SPECIES|ABOUT THE SPECIES/);
  const visitor = read('niah-biotrack/app/plant-info.tsx');
  assert.ok(visitor.indexOf('>This plant<') > 0 && visitor.indexOf('>This plant<') < visitor.indexOf('>About this species<'));
  const web = read('backend/src/routes/publicPlants.js');
  assert.ok(web.indexOf('<h2>This plant</h2>') > 0 && web.indexOf('<h2>This plant</h2>') < web.indexOf('<h2>About this species</h2>'));
  assert.match(web, /\['Description', plant\.description\]/);
});
