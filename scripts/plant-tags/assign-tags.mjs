#!/usr/bin/env node
// assign-tags.mjs - finds active plants whose tag isn't a physical NIAH-PLT-<5 digits> tag
// and writes a CSV report (plant id, old tag, new tag, why tag lookup fails for it).
//
// Dry run only for now. Giving these plants real tags "through the existing tag functions"
// isn't possible from a script: reserve_plant_tags and attach_reserved_plant_tag only work
// for the signed-in botanist who owns the plant, and the plants_require_reserved_tag trigger
// refuses any other writer (supabase/migrations/20261031090000_tag_reservations.sql). The
// service-role key has no auth.uid(), so both are refused. --apply therefore stops and says
// so; see README.md for the options.
//
// Run from the repo root (Node 18+):
//   node scripts/plant-tags/assign-tags.mjs [--report FILE]
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the environment only (never .env).
// Needs SELECT on public.plants for the service role
// (supabase/migrations/20261121130000_service_role_read_plants.sql).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '../species-photos/csv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAG_PATTERN = /^NIAH-PLT-\d{5}$/;
const PAGE = 1000;
const REPORT_COLUMNS = ['plant_id', 'old_tag', 'new_tag', 'kind', 'plant_status', 'data_source', 'registered_at', 'why_lookup_fails', 'action'];

let serviceRoleKey = '';

// The same rule as normalizePlantTag (backend) and parseTagCode (app).
export function normalizePlantTag(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (value.includes('/')) value = value.split('/').pop() || '';
  const match = /^NIAHPLT(\d{5})$/.exec(value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  return match ? `NIAH-PLT-${match[1]}` : null;
}

// What kind of tag this is, and why looking it up by tag fails.
export function classifyTag(tag) {
  const value = typeof tag === 'string' ? tag.trim() : '';
  if (value === '') {
    return { kind: 'no tag', why: 'There is no tag to scan or type, so a tag lookup can never find this plant.' };
  }
  if (/^plant:/i.test(value)) {
    return {
      kind: 'placeholder',
      why: 'A "plant:<id>" placeholder given when the plant was registered without a physical tag (waiting for ' +
        '"Attach tag"). No QR code carries it, and GET /api/plants/tag/:tag only accepts NIAH-PLT-00000, so a ' +
        'lookup answers 400 "Tag code must follow NIAH-PLT-00001 format".',
    };
  }
  if (TAG_PATTERN.test(value)) return { kind: 'ok', why: '' };
  const normal = normalizePlantTag(value);
  if (normal) {
    return {
      kind: 'non-standard spelling',
      why: `Stored as "${value}" instead of "${normal}". A lookup now normalises what is typed to ${normal}, ` +
        'which still does not match the stored value exactly.',
    };
  }
  return {
    kind: 'other format',
    why: 'Not NIAH-PLT-<5 digits>; GET /api/plants/tag/:tag refuses it (400) and no printed QR code carries it.',
  };
}

function parseArguments(argv) {
  const options = { apply: false, report: join(HERE, 'plant-tags-report.csv') };
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

async function readActivePlants() {
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
  const plants = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      select: 'id,qr_code_value,plant_status,data_source,registered_at',
      deleted_at: 'is.null',
      order: 'registered_at.asc,id.asc',
      limit: String(PAGE),
      offset: String(offset),
    });
    const response = await fetch(new URL(`rest/v1/plants?${params}`, root), {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Supabase answered HTTP ${response.status}`);
    const page = await response.json();
    plants.push(...page);
    if (page.length < PAGE) break;
  }
  return plants;
}

const safe = (error) => {
  let message = error instanceof Error ? error.message : String(error);
  if (serviceRoleKey) message = message.split(serviceRoleKey).join('[REDACTED]');
  return message.slice(0, 300);
};

async function run(options) {
  if (options.apply) {
    throw new Error(
      '--apply is not available: the tag functions only work for the signed-in botanist who owns each plant, ' +
      'and the service-role key is refused by them and by the plants_require_reserved_tag trigger. ' +
      'See scripts/plant-tags/README.md for the options.'
    );
  }
  const plants = await readActivePlants();
  const rows = [];
  for (const plant of plants) {
    const { kind, why } = classifyTag(plant.qr_code_value);
    if (kind === 'ok') continue;
    rows.push({
      plant_id: plant.id,
      old_tag: plant.qr_code_value ?? '',
      new_tag: '',
      kind,
      plant_status: plant.plant_status ?? '',
      data_source: plant.data_source ?? '',
      registered_at: plant.registered_at ?? '',
      why_lookup_fails: why,
      action: 'needs a tag (not assigned: dry run)',
    });
  }
  mkdirSync(dirname(options.report), { recursive: true });
  const totals = {};
  for (const row of rows) totals[row.kind] = (totals[row.kind] ?? 0) + 1;
  writeFileSync(options.report, toCsv(REPORT_COLUMNS, [
    ...rows,
    ...Object.entries(totals).map(([kind, count]) => ({ plant_id: 'TOTAL', kind, action: String(count) })),
    { plant_id: 'TOTAL', kind: 'active plants checked', action: String(plants.length) },
  ]), 'utf8');
  console.log(`${plants.length} active plants checked; ${rows.length} without a NIAH-PLT tag.`);
  for (const [kind, count] of Object.entries(totals)) console.log(`  ${kind}: ${count}`);
  console.log(`Report: ${options.report}`);
}

// Only run when called as a script (tests import the helpers).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log('node scripts/plant-tags/assign-tags.mjs [--report FILE]   (dry run: lists plants without a NIAH-PLT tag)');
    } else {
      await run(options);
    }
  } catch (error) {
    console.error(`Stopped: ${safe(error)}`);
    process.exitCode = 1;
  }
}
