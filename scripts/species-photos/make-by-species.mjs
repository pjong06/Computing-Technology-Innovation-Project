#!/usr/bin/env node
// make-by-species.mjs - one row per species for the officer review page (review.html).
//
// Reads species-photo-review.csv (one row per species + old photo, from lookup-licences.mjs)
// and writes species-photo-review-by-species.csv: one row per species with its best usable
// photo candidates, all with an allowed licence (CC0, CC BY, CC BY-SA).
//
// Candidate order (best first):
//   1. observation photos from Borneo
//   2. the old website's own photo, when its licence is allowed
//   3. the species' own iNaturalist photos (taxon photos)
//   4. observation photos from elsewhere in Malaysia
//   5. observation photos from anywhere
// Duplicates are removed. At most MAX_CANDIDATES per species.
//
// Offline: reads and writes local files only. No network, no secrets, no database.
// Run:  node scripts/species-photos/make-by-species.mjs [--input FILE] [--output FILE]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsvObjects, toCsv } from './csv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_CANDIDATES = 6;
const ALLOWED_LICENCES = new Set(['cc0', 'cc-by', 'cc-by-sa']);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const INPUT = resolve(argument('--input', join(HERE, 'species-photo-review.csv')));
const OUTPUT = resolve(argument('--output', join(HERE, 'species-photo-review-by-species.csv')));

const CANDIDATE_FIELDS = ['id', 'licence', 'attribution', 'photographer', 'url', 'page_url', 'source', 'observation_url'];

// Lower number = shown first.
function rank(source) {
  if (source === 'observation, Borneo') return 1;
  if (source === 'original (old website)') return 2;
  if (source === 'taxon_photo') return 3;
  if (source === 'observation, Malaysia') return 4;
  return 5;
}

if (!existsSync(INPUT)) {
  console.error(`Input file not found: ${INPUT}\nRun lookup-licences.mjs first.`);
  process.exit(1);
}

const rows = parseCsvObjects(readFileSync(INPUT, 'utf8'));
const bySpecies = new Map();

for (const row of rows) {
  if (!row.species_id) continue;
  let species = bySpecies.get(row.species_id);
  if (!species) {
    species = {
      species_id: row.species_id,
      scientific_name: row.scientific_name,
      inat_taxon_id: row.inat_taxon_id,
      old_photo_ids: [],
      reasons: new Set(),
      candidates: new Map(),
    };
    bySpecies.set(row.species_id, species);
  }
  if (!species.inat_taxon_id && row.inat_taxon_id) species.inat_taxon_id = row.inat_taxon_id;
  if (row.original_photo_id) species.old_photo_ids.push(row.original_photo_id);
  species.reasons.add(row.reason);

  const add = candidate => {
    if (!candidate.id || !ALLOWED_LICENCES.has(candidate.licence) || species.candidates.has(candidate.id)) return;
    species.candidates.set(candidate.id, candidate);
  };

  if (row.allowed === 'yes') {
    add({
      id: row.original_photo_id,
      licence: row.original_licence,
      attribution: row.original_attribution,
      photographer: '',
      url: row.original_image_url,
      page_url: row.original_page_url,
      source: 'original (old website)',
      observation_url: '',
    });
  }
  for (const n of [1, 2, 3]) {
    add(Object.fromEntries(CANDIDATE_FIELDS.map(field => [field, row[`alt${n}_${field}`] || ''])));
  }
}

const header = [
  'species_id', 'scientific_name', 'inat_taxon_id', 'old_photo_ids', 'old_photo_reasons', 'candidate_count',
  ...Array.from({ length: MAX_CANDIDATES }, (_, i) => CANDIDATE_FIELDS.map(field => `cand${i + 1}_${field}`)).flat(),
  // Filled in by review.html: the kept photos (a small gallery) and the main one.
  'officer_choice', 'main_choice', 'chosen_photo_ids', 'main_photo_id', 'officer_name', 'officer_notes',
];

const records = [...bySpecies.values()]
  .sort((a, b) => a.scientific_name.localeCompare(b.scientific_name))
  .map(species => {
    // A stable sort keeps lookup order inside each rank.
    const candidates = [...species.candidates.values()]
      .sort((a, b) => rank(a.source) - rank(b.source))
      .slice(0, MAX_CANDIDATES);
    const record = {
      species_id: species.species_id,
      scientific_name: species.scientific_name,
      inat_taxon_id: species.inat_taxon_id,
      old_photo_ids: [...new Set(species.old_photo_ids)].join(';'),
      old_photo_reasons: [...species.reasons].sort().join(';'),
      candidate_count: candidates.length,
    };
    candidates.forEach((candidate, index) => {
      for (const field of CANDIDATE_FIELDS) record[`cand${index + 1}_${field}`] = candidate[field];
    });
    return record;
  });

writeFileSync(OUTPUT, toCsv(header, records));

const withCandidates = records.filter(record => record.candidate_count > 0).length;
console.log(`Read ${rows.length} rows from ${INPUT}`);
console.log(`Wrote ${records.length} species to ${OUTPUT}`);
console.log(`  with at least one candidate: ${withCandidates}`);
console.log(`  with none (need SFC's own photo): ${records.length - withCandidates}`);
