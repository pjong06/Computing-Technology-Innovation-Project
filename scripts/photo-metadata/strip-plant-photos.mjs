#!/usr/bin/env node
// strip-plant-photos.mjs - removes camera metadata (EXIF with GPS, XMP, IPTC, ICC profiles)
// from plant photos already stored in the private 'plant-media' bucket, by re-encoding each
// file in place as a JPEG. New uploads are already stripped by the backend
// (backend/src/services/photoSanitizer.js); this cleans the photos stored before that.
//
// Dry run is the default: it downloads each file, reports what metadata it has and what
// would change, and writes nothing. --apply overwrites the files that have metadata, at the
// same path (rows in plant_media and links to them stay valid).
//
// Run from the repo root (Node 18+, backend dependencies installed for sharp):
//   node scripts/photo-metadata/strip-plant-photos.mjs [--limit N] [--report FILE]
//   node scripts/photo-metadata/strip-plant-photos.mjs --apply [--limit N]
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the environment only (never .env).

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '../species-photos/csv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUCKET = 'plant-media';
const PAGE = 500;
const MAX_INPUT_PIXELS = 25_000_000;
const MAX_SIDE_PX = 2000; // the same as new uploads
const REQUEST_TIMEOUT_MS = 60_000;
const REPORT_COLUMNS = ['media_id', 'plant_id', 'file_path', 'format', 'metadata_found', 'action', 'reason'];

const backendRequire = createRequire(join(HERE, '../../backend/package.json'));
let serviceRoleKey = '';

function parseArguments(argv) {
  const options = { apply: false, limit: undefined, report: join(HERE, 'strip-plant-photos-report.csv') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--limit') {
      const text = value();
      if (!/^[1-9]\d*$/.test(text)) throw new Error('--limit needs a positive whole number');
      options.limit = Number(text);
    } else if (arg === '--report') options.report = resolve(value());
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function client() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!rawUrl || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (see README.md).');
  }
  const base = new URL(rawUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS URL without credentials or query parameters.');
  }
  const root = `${base.toString().replace(/\/+$/, '')}/`;
  const headers = (extra = {}) => ({ apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, ...extra });
  const call = async (path, init = {}) => {
    const response = await fetch(new URL(path, root), {
      ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = `HTTP ${response.status}`;
      try { message = JSON.parse(text).message || message; } catch { /* plain text */ }
      throw new Error(message);
    }
    return response;
  };
  const objectPath = (path) => `storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return {
    async rows(offset) {
      const params = new URLSearchParams({
        select: 'id,plant_id,file_path', deleted_at: 'is.null', order: 'id.asc',
        limit: String(PAGE), offset: String(offset),
      });
      return (await call(`rest/v1/plant_media?${params}`, { headers: headers({ Accept: 'application/json' }) })).json();
    },
    async download(path) {
      return Buffer.from(await (await call(objectPath(path), { headers: headers() })).arrayBuffer());
    },
    // PUT replaces the existing object at the same path.
    async replace(path, bytes) {
      await call(objectPath(path), {
        method: 'PUT',
        headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }),
        body: bytes,
      });
    },
  };
}

const safe = (error) => {
  let message = error instanceof Error ? error.message : String(error);
  if (serviceRoleKey) message = message.split(serviceRoleKey).join('[REDACTED]');
  return message.slice(0, 300);
};

// The metadata a file carries, as a short list ('' when clean).
function metadataFound(info) {
  return ['exif', 'xmp', 'iptc', 'icc'].filter((key) => info[key]).join(';');
}

async function run(options) {
  const sharp = backendRequire('sharp');
  const supabase = client();
  console.log(options.apply ? 'APPLY: files with metadata are re-encoded in place.' : 'DRY RUN: nothing is written.');

  const rows = [];
  let checked = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await supabase.rows(offset);
    for (const media of page) {
      if (options.limit !== undefined && checked >= options.limit) break;
      checked += 1;
      const row = { media_id: media.id, plant_id: media.plant_id, file_path: media.file_path, format: '', metadata_found: '', action: '', reason: '' };
      rows.push(row);
      if (!media.file_path) {
        Object.assign(row, { action: 'skipped', reason: 'no file path' });
        continue;
      }
      try {
        const original = await supabase.download(media.file_path);
        const info = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
        row.format = info.format ?? '';
        row.metadata_found = metadataFound(info);
        if (!['jpeg', 'png', 'webp'].includes(info.format)) {
          Object.assign(row, { action: 'skipped', reason: `not a JPEG, PNG or WebP (${info.format || 'unknown'})` });
          continue;
        }
        if (row.metadata_found === '' && info.format === 'jpeg') {
          Object.assign(row, { action: 'already clean', reason: '' });
          continue;
        }
        const cleaned = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate()
          .resize(MAX_SIDE_PX, MAX_SIDE_PX, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        if (metadataFound(await sharp(cleaned).metadata()) !== '') {
          throw new Error('the re-encoded file still has metadata');
        }
        if (!options.apply) {
          Object.assign(row, { action: 'would clean', reason: row.metadata_found ? `has ${row.metadata_found}` : 'not a JPEG' });
          continue;
        }
        await supabase.replace(media.file_path, cleaned);
        Object.assign(row, { action: 'cleaned', reason: row.metadata_found ? `removed ${row.metadata_found}` : 'converted to JPEG' });
        console.log(`CLEANED  ${media.file_path}`);
      } catch (error) {
        Object.assign(row, { action: 'failed', reason: safe(error) });
        console.error(`FAILED  ${media.file_path}: ${row.reason}`);
      }
    }
    if (page.length < PAGE || (options.limit !== undefined && checked >= options.limit)) break;
  }

  const totals = {};
  for (const row of rows) totals[row.action] = (totals[row.action] ?? 0) + 1;
  mkdirSync(dirname(options.report), { recursive: true });
  writeFileSync(options.report, toCsv(REPORT_COLUMNS, [
    ...rows,
    ...Object.entries(totals).map(([action, count]) => ({ media_id: 'TOTAL', action, reason: String(count) })),
  ]), 'utf8');
  console.log(`Totals: ${Object.entries(totals).map(([a, n]) => `${a}=${n}`).join(' ') || 'no photos'}`);
  console.log(`Report: ${options.report}`);
  if (totals.failed) process.exitCode = 1;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('node scripts/photo-metadata/strip-plant-photos.mjs [--apply] [--limit N] [--report FILE]');
  } else {
    await run(options);
  }
} catch (error) {
  console.error(`Stopped: ${safe(error)}`);
  process.exitCode = 1;
}
