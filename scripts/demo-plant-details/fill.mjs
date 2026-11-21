#!/usr/bin/env node
// fill.mjs - fills EMPTY plant detail fields of every active plant with plausible DEMO values
// (lib.mjs), and records exactly what it generated so remove.mjs can take it out again:
//   - plant columns (location note, morphological characteristics, notes): written to the
//     plant, and listed in plants.demo_values;
//   - height, diameter, health, life stage: one approved observation per plant
//     (observations.is_demo = true), dated before today, only with the fields that none of the
//     plant's observations has. Approved, so it never enters the Review queue.
// Values a botanist entered are never changed. No credit or source text is written.
//
// Dry run by default: writes a CSV report (plant, field, old, new) and changes nothing.
//   node scripts/demo-plant-details/fill.mjs [--report FILE] [--observer PROFILE_ID] [--apply]
// --observer: the profile recorded as observer on demo observations of plants that have no
// registering botanist (e.g. imported plants); without it those fields are left empty.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the environment only (never .env).
// Needs supabase/migrations/20261121200000_demo_plant_details.sql.

import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '../species-photos/csv.mjs';
import { OBSERVATION_FIELDS, PLANT_FIELDS, REPORT_COLUMNS, planFill, reportRows } from './lib.mjs';
import { connect, readAll, rest, safe } from './supabase.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArguments(argv) {
  const options = { apply: false, observer: null, report: join(HERE, 'demo-plant-details-report.csv') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--report' || arg === '--observer') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--observer' && !UUID.test(value)) throw new Error('--observer must be a profile id (UUID)');
      if (arg === '--report') options.report = resolve(value);
      else options.observer = value;
      i += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function run(options) {
  connect();
  // The demo columns must exist before anything is written.
  try {
    await rest('plants?select=id,demo_values&limit=1');
    await rest('observations?select=id,is_demo&limit=1');
  } catch {
    if (options.apply) throw new Error('Apply supabase/migrations/20261121200000_demo_plant_details.sql first.');
  }

  const plants = await readAll('plants',
    `id,qr_code_value,registered_by,registered_at,species_id,${PLANT_FIELDS.join(',')}`,
    { deleted_at: 'is.null' });
  const observations = await readAll('observations',
    `id,plant_id,observed_at,${OBSERVATION_FIELDS.join(',')}`, { deleted_at: 'is.null' });
  const species = await readAll('species', 'id,scientific_name,taxonomy(family)', {});
  const observationsByPlant = new Map();
  for (const visit of observations) {
    const list = observationsByPlant.get(visit.plant_id) ?? [];
    list.push(visit);
    observationsByPlant.set(visit.plant_id, list);
  }
  const speciesById = new Map(species.map((item) => [item.id, { scientific_name: item.scientific_name, family: item.taxonomy?.family ?? null }]));

  const plans = planFill(plants, observationsByPlant, speciesById, { observerId: options.observer });
  let rows;
  if (!options.apply) {
    rows = reportRows(plans, 'will fill (dry run)');
  } else {
    rows = [];
    for (const plan of plans) {
      const fields = Object.keys(plan.plantValues);
      let action = 'filled';
      try {
        if (fields.length > 0) {
          // Only while every one of these fields is still empty.
          const stillEmpty = fields.map((field) => `${field}=is.null`).join('&');
          const current = (await rest(`plants?id=eq.${plan.plant.id}&select=demo_values`))[0];
          const updated = await rest(`plants?id=eq.${plan.plant.id}&${stillEmpty}&select=id`, {
            method: 'PATCH',
            body: { ...plan.plantValues, demo_values: { ...(current?.demo_values ?? {}), ...plan.plantValues } },
            prefer: 'return=representation',
          });
          if (!updated.length) action = 'skipped: changed since the report';
        }
        if (plan.observation) {
          await rest('observations', {
            method: 'POST',
            body: { ...plan.observation, client_record_id: randomUUID() },
            prefer: 'return=minimal',
          });
        }
      } catch (error) {
        action = `failed: ${safe(error)}`;
      }
      rows.push(...reportRows([plan], action).map((row) => (row.action.startsWith('skipped: plant has') ? row : { ...row, action })));
    }
  }

  mkdirSync(dirname(options.report), { recursive: true });
  writeFileSync(options.report, toCsv(REPORT_COLUMNS, rows), 'utf8');
  const touched = new Set(rows.map((row) => row.plant_id)).size;
  console.log(`${plants.length} active plants; ${rows.length} empty fields in ${touched} plants ${options.apply ? 'processed' : 'would be filled'}.`);
  if (!options.apply) console.log('Dry run: nothing was changed. Review the report, then run again with --apply.');
  console.log(`Report: ${options.report}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log('node scripts/demo-plant-details/fill.mjs [--report FILE] [--observer PROFILE_ID] [--apply]   (dry run unless --apply)');
    } else {
      await run(options);
    }
  } catch (error) {
    console.error(`Stopped: ${safe(error)}`);
    process.exitCode = 1;
  }
}
