#!/usr/bin/env node
// remove.mjs - takes out exactly what fill.mjs generated, and nothing else:
//   - every observation with is_demo = true is deleted;
//   - for each plant with demo_values: each listed plant column that still holds exactly the
//     generated value is emptied again (a value someone changed since is kept);
//   - demo coordinates: the location (and its GPS accuracy) is emptied again if the plant is
//     still at the generated point; a plant moved since keeps its location;
//   - then demo_values is cleared.
// Dry run by default: writes a CSV report and changes nothing.
//   node scripts/demo-plant-details/remove.mjs [--report FILE] [--apply]
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the environment only (never .env).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '../species-photos/csv.mjs';
import { PLANT_FIELDS, planRemoval, samePoint } from './lib.mjs';
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
    // The location is shown as "latitude, longitude" (the column itself is PostGIS).
    const shown = (field) => (field === 'location' ? `${plant.latitude ?? ''}, ${plant.longitude ?? ''}` : plant[field] ?? '');
    for (const field of Object.keys(reset)) {
      rows.push({ kind: 'plant field', id: plant.id, tag: plant.qr_code_value ?? '', field, value: shown(field), action });
    }
    for (const field of Object.keys(kept)) {
      rows.push({ kind: 'plant field', id: plant.id, tag: plant.qr_code_value ?? '', field, value: shown(field),
        action: 'kept: changed since it was generated' });
    }
  }
  return rows;
}

async function run(options) {
  connect();
  const plantRows = await readAll('plants', `id,qr_code_value,demo_values,gps_accuracy_m,${PLANT_FIELDS.join(',')}`,
    { demo_values: 'not.is.null' });
  // Current coordinates as numbers (plants.location itself comes back from the REST API as hex).
  const points = new Map((await readAll('plant_map_points', 'id,latitude,longitude', {})).map((point) => [point.id, point]));
  const plants = plantRows.map((plant) => ({
    ...plant, latitude: points.get(plant.id)?.latitude ?? null, longitude: points.get(plant.id)?.longitude ?? null,
  }));
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
        for (const field of Object.keys(reset).filter((name) => PLANT_FIELDS.includes(name))) {
          await rest(`plants?id=eq.${plant.id}&${field}=eq.${encodeURIComponent(plant.demo_values[field])}`, {
            method: 'PATCH', body: { [field]: null }, prefer: 'return=minimal',
          });
        }
        if ('location' in reset) {
          // A REST filter can't reliably compare PostGIS values, so check the point once more
          // just before emptying it: a plant moved since the report keeps its location.
          const generated = plant.demo_values.coordinates;
          const now = (await rest(`plant_map_points?id=eq.${plant.id}&select=latitude,longitude`))[0];
          if (now && samePoint(now, generated)) {
            await rest(`plants?id=eq.${plant.id}`, { method: 'PATCH', body: { location: null }, prefer: 'return=minimal' });
            if ('gps_accuracy_m' in reset) {
              await rest(`plants?id=eq.${plant.id}&gps_accuracy_m=eq.${generated.gps_accuracy_m}`, {
                method: 'PATCH', body: { gps_accuracy_m: null }, prefer: 'return=minimal',
              });
            }
          } else {
            for (const row of rows) {
              if (row.id === plant.id && (row.field === 'location' || row.field === 'gps_accuracy_m')) {
                row.action = 'kept: changed since the report';
              }
            }
          }
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
