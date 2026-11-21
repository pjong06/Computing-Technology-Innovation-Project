// Tests for src/utils/recordsList.ts (the botanist Plants tab). Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_FILTERS,
  SHOW_FILTERS,
  SORT_ORDERS,
  STATUS_FILTERS,
  activeFilterCount,
  activeFilterPills,
  filterAndSortPlants,
  listSummary,
  mergePlants,
  mostUrgent,
  plantKey,
  needsActionCount,
  proposalOutcome,
  rowStatus,
  syncStatusText,
} from './recordsList.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8');

test('every plant or visit falls into one status group; Needs action covers the four problems', () => {
  const up = 'Uploaded';
  assert.deepEqual(rowStatus({ syncStatus: 'Upload failed', outcome: 'pending' }), { group: 'needs_action', action: 'upload_failed' });
  assert.deepEqual(rowStatus({ syncStatus: 'Local only', outcome: 'not_submitted', needsSpecies: true }), { group: 'needs_action', action: 'needs_species' });
  assert.deepEqual(rowStatus({ syncStatus: up, outcome: 'rejected' }), { group: 'needs_action', action: 'needs_changes' });
  assert.deepEqual(rowStatus({ syncStatus: up, outcome: 'not_submitted' }), { group: 'needs_action', action: 'not_submitted' });
  assert.deepEqual(rowStatus({ syncStatus: up, outcome: 'pending' }), { group: 'waiting', action: null });
  assert.deepEqual(rowStatus({ syncStatus: up, outcome: 'approved' }), { group: 'approved', action: null });
  assert.deepEqual(rowStatus({ syncStatus: 'Not uploaded', outcome: 'pending' }), { group: 'not_uploaded', action: null });
  assert.equal(proposalOutcome('archived'), 'approved');
  assert.equal(proposalOutcome('rejected'), 'rejected');
  assert.equal(proposalOutcome('pending'), 'pending');
});

test('a plant shows its most urgent status (the plant or one of its visits)', () => {
  const pick = (groups) => mostUrgent(groups.map((group) => ({ group })))?.index;
  assert.equal(pick(['approved', 'waiting']), 1);
  assert.equal(pick(['approved', 'waiting', 'needs_action']), 2);
  assert.equal(pick(['waiting', 'not_uploaded']), 1);
  assert.equal(pick(['needs_action', 'needs_action']), 0); // first wins a tie
  assert.equal(mostUrgent([]), null);
});

const rows = [
  { key: 'a', mine: true, timestamp: 3, name: 'Shorea', group: 'needs_action', searchText: 'Shorea Meranti NIAH-PLT-00001' },
  { key: 'b', mine: true, timestamp: 5, name: 'Nepenthes', group: 'waiting', searchText: 'Nepenthes pitcher NIAH-PLT-00002' },
  { key: 'c', mine: false, timestamp: 1, name: 'Ardisia', group: 'approved', searchText: 'Ardisia NIAH-PLT-00003' },
  { key: 'd', mine: true, timestamp: 4, name: 'Ardisia', group: 'not_uploaded', searchText: 'Ardisia Big one' },
  { key: 'e', mine: true, timestamp: 2, name: 'Begonia', group: 'approved', searchText: 'Begonia' },
];
const keys = (list) => list.map((row) => row.key);

test('default: All plants, Any status, Newest first', () => {
  assert.deepEqual(DEFAULT_FILTERS, { show: 'all', status: 'any', sort: 'newest' });
  assert.deepEqual(keys(filterAndSortPlants(rows, DEFAULT_FILTERS, '')), ['b', 'd', 'a', 'e', 'c']);
  assert.equal(activeFilterCount(DEFAULT_FILTERS), 0);
  assert.deepEqual(activeFilterPills(DEFAULT_FILTERS), []);
});

test('filters: Show, Status and search (scientific, common and plant name, tag) combine', () => {
  const mine = { ...DEFAULT_FILTERS, show: 'mine' };
  assert.deepEqual(keys(filterAndSortPlants(rows, mine, '')), ['b', 'd', 'a', 'e']);
  assert.deepEqual(keys(filterAndSortPlants(rows, { ...DEFAULT_FILTERS, status: 'approved' }, '')), ['e', 'c']);
  assert.deepEqual(keys(filterAndSortPlants(rows, { ...mine, status: 'approved' }, '')), ['e']);
  assert.deepEqual(keys(filterAndSortPlants(rows, { ...DEFAULT_FILTERS, status: 'needs_action' }, '')), ['a']);
  assert.deepEqual(keys(filterAndSortPlants(rows, DEFAULT_FILTERS, 'niah-plt-00003')), ['c']);
  assert.deepEqual(keys(filterAndSortPlants(rows, DEFAULT_FILTERS, ' meranti ')), ['a']);
  assert.deepEqual(keys(filterAndSortPlants(rows, DEFAULT_FILTERS, 'big one')), ['d']);
  // Needs my action counts the botanist's own plants only.
  assert.equal(needsActionCount([...rows, { ...rows[0], key: 'x', mine: false }]), 1);
});

