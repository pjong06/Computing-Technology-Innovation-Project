// Tests for src/utils/thumbnailSources.ts and the list thumbnail wiring. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstStep, isExpired, onSourceFailed, thumbnailSources } from './thumbnailSources.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

const BASE = 'https://api.example.test';
const NOW = Date.parse('2026-11-21T10:00:00Z');
const signed = (expiresAt = '2026-11-21T11:00:00Z') => ({
  url: 'https://x.supabase.co/storage/v1/object/sign/plant-media/u/p.jpg?token=abc',
  key: 'plant-media-42',
  expiresAt,
});

// What PlantThumbnail ends up showing, step by step (the component does the same, with real
// downloads): cached copies are shown, downloads that fail move on, an expired or failing
// signed link asks for fresh links once. works(uri) says whether a download succeeds.
function walk(sources, { cached = new Map(), works = () => true, refreshed = false } = {}) {
  let alreadyRefreshed = refreshed;
  let refreshRequests = 0;
  for (const source of sources) {
    const step = firstStep(source, source.cacheKey ? cached.get(source.cacheKey) ?? null : null, alreadyRefreshed);
    if (step.action === 'show') return { shown: step.uri, kind: source.kind, refreshRequests };
    if (step.action === 'skip') {
      if (step.refresh) {
        refreshRequests += 1;
        alreadyRefreshed = true;
      }
      continue;
    }
    if (works(step.uri)) return { shown: `file://${step.cacheKey}.jpg`, kind: source.kind, refreshRequests };
    if (onSourceFailed(source, alreadyRefreshed) === 'refresh') {
      refreshRequests += 1;
      alreadyRefreshed = true;
    }
  }
  return { shown: null, kind: 'placeholder', refreshRequests };
}

test('source order: phone photo, then signed server thumbnail, then public copy, then the placeholder', () => {
  const all = thumbnailSources({
    localUri: 'file:///phone/p.jpg',
    signed: signed(),
    publicPath: '/p/NIAH-PLT-00012/photo',
    baseUrl: BASE,
    now: NOW,
  });
  assert.deepEqual(all.map((source) => source.kind), ['local', 'signed', 'public']);
  assert.equal(walk(all).kind, 'local');
  // No phone photo: the signed thumbnail; that failing too: the public copy; nothing: placeholder.
  const remote = all.slice(1);
  assert.equal(walk(remote).kind, 'signed');
  assert.equal(walk(remote, { works: (uri) => !uri.includes('supabase') }).kind, 'public');
  assert.deepEqual(walk(remote, { works: () => false }), { shown: null, kind: 'placeholder', refreshRequests: 1 });
  assert.deepEqual(thumbnailSources({ baseUrl: BASE, now: NOW }), []);
});

test('lists ask for the small public copy (?size=thumb); detail tries full size, then the same small copy', () => {
  const list = thumbnailSources({ publicPath: '/p/NIAH-PLT-00012/photo', baseUrl: `${BASE}/`, now: NOW });
  assert.deepEqual(list.map((s) => s.uri), [`${BASE}/p/NIAH-PLT-00012/photo?size=thumb`]);
  const detail = thumbnailSources({ publicPath: '/p/NIAH-PLT-00012/photo', baseUrl: BASE, size: 'full', now: NOW });
  assert.deepEqual(detail.map((s) => s.uri), [`${BASE}/p/NIAH-PLT-00012/photo`, `${BASE}/p/NIAH-PLT-00012/photo?size=thumb`]);
  // The small copy has the same key in both, so a picture the list showed is already on the
  // phone when the plant is opened (offline too).
  assert.equal(detail[1].cacheKey, list[0].cacheKey);
  const cached = new Map([[list[0].cacheKey, 'file:///thumbs/list.jpg']]);
  assert.deepEqual(walk(detail, { cached, works: () => false }), { shown: 'file:///thumbs/list.jpg', kind: 'public', refreshRequests: 0 });
  // Same for an own plant: the signed thumbnail keeps its key between list and detail.
  const ownList = thumbnailSources({ signed: signed(), now: NOW });
  const ownDetail = thumbnailSources({ signed: signed(), size: 'full', now: NOW });
  assert.equal(ownList[0].cacheKey, ownDetail[0].cacheKey);
  assert.equal(ownList[0].cacheKey, 'own-plant-media-42');
});

