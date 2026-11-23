#!/usr/bin/env node
// check.mjs - fills species.conservation_status from the IUCN Red List through the GBIF API
// (no API key), and reports each species' GBIF rank and name spelling.
//
// For every species not archived:
//   1. GET https://api.gbif.org/v1/species/match?name=<name>&kingdom=Plantae
//      accepted only when matchType is EXACT, or FUZZY with confidence >= 95;
//   2. at species level or below only: GET https://api.gbif.org/v1/species/<key>/iucnRedListCategory
//      (the accepted name's key when the match is a synonym).
// Dry run is the default: it only writes the report. --apply fills conservation_status where
// it is empty. A conflict (we have a status that differs from IUCN) is reported and never
// overwritten unless --overwrite-conflicts. --fix-rank writes species.taxon_rank from GBIF.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come from the environment only. --apply and
// --fix-rank need supabase/migrations/20261122180000_service_role_species_status.sql applied.
// See README.md in this folder.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '../species-photos/csv.mjs';
import { connect, readAll, rest, safe } from '../demo-plant-details/supabase.mjs';
import { REPORT_COLUMNS, acceptMatch, isSpeciesLevel, reportRow, totals } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORT = join(HERE, 'species-status-report.csv');
const DEFAULT_CACHE = join(HERE, '.cache');
const GBIF = 'https://api.gbif.org/v1';
// A generic client name only: no personal or project details go to GBIF.
const USER_AGENT = 'species-status-check/1.0';
const MIN_GAP_MS = 1000; // at most one GBIF request per second
const MAX_ATTEMPTS = 4;

let lastRequestAt = 0;

function parseArguments(argv) {
  const options = {
    apply: false,
    overwriteConflicts: false,
    fixRank: false,
    report: DEFAULT_REPORT,
    cache: DEFAULT_CACHE,
    limit: undefined,
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
    else if (arg === '--overwrite-conflicts') options.overwriteConflicts = true;
    else if (arg === '--fix-rank') options.fixRank = true;
    else if (arg === '--report') options.report = resolve(value());
    else if (arg === '--cache') options.cache = resolve(value());
    else if (arg === '--limit') {
      const text = value();
      if (!/^[1-9]\d*$/.test(text)) throw new Error('--limit needs a positive whole number');
      options.limit = Number(text);
    } else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.overwriteConflicts && !options.apply) {
    throw new Error('--overwrite-conflicts only makes sense with --apply');
  }
  return options;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// GBIF JSON for this URL: from the cache, or fetched (one request per second, retried on
// 429/5xx). A 204/404 answer is cached as null (no result).
async function gbifJson(url, options) {
  mkdirSync(options.cache, { recursive: true });
  const file = join(options.cache, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).body;

  for (let attempt = 1; ; attempt += 1) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 204 || response.status === 404) {
      writeFileSync(file, JSON.stringify({ url, body: null }));
      return null;
    }
    if (response.ok) {
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      writeFileSync(file, JSON.stringify({ url, body }));
      return body;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
      await sleep(2000 * attempt);
      continue;
    }
    throw new Error(`GBIF answered HTTP ${response.status} for ${url}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/species-status/check.mjs [--apply] [--overwrite-conflicts] [--fix-rank]
       [--limit N] [--report FILE] [--cache DIR]
Dry run by default: writes the report only.`);
    return;
  }
  connect();

  // Every species that isn't archived (pending requests included: they are reported too,
  // but only fill rows we already have).
  let species = await readAll('species', 'id,scientific_name,conservation_status,taxon_rank,verification_status', {
    verification_status: 'neq.archived',
  });
  if (options.limit) species = species.slice(0, options.limit);
  console.log(`${species.length} species to check (${options.apply ? 'APPLY' : 'dry run'}).`);

  const rows = [];
  for (const [index, item] of species.entries()) {
    const name = String(item.scientific_name ?? '').trim();
    let match = null;
    let iucn = null;
    try {
      if (name) {
        match = await gbifJson(`${GBIF}/species/match?${new URLSearchParams({ name, kingdom: 'Plantae' })}`, options);
      }
      if (acceptMatch(match).ok && isSpeciesLevel(match.rank)) {
        const key = match.acceptedUsageKey ?? match.usageKey;
        iucn = await gbifJson(`${GBIF}/species/${encodeURIComponent(key)}/iucnRedListCategory`, options);
      }
    } catch (error) {
      rows.push({ ...reportRow(item, null, null, options), action: 'error', note: safe(error) });
      continue;
    }
    const row = reportRow(item, match, iucn, options);
    rows.push(row);
    if ((index + 1) % 25 === 0) console.log(`  ${index + 1}/${species.length}`);
  }

  // Writes (only with --apply / --fix-rank). One PATCH per species, only the allowed columns.
  let written = 0;
  if (options.apply || options.fixRank) {
    for (const row of rows) {
      const changes = {};
      if (options.apply && row._status !== undefined) changes.conservation_status = row._status;
      if (options.fixRank && row.rank_action === 'fix') changes.taxon_rank = row.gbif_taxon_rank;
      if (Object.keys(changes).length === 0) continue;
      try {
        await rest(`species?id=eq.${encodeURIComponent(row.species_id)}`, {
          method: 'PATCH',
          body: changes,
          prefer: 'return=minimal',
        });
        written += 1;
        row.note = [row.note, `written: ${Object.keys(changes).join(', ')}`].filter(Boolean).join('; ');
      } catch (error) {
        row.note = [row.note, `not written: ${safe(error)}`].filter(Boolean).join('; ');
      }
    }
  }

  writeFileSync(options.report, toCsv(REPORT_COLUMNS, rows));
  const counts = totals(rows);
  console.log(`Report: ${options.report}`);
  console.log(Object.entries(counts).map(([action, count]) => `${action}: ${count}`).join(' · '));
  const capitalised = rows.filter((row) => row.capitalisation).length;
  if (capitalised) console.log(`${capitalised} name(s) written with the wrong capitals (see the "capitalisation" column).`);
  if (options.apply || options.fixRank) console.log(`${written} species updated.`);
  else console.log('Dry run: nothing was written. Use --apply (and --fix-rank) after reviewing the report.');
}

main().catch((error) => {
  console.error(safe(error));
  process.exitCode = 1;
});
