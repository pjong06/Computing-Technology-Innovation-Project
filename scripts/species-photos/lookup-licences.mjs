#!/usr/bin/env node
// lookup-licences.mjs - one-off licence check for species reference photos.
//
// Reads the list exported by matching-queries.sql (Q5), asks the public iNaturalist API
// for each photo's licence and credit, and writes a review CSV for an officer.
//
// It only reads the input CSV and its own cache folder, and only calls the public
// iNaturalist API (no login). It never reads .env files or any secret, and never
// touches our database or storage.
//
// Run:  node scripts/species-photos/lookup-licences.mjs [--input FILE] [--output FILE] [--cache DIR]
// Needs Node 18+ (built-in fetch). See README.md in this folder.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.inaturalist.org/v1';
const USER_AGENT =
  'NiahBioTrack-species-photo-licence-check/1.0 (Swinburne University capstone; one-off licence review)';

// Only these licences may be used, always with credit.
const ALLOWED_LICENCES = new Set(['cc0', 'cc-by', 'cc-by-sa']);
const MIN_GAP_MS = 1100;          // at most one request per second (with a little margin)
const MAX_ATTEMPTS = 4;           // first try + 3 retries
const BATCH_SIZE = 30;            // taxa per /v1/taxa/<ids> call
const MAX_ALTERNATIVES = 3;
const REQUEST_TIMEOUT_MS = 30000;

// ---------- Command line ----------

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const INPUT = resolve(argument('--input', join(HERE, 'species-photo-list.csv')));
const OUTPUT = resolve(argument('--output', join(HERE, 'species-photo-review.csv')));
const CACHE = resolve(argument('--cache', join(HERE, '.cache')));

// ---------- CSV ----------

// Parses CSV text (RFC 4180: quoted fields, "" inside quotes, CRLF or LF) into rows of strings.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(value => value.trim() !== ''));
}

function csvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header, records) {
  const lines = [header.map(csvValue).join(',')];
  for (const record of records) lines.push(header.map(column => csvValue(record[column])).join(','));
  // The byte-order mark lets Excel show names like "Tomáš" correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------- Polite HTTP with a cache (so a stopped run can resume) ----------

let lastRequestAt = 0;
const sleep = ms => new Promise(done => setTimeout(done, ms));

function cacheFile(url) {
  return join(CACHE, createHash('sha256').update(url).digest('hex').slice(0, 32) + '.json');
}

// GET a JSON URL from the iNaturalist API. A cached answer is reused without a request.
// Waits at least MIN_GAP_MS between requests; retries 429, 5xx and network errors with
// back-off (honouring Retry-After); gives up on other 4xx answers.
async function getJson(url) {
  const file = cacheFile(url);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).body;

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    let response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = new Error(`network error: ${error.message}`);
      await backOff(attempt, null);
      continue;
    }

    if (response.ok) {
      const body = await response.json();
      // Write to a temporary file first, so a stop mid-write never leaves a broken cache entry.
      writeFileSync(file + '.tmp', JSON.stringify({ url, savedAt: new Date().toISOString(), body }));
      renameSync(file + '.tmp', file);
      return body;
    }

    lastError = new Error(`HTTP ${response.status}`);
    if (response.status === 429 || response.status >= 500) {
      await backOff(attempt, response.headers.get('retry-after'));
      continue;
    }
    break; // other 4xx: retrying won't help
  }
  throw lastError;
}

async function backOff(attempt, retryAfter) {
  if (attempt >= MAX_ATTEMPTS) return;
  const seconds = Number(retryAfter);
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000 * attempt;
  console.warn(`  waiting ${Math.round(ms / 1000)} s before retrying...`);
  await sleep(ms);
}

// ---------- iNaturalist lookups ----------

const normalise = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

