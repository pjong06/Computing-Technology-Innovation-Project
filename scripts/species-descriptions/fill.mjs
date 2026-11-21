#!/usr/bin/env node
// fill.mjs - fills EMPTY description, habitat, common name and family fields of approved
// species with the conservative drafts in drafts.mjs, for an officer to review later.
//
// Dry run by default: lists approved species with an empty field and writes a CSV report
// (species, field, old value, new value, action) to review. Nothing is changed.
// --apply writes the drafts:
//   * only into fields that are still empty (each update is conditional on the old value, so
//     text written by someone since the report is never overwritten);
//   * sets species.description_is_draft = true on every species it drafts for, so the
//     officer's species editor shows "Draft description: please review";
//   * family: points the species at a taxonomy row with that family (an existing one, or a
//     new one with the species' current classification plus the family). Existing taxonomy
//     rows are never changed.
// Only species text is drafted. No plant-level data (height, diameter, health, life stage)
// is read or written.
//
// Run from the repo root (Node 18+):
//   node scripts/species-descriptions/fill.mjs [--report FILE] [--apply]
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the environment only (never .env).
// --apply needs supabase/migrations/20261121180000_species_description_draft.sql.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '../species-photos/csv.mjs';
import { DRAFTS } from './drafts.mjs';
import { REPORT_COLUMNS, TEXT_FIELDS, planFills, targetTaxonomy } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = 1000;
const TAXONOMY_FIELDS = ['kingdom', 'division', 'class_name', 'order_name', 'family', 'genus'];

let serviceRoleKey = '';
let root = '';

function parseArguments(argv) {
  const options = { apply: false, report: join(HERE, 'species-description-report.csv') };
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
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (see README.md).');
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
  if (!response.ok) {
    const error = new Error(`Supabase answered HTTP ${response.status}${data?.message ? `: ${data.message}` : ''}`);
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

// Approved species with their taxonomy (paged).
async function readApprovedSpecies() {
  const species = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      select: `id,scientific_name,common_name,description,habitat,taxonomy_id,taxonomy(${TAXONOMY_FIELDS.join(',')})`,
      verification_status: 'eq.approved',
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
function unchanged(column, old) {
  return old === null || old === undefined ? `${column}=is.null` : `${column}=eq.${encodeURIComponent(old)}`;
}

// A taxonomy row for the target classification: an existing one, or a new one.
async function taxonomyIdFor(target) {
  const filters = TAXONOMY_FIELDS.map((field) => (
    target[field] === null ? `${field}=is.null` : `${field}=eq.${encodeURIComponent(target[field])}`
  )).join('&');
  const found = await rest(`taxonomy?select=id&${filters}&limit=1`);
  if (found.length) return found[0].id;
  try {
    const created = await rest('taxonomy?select=id', { method: 'POST', body: target, prefer: 'return=representation' });
    return created[0].id;
  } catch (error) {
    if (error.status !== 409) throw error;
    const again = await rest(`taxonomy?select=id&${filters}&limit=1`);
    if (!again.length) throw error;
    return again[0].id;
  }
}

async function applyFills(species, fills) {
  // The draft flag must exist before anything is written.
  try {
    await rest('species?select=id,description_is_draft&limit=1');
  } catch {
    throw new Error('species.description_is_draft is missing: apply supabase/migrations/20261121180000_species_description_draft.sql first.');
  }
  const byId = new Map(species.map((row) => [row.id, row]));
  for (const fill of fills) {
    const row = byId.get(fill.species_id);
    try {
      if (TEXT_FIELDS.includes(fill.field)) {
        const updated = await rest(
          `species?id=eq.${row.id}&${unchanged(fill.field, row[fill.field])}&select=id`,
          { method: 'PATCH', body: { [fill.field]: fill.new_value, description_is_draft: true }, prefer: 'return=representation' }
        );
        fill.action = updated.length ? 'filled' : 'skipped: changed since the report';
      } else {
        const taxonomyId = await taxonomyIdFor(targetTaxonomy(row.taxonomy, fill.new_value, row.scientific_name));
        const updated = await rest(
          `species?id=eq.${row.id}&${unchanged('taxonomy_id', row.taxonomy_id)}&select=id`,
          { method: 'PATCH', body: { taxonomy_id: taxonomyId, description_is_draft: true }, prefer: 'return=representation' }
        );
        fill.action = updated.length ? 'filled' : 'skipped: changed since the report';
      }
    } catch (error) {
      fill.action = `failed: ${safe(error)}`;
    }
  }
}

const safe = (error) => {
  let message = error instanceof Error ? error.message : String(error);
  if (serviceRoleKey) message = message.split(serviceRoleKey).join('[REDACTED]');
  return message.slice(0, 300);
};

async function run(options) {
  connect();
  const species = await readApprovedSpecies();
  const { fills, gaps } = planFills(species, DRAFTS);
  if (options.apply) {
    await applyFills(species, fills);
  } else {
    for (const fill of fills) fill.action = 'will fill (dry run)';
  }

  const rows = [...fills, ...gaps].sort((a, b) =>
    a.species.localeCompare(b.species) || a.field.localeCompare(b.field));
  mkdirSync(dirname(options.report), { recursive: true });
  writeFileSync(options.report, toCsv(REPORT_COLUMNS, rows), 'utf8');

  const withEmpty = new Set(rows.map((row) => row.species_id));
  console.log(`${species.length} approved species; ${withEmpty.size} with an empty description, habitat, common name or family.`);
  console.log(`  ${fills.length} empty fields ${options.apply ? 'processed' : 'would be filled with a draft'}; ${gaps.length} left empty (no confident draft).`);
  if (options.apply) {
    const counts = {};
    for (const fill of fills) counts[fill.action] = (counts[fill.action] ?? 0) + 1;
    for (const [action, count] of Object.entries(counts)) console.log(`  ${action}: ${count}`);
  } else {
    console.log('Dry run: nothing was changed. Review the report, then run again with --apply.');
  }
  console.log(`Report: ${options.report}`);
}

// Only run when called as a script (tests import the helpers).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log('node scripts/species-descriptions/fill.mjs [--report FILE] [--apply]   (dry run unless --apply)');
    } else {
      await run(options);
    }
  } catch (error) {
    console.error(`Stopped: ${safe(error)}`);
    process.exitCode = 1;
  }
}

export { parseArguments, unchanged };
