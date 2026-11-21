#!/usr/bin/env node
// attach-photos.mjs - gives each imported iNaturalist plant (plants.data_source =
// 'inaturalist') its OWN sighting photo as its main plant photo.
//
// Dry run is the default: it reads the plants, matches them to their sightings, checks each
// photo's own licence on iNaturalist and writes the report, but downloads, uploads and
// inserts nothing. --apply also downloads, resizes, uploads and inserts the plant_media row.
//
// Needs supabase/migrations/20261121120000_plant_media_inaturalist_source.sql applied
// before --apply. See README.md in this folder.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsvObjects, toCsv } from '../species-photos/csv.mjs';
import {
  REPORT_COLUMNS,
  choosePhoto,
  imageUrlsFor,
  licenceAllowed,
  matchPlants,
  photoLicence,
  reportRecords,
  sightingFromCsv,
  sourceFields,
  totals,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SIGHTINGS = join(HERE, '../species-photos/NiahNationalParkPlants.csv');
const DEFAULT_REPORT = join(HERE, 'inat-plant-photo-report.csv');
const DEFAULT_CACHE = join(HERE, '.cache');
const API = 'https://api.inaturalist.org/v1';
// A generic client name only: no personal details go to iNaturalist.
const USER_AGENT = 'NiahBioTrack-plant-photo-attach/1.0';
const BUCKET = 'plant-media';
const MIN_GAP_MS = 1100; // at most one iNaturalist request (API or image) per second
const MAX_ATTEMPTS = 4;
const OBSERVATION_BATCH = 30;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_SIDE_PX = 1600;
const IN_CHUNK = 100;

const backendRequire = createRequire(join(HERE, '../../backend/package.json'));
let sharp;
let serviceRoleKey = '';
let lastInatRequestAt = 0;

// ---------- Command line ----------

function parseArguments(argv) {
  const options = {
    apply: false,
    limit: undefined,
    sightings: DEFAULT_SIGHTINGS,
    report: DEFAULT_REPORT,
    cache: DEFAULT_CACHE,
    plants: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--limit') {
      const text = value();
      if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
        throw new Error('--limit needs a positive whole number');
      }
      options.limit = Number(text);
    } else if (arg === '--sightings') options.sightings = resolve(value());
    else if (arg === '--report') options.report = resolve(value());
    else if (arg === '--cache') options.cache = resolve(value());
    else if (arg === '--plants') options.plants = resolve(value());
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.apply && options.plants) {
    throw new Error('--plants is for dry runs only; --apply reads the plants from Supabase.');
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/inat-plant-photos/attach-photos.mjs [--limit N] [--sightings FILE] [--report FILE] [--cache DIR]
  node scripts/inat-plant-photos/attach-photos.mjs --plants FILE [--limit N] ...   (dry run without Supabase)
  node scripts/inat-plant-photos/attach-photos.mjs --apply [--limit N] ...

Dry run (default): matches plants to sightings, checks each photo's licence on iNaturalist
and writes the report. Nothing is downloaded, uploaded or inserted.
--apply: also downloads the photo, resizes it to at most ${MAX_SIDE_PX} px, uploads it to the
'${BUCKET}' bucket and inserts a primary plant_media row.
--limit N: attach (or plan) at most N photos.
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the environment only.`);
}

// ---------- iNaturalist (one request a second, cached so a stopped run can resume) ----------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForInatSlot() {
  const wait = lastInatRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastInatRequestAt = Date.now();
}

function observationCacheFile(id) {
  return join(options.cache, `observation-${id}.json`);
}

async function backOff(attempt, retryAfter) {
  if (attempt >= MAX_ATTEMPTS) return;
  const seconds = Number(retryAfter);
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000 * attempt;
  console.warn(`  waiting ${Math.round(ms / 1000)} s before retrying iNaturalist...`);
  await sleep(ms);
}

async function getInatJson(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await waitForInatSlot();
    let response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = new Error(`iNaturalist could not be reached: ${error.message}`);
      await backOff(attempt, null);
      continue;
    }
    if (response.ok) return response.json();
    lastError = new Error(`iNaturalist answered HTTP ${response.status}`);
    if (response.status === 429 || response.status >= 500) {
      await backOff(attempt, response.headers.get('retry-after'));
      continue;
    }
    break;
  }
  throw lastError;
}

// Every observation by id, from the cache or GET /v1/observations?id=...  (30 per request).
// Returns Map id -> observation, or null for an id iNaturalist doesn't have.
async function loadObservations(ids) {
  mkdirSync(options.cache, { recursive: true });
  const found = new Map();
  const missing = [];
  for (const id of new Set(ids)) {
    const file = observationCacheFile(id);
    if (existsSync(file)) found.set(id, JSON.parse(readFileSync(file, 'utf8')).observation);
    else missing.push(id);
  }
  if (missing.length) console.log(`Reading ${missing.length} observations from iNaturalist (cached: ${found.size})...`);
  for (let start = 0; start < missing.length; start += OBSERVATION_BATCH) {
    const batch = missing.slice(start, start + OBSERVATION_BATCH);
    const body = await getInatJson(`${API}/observations?id=${batch.join(',')}&per_page=${OBSERVATION_BATCH}`);
    const results = new Map((Array.isArray(body?.results) ? body.results : []).map((item) => [String(item.id), item]));
    for (const id of batch) {
      const observation = results.get(id) ?? null;
      const file = observationCacheFile(id);
      writeFileSync(`${file}.tmp`, JSON.stringify({ id, savedAt: new Date().toISOString(), observation }));
      renameSync(`${file}.tmp`, file);
      found.set(id, observation);
    }
  }
  return found;
}

function detectImageFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

// Downloads one image from an iNaturalist image host. Redirects are followed only to the
// same two hosts. Throws with .status for HTTP errors.
async function downloadImage(initialUrl) {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (imageUrlsFor({ url }).length === 0) throw new Error('image URL is not on an iNaturalist image host');
    await waitForInatSlot();
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/jpeg,image/png,image/webp' },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      const location = response.headers.get('location');
      if (!location) throw new Error('image redirect has no location');
      url = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const error = new Error(`image server answered HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('image is larger than 10 MB');
    if (!detectImageFormat(bytes)) throw new Error('downloaded file is not a JPEG, PNG or WebP image');
    return bytes;
  }
  throw new Error('image redirected too many times');
}