test('sort: Species A-Z (then newest); the input list is not changed', () => {
  const az = filterAndSortPlants(rows, { ...DEFAULT_FILTERS, sort: 'species' }, '');
  assert.deepEqual(keys(az), ['d', 'c', 'e', 'b', 'a']);
  assert.deepEqual(keys(rows), ['a', 'b', 'c', 'd', 'e']);
});

test('Filter button count, removable pills and the summary line', () => {
  const filters = { show: 'mine', status: 'needs_action', sort: 'species' };
  assert.equal(activeFilterCount(filters), 3);
  assert.deepEqual(activeFilterPills(filters), [
    { group: 'show', label: 'My plants' },
    { group: 'status', label: 'Needs my action' },
    { group: 'sort', label: 'Species A-Z' },
  ]);
  assert.equal(listSummary(34, 'newest'), '34 plants · newest first');
  assert.equal(listSummary(1, 'species'), '1 plant · species A-Z');
  assert.deepEqual(SHOW_FILTERS.map((o) => o.label), ['All plants', 'My plants']);
  assert.deepEqual(STATUS_FILTERS.map((o) => o.label), ['Any status', 'Needs my action', 'Waiting for review', 'Approved']);
  assert.deepEqual(SORT_ORDERS.map((o) => o.label), ['Newest first', 'Species A-Z']);
});

test('sync line: "N not uploaded", otherwise how long ago the last sync was', () => {
  const now = Date.parse('2026-11-21T10:00:00Z');
  assert.equal(syncStatusText('2026-11-21T09:58:00Z', 0, now), 'Synced 2 min ago');
  assert.equal(syncStatusText('2026-11-21T09:59:40Z', 0, now), 'Synced just now');
  assert.equal(syncStatusText('2026-11-21T07:00:00Z', 0, now), 'Synced 3 h ago');
  assert.equal(syncStatusText('2026-11-19T10:00:00Z', 0, now), 'Synced 2 days ago');
  assert.equal(syncStatusText(null, 0, now), 'Not synced yet');
  assert.equal(syncStatusText('2026-11-21T09:58:00Z', 4, now), '4 not uploaded');
});