// The taxon whose name is exactly this scientific name, or null.
async function findTaxon(scientificName) {
  const url = `${API}/taxa?q=${encodeURIComponent(scientificName)}&per_page=30`;
  const body = await getJson(url);
  const wanted = normalise(scientificName);
  const exact = (body.results || []).filter(taxon => normalise(taxon.name) === wanted);
  // Prefer an active taxon if iNaturalist has both an old and a current one.
  return exact.find(taxon => taxon.is_active !== false) || exact[0] || null;
}

// Every photo of these taxa, by taxon id: { id, licence, attribution, imageUrl, pageUrl }.
async function photosOfTaxa(taxonIds) {
  const photosByTaxon = new Map();
  for (let i = 0; i < taxonIds.length; i += BATCH_SIZE) {
    const batch = taxonIds.slice(i, i + BATCH_SIZE);
    const body = await getJson(`${API}/taxa/${batch.join(',')}`);
    for (const taxon of body.results || []) {
      const seen = new Map();
      const add = photo => {
        if (!photo || !photo.id || seen.has(photo.id)) return;
        seen.set(photo.id, {
          id: String(photo.id),
          licence: photo.license_code ? String(photo.license_code).toLowerCase() : null,
          attribution: photo.attribution || '',
          imageUrl: photo.medium_url || photo.url || '',
          pageUrl: `https://www.inaturalist.org/photos/${photo.id}`,
        });
      };
      add(taxon.default_photo);
      for (const taxonPhoto of taxon.taxon_photos || []) add(taxonPhoto.photo);
      photosByTaxon.set(String(taxon.id), [...seen.values()]);
    }
  }
  return photosByTaxon;
}

// Why a licence is or isn't allowed, in the words used in the review CSV.
function licenceReason(licence) {
  if (licence === null) return 'all_rights_reserved';
  if (ALLOWED_LICENCES.has(licence)) return 'allowed';
  return licence; // e.g. cc-by-nc, cc-by-nd, cc-by-nc-sa, cc-by-nc-nd
}

// ---------- Main ----------

const OUTPUT_COLUMNS = [
  'species_id', 'scientific_name', 'inat_taxon_id',
  'original_photo_id', 'original_licence', 'original_attribution', 'original_image_url', 'original_page_url',
  'allowed', 'reason',
  'alt1_id', 'alt1_licence', 'alt1_attribution', 'alt1_url', 'alt1_page_url',
  'alt2_id', 'alt2_licence', 'alt2_attribution', 'alt2_url', 'alt2_page_url',
  'alt3_id', 'alt3_licence', 'alt3_attribution', 'alt3_url', 'alt3_page_url',
  'officer_choice', 'officer_name', 'officer_notes',
];

