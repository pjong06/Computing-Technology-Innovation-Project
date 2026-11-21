#!/usr/bin/env node
// remove.mjs - takes out exactly what fill.mjs generated, and nothing else:
//   - every observation with is_demo = true is deleted;
//   - for each plant with demo_values: each listed plant column that still holds exactly the
//     generated value is emptied again (a value someone changed since is kept), then
//     demo_values is cleared.
// Dry run by default: writes a CSV report and changes nothing.
//   node scripts/demo-plant-details/remove.mjs [--report FILE] [--apply]
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the environment only (never .env).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '../species-photos/csv.mjs';
import { PLANT_FIELDS, planRemoval } from './lib.mjs';
import { connect, readAll, rest, safe } from './supabase.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REMOVE_COLUMNS = ['kind', 'id', 'tag', 'field', 'value', 'action'];

export function parseArguments(argv) {
  const options = { apply: false, report: join(HERE, 'demo-plant-details-removal-report.csv') };
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

// The report lines for a removal plan.
export function removalRows({ plantResets, observationIds }, action) {
  const rows = observationIds.map((id) => ({ kind: 'demo observation', id, tag: '', field: '', value: '', action }));
  for (const { plant, reset, kept } of plantResets) {
    for (const field of Object.keys(reset)) {
      rows.push({ kind: 'plant field', id: plant.id, tag: plant.qr_code_value ?? '', field, value: plant[field] ?? '', action });
    }
    for (const field of Object.keys(kept)) {
      rows.push({ kind: 'plant field', id: plant.id, tag: plant.qr_code_value ?? '', field, value: plant[field] ?? '',
        action: 'kept: changed since it was generated' });
    }
  }
  return rows;
}

async function run(options) {
  connect();
  const plants = await readAll('plants', `id,qr_code_value,demo_values,${PLANT_FIELDS.join(',')}`, { demo_values: 'not.is.null' });
  const demoObservations = await readAll('observations', 'id,plant_id,is_demo', { is_demo: 'is.true' });
  const plan = planRemoval(plants, demoObservations);
  const rows = removalRows(plan, options.apply ? 'removed' : 'will remove (dry run)');

  if (options.apply) {
    for (const id of plan.observationIds) {
      try {
        // is_demo=is.true in the filter too: never deletes anything else.
        await rest(`observations?id=eq.${id}&is_demo=is.true`, { method: 'DELETE', prefer: 'return=minimal' });
      } catch (error) {
        for (const row of rows) if (row.id === id) row.action = `failed: ${safe(error)}`;
      }
    }
    for (const { plant, reset } of plan.plantResets) {
      try {
        // Each field only while it still holds the generated value.
        for (const field of Object.keys(reset)) {
          await rest(`plants?id=eq.${plant.id}&${field}=eq.${encodeURIComponent(plant.demo_values[field])}`, {
            method: 'PATCH', body: { [field]: null }, prefer: 'return=minimal',
          });
        }
        await rest(`plants?id=eq.${plant.id}`, { method: 'PATCH', body: { demo_values: null }, prefer: 'return=minimal' });
      } catch (error) {
        for (const row of rows) if (row.id === plant.id) row.action = `failed: ${safe(error)}`;
      }
    }
  }

  mkdirSync(dirname(options.report), { recursive: true });
  writeFileSync(options.report, toCsv(REMOVE_COLUMNS, rows), 'utf8');
  console.log(`${plan.observationIds.length} demo observations and ${plan.plantResets.length} plants with demo values ${options.apply ? 'processed' : 'found'}.`);
  if (!options.apply) console.log('Dry run: nothing was changed. Review the report, then run again with --apply.');
  console.log(`Report: ${options.report}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log('node scripts/demo-plant-details/remove.mjs [--report FILE] [--apply]   (dry run unless --apply)');
    } else {
      await run(options);
    }
  } catch (error) {
    console.error(`Stopped: ${safe(error)}`);
    process.exitCode = 1;
  }
}
