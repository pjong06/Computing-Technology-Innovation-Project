#!/usr/bin/env node
// clean.mjs - removes leftover photo credits, sources and links from species text in the
// database (description, habitat and distribution notes), e.g.
//   "Identified to family level only. (photo by Niah National Park)."
//     -> "Identified to family level only."
// using the same rules the backend applies when it shows species text
// (backend/src/utils/speciesDescription.js cleanSpeciesText).
//
// Dry run by default: writes a CSV report (species, field, old, new) and changes nothing.
// --apply writes the cleaned text, each update only if the field still has the old value
// (so text someone changed since the report is never overwritten).
//
// Run from the repo root (Node 18+):
//   node scripts/clean-species-text/clean.mjs [--report FILE] [--apply]
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the environment only (never .env).
// --apply needs supabase/migrations/20261121190000_service_role_clean_species_text.sql.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '../species-photos/csv.mjs';

const require = createRequire(import.meta.url);
const { cleanSpeciesText } = require('../../backend/src/utils/speciesDescription.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = 1000;
export const CLEAN_FIELDS = ['description', 'habitat', 'distribution_notes'];
export const REPORT_COLUMNS = ['species', 'field', 'old', 'new', 'action', 'species_id'];

let serviceRoleKey = '';
let root = '';

// One row per field whose text changes when cleaned. Nothing else.
export function planCleaning(species) {
  const rows = [];
  for (const item of species) {
    for (const field of CLEAN_FIELDS) {
      const old = item[field];
      if (typeof old !== 'string') continue;
      const cleaned = cleanSpeciesText(old);
      if (cleaned === old) continue;
      rows.push({
        species_id: item.id,
        species: item.scientific_name ?? '',
        field,
        old,
        // An empty result is stored as "nothing" (null), as the editor does.
        new: cleaned === '' ? null : cleaned,
        action: 'will clean (dry run)',
      });
    }
  }
  return rows;
}

export function parseArguments(argv) {
  const options = { apply: false, report: join(HERE, 'clean-species-text-report.csv') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--report') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--report needs a file');
      options.report = resolve(value);
      i += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function connect() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!rawUrl || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  }
  const base = new URL(rawUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS URL without credentials or query parameters.');
  }
  root = `${base.toString().replace(/\/+$/, '')}/`;
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(new URL(`rest/v1/${path}`, root), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Supabase answered HTTP ${response.status}${data?.message ? `: ${data.message}` : ''}`);
  return data;
}

async function readSpecies() {
  const species = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      select: `id,scientific_name,${CLEAN_FIELDS.join(',')}`,
      order: 'scientific_name.asc,id.asc',
      limit: String(PAGE),
      offset: String(offset),
    });
    const page = await rest(`species?${params}`);
    species.push(...page);
    if (page.length < PAGE) break;
  }
  return species;
}

// PostgREST filter for "this column still has exactly this old value".
export function unchanged(column, old) {
  return `${column}=eq.${encodeURIComponent(old)}`;
}

const safe = (error) => {
  let message = error instanceof Error ? error.message : String(error);
  if (serviceRoleKey) message = message.split(serviceRoleKey).join('[REDACTED]');
  return message.slice(0, 300);
};

async function run(options) {
  connect();
  const species = await readSpecies();
  const rows = planCleaning(species);
  if (options.apply) {
    for (const row of rows) {
      try {
        const updated = await rest(
          `species?id=eq.${row.species_id}&${unchanged(row.field, row.old)}&select=id`,
          { method: 'PATCH', body: { [row.field]: row.new }, prefer: 'return=representation' }
        );
        row.action = updated.length ? 'cleaned' : 'skipped: changed since the report';
      } catch (error) {
        row.action = `failed: ${safe(error)}`;
      }
    }
  }
  mkdirSync(dirname(options.report), { recursive: true });
  writeFileSync(options.report, toCsv(REPORT_COLUMNS, rows.map((row) => ({ ...row, new: row.new ?? '' }))), 'utf8');
  const species_ = new Set(rows.map((row) => row.species_id)).size;
  console.log(`${species.length} species checked; ${rows.length} fields in ${species_} species ${options.apply ? 'processed' : 'would be cleaned'}.`);
  if (!options.apply) console.log('Dry run: nothing was changed. Review the report, then run again with --apply.');
  console.log(`Report: ${options.report}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log('node scripts/clean-species-text/clean.mjs [--report FILE] [--apply]   (dry run unless --apply)');
    } else {
      await run(options);
    }
  } catch (error) {
    console.error(`Stopped: ${safe(error)}`);
    process.exitCode = 1;
  }
}