async function main() {
  if (!existsSync(INPUT)) {
    console.error(`Input file not found: ${INPUT}\nExport query Q5 from matching-queries.sql to that path first.`);
    process.exit(1);
  }
  mkdirSync(CACHE, { recursive: true });

  const rows = parseCsv(readFileSync(INPUT, 'utf8'));
  const header = rows.shift().map(name => name.trim().toLowerCase());
  const column = name => header.indexOf(name);
  for (const needed of ['species_id', 'scientific_name', 'backup_photo_url', 'inat_photo_id']) {
    if (column(needed) === -1) {
      console.error(`The input CSV has no "${needed}" column. Use query Q5 from matching-queries.sql.`);
      process.exit(1);
    }
  }
  const inputRows = rows.map(values => ({
    species_id: values[column('species_id')]?.trim(),
    scientific_name: values[column('scientific_name')]?.trim(),
    backup_photo_url: values[column('backup_photo_url')]?.trim(),
    inat_photo_id: (values[column('inat_photo_id')] || '').trim(),
  }));
  console.log(`Read ${inputRows.length} rows from ${INPUT}`);

  // 1. One taxon search per distinct scientific name.
  const names = [...new Set(inputRows.map(row => row.scientific_name))];
  const taxonByName = new Map();
  const failedNames = new Map();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    process.stdout.write(`Taxon ${i + 1}/${names.length}: ${name}\n`);
    try {
      taxonByName.set(name, await findTaxon(name));
    } catch (error) {
      failedNames.set(name, error.message);
      console.warn(`  lookup failed: ${error.message}`);
    }
  }

  // 2. Every photo of the matched taxa, 30 taxa per request.
  const taxonIds = [...new Set([...taxonByName.values()].filter(Boolean).map(taxon => String(taxon.id)))];
  let photosByTaxon = new Map();
  let photoLookupError = null;
  try {
    console.log(`Reading photos of ${taxonIds.length} taxa...`);
    photosByTaxon = await photosOfTaxa(taxonIds);
  } catch (error) {
    photoLookupError = error.message;
    console.warn(`  photo lookup failed: ${error.message} (re-run to resume)`);
  }

  // 3. One review line per input row.
  const records = inputRows.map(row => {
    const record = {
      species_id: row.species_id,
      scientific_name: row.scientific_name,
      original_photo_id: row.inat_photo_id,
      original_image_url: row.backup_photo_url,
      allowed: 'no',
    };
    const taxon = taxonByName.get(row.scientific_name);

    if (failedNames.has(row.scientific_name)) { record.reason = 'lookup_failed'; return record; }
    if (!taxon) { record.reason = 'no_taxon_match'; return record; }
    record.inat_taxon_id = String(taxon.id);
    if (photoLookupError || !photosByTaxon.has(String(taxon.id))) { record.reason = 'lookup_failed'; return record; }

    const photos = photosByTaxon.get(String(taxon.id));
    const original = row.inat_photo_id ? photos.find(photo => photo.id === row.inat_photo_id) : null;

    if (!row.inat_photo_id) record.reason = 'no_photo_id';
    else if (!original) record.reason = 'unknown'; // not one of this taxon's photos: licence can't be confirmed
    else {
      record.original_licence = original.licence || 'all-rights-reserved';
      record.original_attribution = original.attribution;
      record.original_page_url = original.pageUrl;
      record.reason = licenceReason(original.licence);
      record.allowed = record.reason === 'allowed' ? 'yes' : 'no';
    }

    // Alternatives only when the original can't be used. They are suggestions: an officer
    // must pick one in officer_choice before anything is imported.
    if (record.allowed === 'no') {
      const alternatives = photos
        .filter(photo => photo.id !== row.inat_photo_id && ALLOWED_LICENCES.has(photo.licence))
        .slice(0, MAX_ALTERNATIVES);
      alternatives.forEach((photo, index) => {
        const prefix = `alt${index + 1}_`;
        record[prefix + 'id'] = photo.id;
        record[prefix + 'licence'] = photo.licence;
        record[prefix + 'attribution'] = photo.attribution;
        record[prefix + 'url'] = photo.imageUrl;
        record[prefix + 'page_url'] = photo.pageUrl;
      });
    }
    return record;
  });

  writeFileSync(OUTPUT, toCsv(OUTPUT_COLUMNS, records));

  // 4. Summary.
  const count = predicate => records.filter(predicate).length;
  const reasons = {};
  for (const record of records) reasons[record.reason] = (reasons[record.reason] || 0) + 1;
  console.log(`\nWrote ${records.length} rows to ${OUTPUT}`);
  console.log(`  allowed: ${count(r => r.allowed === 'yes')}`);
  console.log(`  not allowed: ${count(r => r.allowed === 'no')}`);
  console.log(`    with at least one allowed alternative: ${count(r => r.allowed === 'no' && r.alt1_id)}`);
  console.log(`  by reason: ${JSON.stringify(reasons)}`);
  if (failedNames.size > 0 || photoLookupError) {
    console.log('\nSome lookups failed. Run the script again: finished requests are cached and not repeated.');
    process.exitCode = 2;
  }
}

main().catch(error => {
  console.error(`Stopped: ${error.message}\nRun the script again to resume (finished requests are cached).`);
  process.exit(1);
});