// Re-encodes as a JPEG of at most 1600 px on the long side (this also drops embedded
// metadata such as GPS).
async function toJpeg(bytes) {
  if (!sharp) sharp = backendRequire('sharp');
  return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(MAX_SIDE_PX, MAX_SIDE_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ---------- Supabase (REST and Storage, service role from the environment only) ----------

function createSupabaseClient() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!rawUrl || !serviceRoleKey) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (see README.md), ' +
      'or give --plants FILE for a dry run without Supabase.'
    );
  }
  let base;
  try {
    base = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS URL without credentials or query parameters.');
  }
  const root = `${base.toString().replace(/\/+$/, '')}/`;

  async function request(path, { method = 'GET', body, contentType, prefer } = {}) {
    const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = contentType ?? 'application/json';
    if (prefer) headers.Prefer = prefer;
    let response;
    try {
      response = await fetch(new URL(path, root), {
        method,
        headers,
        body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`Supabase could not be reached: ${error.message}`);
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const error = new Error(typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`);
      error.status = response.status;
      error.code = data?.code;
      throw error;
    }
    return data;
  }

  return {
    get: (table, params) => request(`rest/v1/${table}?${new URLSearchParams(params).toString()}`),
    insert: (table, record) => request(`rest/v1/${table}`, { method: 'POST', body: record, prefer: 'return=representation' }),
    upload: (path, bytes) => request(
      `storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'POST', body: bytes, contentType: 'image/jpeg' }
    ),
    remove: (path) => request(`storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: [path] } }),
  };
}

function safeMessage(error) {
  let message = error instanceof Error ? error.message : String(error);
  if (serviceRoleKey) message = message.split(serviceRoleKey).join('[REDACTED]');
  return message.slice(0, 400);
}

const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const inList = (ids) => `in.(${ids.join(',')})`;

// The plants' current photos. Before the migration plant_media has no source columns: a dry
// run then reads without them (no row can be an iNaturalist photo yet).
let sourceColumnsMissing = false;
async function existingPhotos(client, ids) {
  const params = { plant_id: inList(ids), deleted_at: 'is.null' };
  if (!sourceColumnsMissing) {
    try {
      return await client.get('plant_media', { select: 'id,plant_id,is_primary,source,source_photo_id', ...params });
    } catch (error) {
      if (error.code !== '42703') throw error;
      sourceColumnsMissing = true;
      console.warn('Note: plant_media has no source columns yet (migration not applied). Apply it before --apply.');
    }
  }
  return client.get('plant_media', { select: 'id,plant_id,is_primary', ...params });
}

// Every imported plant, with its species name, coordinates and existing photos.
async function loadPlantsFromSupabase(client) {
  const plants = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await client.get('plants', {
      select: 'id,qr_code_value,species_id,source_url,registered_by',
      data_source: 'eq.inaturalist',
      deleted_at: 'is.null',
      order: 'qr_code_value.asc,id.asc',
      limit: '1000',
      offset: String(offset),
    });
    plants.push(...page);
    if (page.length < 1000) break;
  }
  const speciesIds = [...new Set(plants.map((plant) => plant.species_id).filter(Boolean))];
  const speciesNames = new Map();
  for (const ids of chunks(speciesIds, IN_CHUNK)) {
    for (const row of await client.get('species', { select: 'id,scientific_name', id: inList(ids) })) {
      speciesNames.set(row.id, row.scientific_name);
    }
  }
  const points = new Map();
  const media = new Map();
  for (const ids of chunks(plants.map((plant) => plant.id), IN_CHUNK)) {
    for (const row of await client.get('plant_map_points', { select: 'id,latitude,longitude', id: inList(ids) })) {
      points.set(row.id, row);
    }
    for (const row of await existingPhotos(client, ids)) {
      media.set(row.plant_id, [...(media.get(row.plant_id) ?? []), row]);
    }
  }
  return plants.map((plant) => ({
    id: plant.id,
    tag: plant.qr_code_value ?? '',
    scientificName: speciesNames.get(plant.species_id) ?? '',
    sourceUrl: plant.source_url ?? '',
    latitude: points.get(plant.id)?.latitude ?? null,
    longitude: points.get(plant.id)?.longitude ?? null,
    registeredBy: plant.registered_by ?? null,
    media: media.get(plant.id) ?? [],
  }));
}

// --plants FILE: the same plants exported from the SQL Editor (README.md has the query),
// so a dry run can run without the service-role key. Existing photos are unknown then.
function loadPlantsFromCsv(file) {
  return parseCsvObjects(readFileSync(file, 'utf8')).map((row) => ({
    id: row.id,
    tag: row.qr_code_value ?? '',
    scientificName: row.scientific_name ?? '',
    sourceUrl: row.source_url ?? '',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    registeredBy: row.registered_by || null,
    media: null,
  }));
}

// ---------- Attaching one photo ----------

async function attach(client, plant, photo, observation, existing) {
  const fields = sourceFields(photo, observation);
  const urls = imageUrlsFor(photo);
  let bytes;
  let lastError;
  for (const url of urls) {
    try {
      bytes = await downloadImage(url);
      break;
    } catch (error) {
      lastError = error;
      if (error.status !== 404) break;
    }
  }
  if (!bytes) throw lastError ?? new Error('no usable image URL');
  const jpeg = await toJpeg(bytes);

  const path = `${plant.registeredBy}/${plant.id}/${randomUUID()}.jpg`;
  await client.upload(path, jpeg);
  const primary = !existing.some((row) => row.is_primary);
  try {
    await client.insert('plant_media', {
      plant_id: plant.id,
      uploaded_by: plant.registeredBy,
      file_path: path,
      media_type: 'image',
      photo_type: 'whole_plant',
      is_primary: primary,
      ...fields,
      imported_at: new Date().toISOString(),
    });
  } catch (error) {
    await client.remove(path).catch(() => {});
    if (error.code === '23505') return { action: 'skipped', reason: 'already attached (by another run)' };
    throw error;
  }
  return {
    action: 'attached',
    reason: primary ? 'main photo' : 'added, not main: the plant already has a main photo',
  };
}

// ---------- Main ----------

async function run() {
  if (!existsSync(options.sightings)) {
    throw new Error(`Sightings CSV not found: ${options.sightings} (copy NiahNationalParkPlants.csv there or pass --sightings FILE)`);
  }
  const sightings = parseCsvObjects(readFileSync(options.sightings, 'utf8')).map(sightingFromCsv);
  const client = options.plants ? null : createSupabaseClient();
  if (options.apply) {
    // Stops before any download if the migration isn't applied yet.
    try {
      await client.get('plant_media', { select: 'source,source_photo_id,licence_code,attribution,photographer,source_url,imported_at', limit: '1' });
    } catch (error) {
      throw new Error(`plant_media has no source columns yet; apply the migration first (${safeMessage(error)})`);
    }
  }
  const plants = options.plants ? loadPlantsFromCsv(options.plants) : await loadPlantsFromSupabase(client);
  console.log(`${options.apply ? 'APPLY' : 'DRY RUN (nothing is downloaded, uploaded or inserted)'}: ` +
    `${plants.length} imported plants, ${sightings.length} sightings.`);

  const matches = matchPlants(plants, sightings);
  const observations = await loadObservations(
    matches.filter((match) => match.sighting).map((match) => match.sighting.id)
  );

  const rows = [];
  let planned = 0;
  for (const { plant, sighting, method, reason } of matches) {
    const row = {
      plant_id: plant.id,
      tag: plant.tag,
      species: plant.scientificName,
      matched_sighting: sighting?.url || (sighting ? `https://www.inaturalist.org/observations/${sighting.id}` : ''),
      match_method: method,
      photo_id: '',
      licence: '',
      action: 'skipped',
      reason,
    };
    rows.push(row);
    if (!sighting) continue;

    const observation = observations.get(sighting.id);
    const chosen = choosePhoto(observation, sighting.imageUrl);
    if (!chosen.photo) {
      row.reason = chosen.reason;
      continue;
    }
    row.photo_id = String(chosen.photo.id);
    row.licence = photoLicence(chosen.photo);
    if (!licenceAllowed(row.licence)) {
      row.reason = row.licence ? `licence ${row.licence} is not allowed` : 'licence missing (all rights reserved)';
      continue;
    }
    if (!String(chosen.photo.attribution ?? '').trim()) {
      row.reason = 'photo has no attribution on iNaturalist';
      continue;
    }
    if (imageUrlsFor(chosen.photo).length === 0) {
      row.reason = 'photo is not on an iNaturalist image host';
      continue;
    }
    const existing = plant.media ?? [];
    if (existing.some((media) => media.source === 'inaturalist' && String(media.source_photo_id) === row.photo_id)) {
      row.reason = 'already attached';
      continue;
    }
    if (!plant.registeredBy) {
      row.reason = 'plant has no registered_by (needed for the photo owner and path)';
      continue;
    }
    if (options.limit !== undefined && planned >= options.limit) {
      row.reason = `not processed: --limit ${options.limit} reached`;
      continue;
    }
    planned += 1;

    if (!options.apply) {
      row.action = 'would attach';
      row.reason = existing.some((media) => media.is_primary)
        ? 'would be added, not main: the plant already has a main photo'
        : plant.media === null ? 'main photo (existing photos not checked without Supabase)' : 'main photo';
      continue;
    }
    try {
      Object.assign(row, await attach(client, plant, chosen.photo, observation, existing));
      console.log(`${row.action.toUpperCase()}  ${row.tag || row.plant_id}  photo ${row.photo_id} (${row.licence})`);
    } catch (error) {
      row.action = 'failed';
      row.reason = safeMessage(error);
      console.error(`FAILED  ${row.tag || row.plant_id}: ${row.reason}`);
    }
  }

  mkdirSync(dirname(options.report), { recursive: true });
  writeFileSync(options.report, toCsv(REPORT_COLUMNS, reportRecords(rows)), 'utf8');

  const { byAction, skippedLicences } = totals(rows);
  console.log(`Totals: ${Object.entries(byAction).map(([action, count]) => `${action}=${count}`).join(' ')}`);
  if (skippedLicences.length) {
    console.log(`Skipped for licence (${skippedLicences.length}):`);
    for (const row of skippedLicences) {
      console.log(`  ${row.tag || row.plant_id}  ${row.species}  photo ${row.photo_id}: ${row.licence || 'missing'}`);
    }
  }
  console.log(`Report: ${options.report}`);
  if (byAction.failed) process.exitCode = 1;
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
  if (options.help) printHelp();
  else await run();
} catch (error) {
  console.error(`Stopped: ${safeMessage(error)}`);
  process.exitCode = 1;
}