test('expired signed link: the kept copy is still shown; otherwise fresh links are asked for once, then the next source', () => {
  const expired = thumbnailSources({
    signed: signed('2026-11-21T09:00:00Z'),
    publicPath: '/p/NIAH-PLT-00012/photo',
    baseUrl: BASE,
    now: NOW,
  });
  assert.equal(expired[0].expired, true);
  // Already on the phone: shown, no request.
  const kept = walk(expired, { cached: new Map([['own-plant-media-42', 'file:///thumbs/own.jpg']]) });
  assert.deepEqual(kept, { shown: 'file:///thumbs/own.jpg', kind: 'signed', refreshRequests: 0 });
  // Not kept: one refresh request, then the public copy.
  assert.deepEqual(walk(expired), { shown: `file://${expired[1].cacheKey}.jpg`, kind: 'public', refreshRequests: 1 });
  // Already refreshed once for this list: no second request, straight to the next source.
  assert.equal(walk(expired, { refreshed: true }).refreshRequests, 0);
  // Nothing else: the placeholder.
  assert.deepEqual(walk(expired.slice(0, 1), { refreshed: true }), { shown: null, kind: 'placeholder', refreshRequests: 0 });
  // A link that still has time is not expired; one about to run out is.
  assert.equal(isExpired('2026-11-21T10:10:00Z', NOW), false);
  assert.equal(isExpired('2026-11-21T10:00:20Z', NOW), true);
  assert.equal(isExpired(null, NOW), false);
});

test('only HTTPS signed links and the backend\'s own /p/<tag>/photo paths are used; keys are safe file names', () => {
  assert.deepEqual(thumbnailSources({ signed: { ...signed(), url: 'http://x/y.jpg' }, now: NOW }), []);
  for (const publicPath of ['https://evil.test/p/NIAH-PLT-00012/photo', '/p/plant:abc/photo', 'storage/plant-media/x.jpg', null]) {
    assert.deepEqual(thumbnailSources({ publicPath, baseUrl: BASE, now: NOW }), [], String(publicPath));
  }
  const [source] = thumbnailSources({ signed: { ...signed(), key: '../../etc/passwd' }, now: NOW });
  assert.match(source.cacheKey, /^[A-Za-z0-9-]+$/);
  // Public copies are kept for the day (an officer can change a plant's main photo).
  const [today] = thumbnailSources({ publicPath: '/p/NIAH-PLT-00012/photo', baseUrl: BASE, now: NOW });
  assert.equal(today.cacheKey, 'public-NIAH-PLT-00012-thumb-20261121');
});

test('rows get their thumbnail from the list data, without opening the plant', () => {
  // One request per page for the whole list (shared by the Plants tab, Home and detail).
  const service = read('../services/approvedPlants.ts');
  assert.match(service, /apiFetch<PlantListResponse>\(`\/api\/plants\?page=\$\{page\}`\)/);
  assert.match(service, /ownThumbnails\[serverId\] = \{\s*url: row\.thumbnail_url,\s*key: row\.thumbnail_key,/);
  const store = read('../store/usePlantListStore.ts');
  assert.match(store, /const list = await fetchPlantList\(own\);/);
  // Plants tab and Recent activity build every row's sources from that data.
  const records = read('../../app/(tabs)/records.tsx');
  assert.match(records, /localItem\(entry\.key, entry\.plant, entry\.plant\.serverId \? ownThumbnails\[entry\.plant\.serverId\] \?\? null : null\)/);
  assert.match(records, /<PlantThumbnail\s+sources=\{item\.photo\}/);
  const activity = read('../components/RecentActivity.tsx');
  assert.match(activity, /const signed = !record\.otherBotanist && record\.serverId \? ownThumbnails\[record\.serverId\] \?\? null : null;/);
  assert.match(activity, /<PlantThumbnail\s+sources=\{item\.photo\}/);
  // Visitor Home and Plant guide: the species' public copy, small.
  for (const screen of ['../../app/(tabs)/home.tsx', '../../app/(tabs)/plants.tsx']) {
    assert.match(read(screen), /sources=\{thumbnailSources\(\{ publicPath: photo\?\.url, baseUrl: BASE_URL \}\)\}/, screen);
  }
  // Plant detail: the same sources (signed thumbnail from the same list, or the public copy).
  const detail = read('../../app/plant-detail.tsx');
  assert.match(detail, /state\.ownThumbnails\[matched\.serverId\]/);
  assert.match(detail, /signed: signedThumbnail,\s*publicPath: matched\.otherBotanist \? matched\.publicPhotoUrl : null,/);
  // No request per row anywhere.
  for (const file of ['../components/PlantThumbnail.tsx', '../components/RecentActivity.tsx', '../../app/(tabs)/records.tsx']) {
    assert.doesNotMatch(read(file), /apiFetch\(|\/qr\/image|\/photos\//, file);
  }
  // Downloaded once, kept on the phone.
  const cache = read('../services/thumbnailCache.ts');
  assert.match(cache, /File\.downloadFileAsync\(url, target, \{ idempotent: true \}\)/);
  assert.match(cache, /const running = inFlight\.get\(key\);/);
});
