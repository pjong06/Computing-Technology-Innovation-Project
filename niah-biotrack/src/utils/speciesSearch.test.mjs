// Tests for src/utils/speciesSearch.ts (Register plant: the species picker and the species
// request link) and its wiring. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogueMatch, searchSpecies, speciesReady, speciesRequestText } from './speciesSearch.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

const catalogue = [
  { id: 's1', scientific_name: 'Nepenthes ampullaria', common_name: 'Flask-shaped pitcher plant', local_name: 'Periuk kera', taxonomy: { family: 'Nepenthaceae' } },
  { id: 's2', scientific_name: 'Nepenthes rafflesiana', common_name: "Raffles' pitcher plant", local_name: null },
  { id: 's3', scientific_name: 'Licuala orbicularis', common_name: 'Umbrella palm', local_name: 'Daun payung' },
  { id: 's4', scientific_name: 'Begonia niahensis', common_name: null, local_name: null },
];

test('the species picker searches scientific, common and local names, any letter case', () => {
  assert.deepEqual(searchSpecies(catalogue, 'nepenthes').map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(searchSpecies(catalogue, 'PITCHER').map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(searchSpecies(catalogue, 'payung').map((s) => s.id), ['s3']);
  assert.deepEqual(searchSpecies(catalogue, '  periuk   kera ').map((s) => s.id), ['s1']);
  // Names that start with the text come first.
  assert.deepEqual(searchSpecies(catalogue, 'umbrella').map((s) => s.id), ['s3']);
  assert.deepEqual(searchSpecies(catalogue, 'a', 2).length, 2);
  assert.deepEqual(searchSpecies(catalogue, ''), []);
  assert.deepEqual(searchSpecies(catalogue, 'zzz'), []);
});

test('an AI suggestion selects the catalogue species with the same name; otherwise it can be requested', () => {
  assert.equal(catalogueMatch(catalogue, 'nepenthes AMPULLARIA')?.id, 's1');
  assert.equal(catalogueMatch(catalogue, 'Nepenthes  ampullaria ')?.id, 's1');
  assert.equal(catalogueMatch(catalogue, 'Nepenthes mirabilis'), null);
  assert.equal(catalogueMatch(catalogue, ''), null);
});

test('a plant uploads with a catalogue species, or while it waits for its species request', () => {
  assert.equal(speciesReady({ identificationStatus: 'identified', speciesId: 's1' }), true);
  assert.equal(speciesReady({ identificationStatus: 'pending', speciesId: null, speciesRequestId: 'req-1' }), true);
  // "Needs species" draft: no species and no request.
  assert.equal(speciesReady({ identificationStatus: 'pending', speciesId: null }), false);
  assert.equal(speciesReady({ identificationStatus: 'identified', speciesId: null }), false);

  assert.deepEqual(speciesRequestText('Begonia niahensis', { review: 'pending' }), { title: 'Waiting for species request: Begonia niahensis', reason: null });
  assert.deepEqual(speciesRequestText('Begonia niahensis', { review: 'rejected', reviewComment: 'Already in the catalogue.' }),
    { title: 'Species request not added: Begonia niahensis', reason: 'Already in the catalogue.' });
});

test('wiring: no hand-typed species fields; one Species field; request link handed back to the plant', () => {
  const form = read('../../app/new-record.tsx');
  // The hand-typed fields are gone.
  assert.doesNotMatch(form, />Scientific name \*</);
  assert.doesNotMatch(form, />Common name</);
  assert.doesNotMatch(form, />Family</);
  assert.doesNotMatch(form, /setScientificName|setCommonName|setFamily/);
  assert.match(form, /<Text style=\{styles\.fieldLabel\}>Species \*<\/Text>/);
  assert.match(form, /onRequestNew=\{\(typed\) => requestNewSpecies\(\{ scientificName: typed \}\)\}/);
  // An AI suggestion not in the catalogue: "Request this species".
  assert.match(form, /Request this species: \{requestableSuggestion\.scientificName\}/);
  // Saved: the catalogue species (species_id), or the request the plant waits for.
  assert.match(form, /speciesId: approvedSpecies\?\.id \?\? null,/);
  assert.match(form, /speciesRequestId: waitingRequest\?\.id \?\? null,/);
  assert.match(form, /identificationStatus: approvedSpecies\s*\? IdentificationStatus\.IDENTIFIED\s*: IdentificationStatus\.PENDING,/);
  // The request form, opened from the plant, hands the new request back.
  assert.match(read('../../app/propose-species.tsx'), /if \(forPlant === '1'\) setPendingPlantLink\(\{ id: proposal\.id, scientificName: proposal\.scientificName \}\);/);
  assert.match(form, /setLinkedRequest\(takePendingPlantLink\);\s*setPendingPlantLink\(null\);/);
  // The picker shows the chosen species read-only (scientific, common, family) with Change.
  const picker = read('../components/SpeciesPicker.tsx');
  assert.match(picker, /searchSpecies\(species, query, MAX_RESULTS\)/);
  assert.match(picker, /Family: \{family\}/);
  assert.match(picker, /Species not in the list\? <Text style=\{styles\.requestLink\}>Request a new species<\/Text>/);
  // Sync payloads keep species_id; the request link goes on its own call once uploaded.
  assert.match(read('../services/offlineRecordRepository.ts'), /species_id: record\.speciesId,/);
  assert.match(read('../services/speciesRequestLink.ts'), /`\/api\/plants\/\$\{encodeURIComponent\(record\.serverId as string\)\}\/species-request`/);
  const store = read('../store/useRecordStore.ts');
  assert.match(store, /await linkSpeciesRequest\(\s*refreshed\s*\)/);
  assert.match(store, /needsSpeciesRequestLink\(\s*record\s*\) \|\|/);
});