test('tab bar: Home, Plants (route records, leaf icon), Scan, Tasks, Profile for staff', () => {
  const layout = read('../../app/(tabs)/_layout.tsx');
  const order = Array.from(layout.matchAll(/name="(\w+)"\s*\r?\n\s*options/g), (m) => m[1]);
  assert.deepEqual(order, ['home', 'plants', 'records', 'scan', 'tasks', 'profile']);
  assert.match(layout, /name="records"\s*options=\{\{\s*title: 'Plants',\s*href: isVisitor \? null : undefined,\s*tabBarIcon: \(\{ color \}\) => \(\s*<Ionicons name="leaf-outline"/);
  // Visitors keep their own Plants tab; staff never see it.
  assert.match(layout, /name="plants"\s*options=\{\{\s*title: 'Plants',\s*href: isVisitor \? undefined : null,/);
  assert.equal(fs.existsSync(path.join(here, '../../app/(tabs)/species.tsx')), false);
});

test('Plants screen: plants only, Filter sheet, pills, banner, Register at the end; no chip rows', () => {
  const screen = read('../../app/(tabs)/records.tsx');
  for (const needed of [
    '>Plants<',
    'Search plant or species',
    'Sync now',
    '<FilterButton count={filterCount} onPress={openSheet} />',
    '<FilterPills',
    '<FilterSheet',
    "applyLabel={`Show ${draftCount} ${draftCount === 1 ? 'plant' : 'plants'}`}",
    "'plants needs' : 'plants need'",
    'Show the plants that need your action',
    '+ Register plant',
    'usePlantListStore',
  ]) {
    assert.ok(screen.includes(needed), needed);
  }
  // The sheet, pills and button are the shared ones (also used by Home's Recent activity).
  const sheet = read('../components/FilterSheet.tsx');
  assert.match(sheet, /<Modal[^>]*animationType="slide"/);
  for (const needed of ['Reset', 'Remove filter', 'Filter ·']) assert.ok(sheet.includes(needed), needed);
  assert.match(screen, /status: 'needs_action', show: 'mine'/);
  // No visit or species-proposal rows, no chip rows.
  assert.doesNotMatch(screen, /<ScrollView\s*horizontal/);
  assert.doesNotMatch(screen, /useProposalStore\(\(state\) => state\.proposals\)/);
  assert.doesNotMatch(screen, /'\+ Propose species'|>\+ Propose species</);
});

test('Home: one "Recent activity" list (new plants, observations, species requests); visits show their status in Plant detail', () => {
  const home = read('../../app/(tabs)/home.tsx');
  assert.match(home, /<RecentActivity/);
  assert.doesNotMatch(home, /MyProposals|My species proposals|Recent Field Records/);
  assert.match(home, /router\.push\('\/propose-species'\)/);
  assert.match(home, />Request a new species</);
  assert.equal(fs.existsSync(path.join(here, '../components/MyProposals.tsx')), false);
  const activity = read('../components/RecentActivity.tsx');
  for (const needed of ['Recent activity', 'Edit and resend', 'Dismiss', 'Retry upload', 'See all in Plants',
    "need your action", '<FilterSheet', '<FilterPills', 'variant="inline"', 'RECENT_ACTIVITY_LIMIT']) {
    assert.ok(activity.includes(needed), needed);
  }
  const detail = read('../../app/plant-detail.tsx');
  assert.match(detail, /visitStatus\(observation, matched\.syncError\)/);
  assert.match(detail, /\+ Add plant of this species/);
});

test('other botanists\' plants: approved only, never coordinates', () => {
  const service = read('../services/approvedPlants.ts');
  assert.match(service, /apiFetch<PlantListResponse>\(`\/api\/plants\?page=\$\{page\}`\)/);
  assert.match(service, /plant_status\?\.toLowerCase\(\) !== 'approved'/);
  assert.doesNotMatch(service, /latitude|longitude|gps/i);
  // A scanned plant registered by someone else is marked, so it is not counted as "My plants".
  assert.match(read('../services/tagLookup.ts'), /otherBotanist: !data\.registered_by/);
});

test('merging: a local plant and the same plant from the server give one row (the local one)', () => {
  const local = [{ plant: { name: 'mine' }, identity: { serverId: 'S1', localId: 'L1', tagCode: 'NIAH-PLT-00001' } }];
  const server = [{ plant: { name: 'from server' }, identity: { serverId: 'S1', tagCode: 'NIAH-PLT-00001' } }];
  const merged = mergePlants(local, server);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'local');
  assert.equal(merged[0].plant.name, 'mine');
  assert.equal(merged[0].key, 'plant:S1');
});

test('merging: matches by tag when the phone copy has no server id yet; drops repeats and bad entries', () => {
  const local = [
    { plant: { n: 1 }, identity: { localId: 'L1', tagCode: 'niah-plt-00002' } },
    { plant: { n: 2 }, identity: { localId: 'L1' } }, // the same phone record twice
    { plant: { n: 3 }, identity: {} }, // nothing to identify it by
    null,
    { plant: undefined, identity: { localId: 'L9' } },
  ];
  const server = [
    { plant: { n: 4 }, identity: { serverId: 'S2', tagCode: 'NIAH-PLT-00002' } }, // same plant as L1, by tag
    { plant: { n: 5 }, identity: { serverId: 'S3', tagCode: 'NIAH-PLT-00003' } },
    { plant: { n: 6 }, identity: { serverId: 'S3', tagCode: 'NIAH-PLT-00003' } }, // repeated across server pages
    { plant: { n: 7 }, identity: { serverId: 'S4', tagCode: null } },
  ];
  const merged = mergePlants(local, server);
  assert.deepEqual(merged.map((row) => row.plant.n), [1, 5, 7]);
  assert.deepEqual(merged.map((row) => row.key), ['plant:L1', 'plant:S3', 'plant:S4']);
});

test('no two rows share a key, and every key is a non-empty "plant:" string', () => {
  const local = Array.from({ length: 30 }, (_, i) => ({
    plant: i,
    identity: { serverId: i % 3 === 0 ? 'S' + i : null, localId: 'L' + (i % 25), tagCode: i % 2 ? 'NIAH-PLT-' + String(i % 10).padStart(5, '0') : null },
  }));
  const server = Array.from({ length: 30 }, (_, i) => ({
    plant: 100 + i,
    identity: { serverId: 'S' + (i % 20), tagCode: 'NIAH-PLT-' + String(i % 12).padStart(5, '0') },
  }));
  const keys = mergePlants(local, server).map((row) => row.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^plant:\S+$/);
  assert.equal(plantKey({ serverId: ' ', localId: '', tagCode: null }), null);
  assert.equal(plantKey({ tagCode: 'niah-plt-00001' }), 'plant:NIAH-PLT-00001');
});

test('Plants screen: rows come from mergePlants and the list is keyed by them', () => {
  const screen = read('../../app/(tabs)/records.tsx');
  assert.ok(screen.includes("const merged = mergePlants("));
  assert.ok(screen.includes("keyExtractor={(item) => item.key}"));
  assert.ok(!screen.includes("key: `server:"));
});

test('notes stay empty when the botanist leaves them empty: no filler text', () => {
  const register = read('../../app/new-record.tsx');
  assert.match(register, /notes: morphology\.trim\(\),/);
  assert.doesNotMatch(register, /Initial registration record/);
  const pull = read('../services/serverPull.ts');
  assert.match(pull, /notes: textValue\(payload\.notes\) \?\? existingVisit\?\.notes \?\? '',/);
  assert.doesNotMatch(pull, /Observation downloaded from server/);
});
