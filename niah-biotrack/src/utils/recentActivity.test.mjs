// Tests for src/utils/recentActivity.ts (Home's "Recent activity"). Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_TYPE_LABELS,
  DEFAULT_ACTIVITY_FILTERS,
  RECENT_ACTIVITY_LIMIT,
  activityFilterCount,
  activityFilterPills,
  activityNeedsActionCount,
  activityTime,
  filterActivity,
  itemsText,
  speciesRequestStatus,
} from './recentActivity.ts';

const item = (key, type, group, timestamp) => ({ key, type, group, timestamp });
const items = [
  item('p1', 'new_plant', 'waiting', 5),
  item('o1', 'observation', 'needs_action', 7),
  item('r1', 'species_request', 'needs_action', 9),   // a request that was not added
  item('r2', 'species_request', 'approved', 1),       // added
  item('o2', 'observation', 'approved', 3),
  item('p2', 'new_plant', 'not_uploaded', 8),
];

test('three kinds of row, labelled NEW PLANT / OBSERVATION / SPECIES REQUEST; 8 shown', () => {
  assert.deepEqual(ACTIVITY_TYPE_LABELS, {
    new_plant: 'NEW PLANT', observation: 'OBSERVATION', species_request: 'SPECIES REQUEST',
  });
  assert.equal(RECENT_ACTIVITY_LIMIT, 8);
});

test('species request statuses: Waiting for review / Added / Not added (and before upload)', () => {
  assert.deepEqual(
    ['pending', 'approved', 'archived', 'rejected'].map((review) => speciesRequestStatus({ syncStatus: 'Uploaded', review }).badge.label),
    ['Waiting for review', 'Added', 'Added', 'Not added']
  );
  const notAdded = speciesRequestStatus({ syncStatus: 'Uploaded', review: 'rejected' });
  assert.equal(notAdded.group, 'needs_action');
  assert.equal(notAdded.action, 'not_added');
  assert.equal(speciesRequestStatus({ syncStatus: 'Uploaded', review: 'approved' }).group, 'approved');
  assert.equal(speciesRequestStatus({ syncStatus: 'Not uploaded', review: 'pending' }).badge.label, 'Not uploaded');
  const failed = speciesRequestStatus({ syncStatus: 'Upload failed', review: 'pending' });
  assert.equal(failed.badge.label, 'Upload failed');
  assert.equal(failed.group, 'needs_action');
});

test('default: everything, newest first; the action count includes species requests', () => {
  assert.deepEqual(DEFAULT_ACTIVITY_FILTERS, { show: 'all', type: 'all', sort: 'newest' });
  assert.deepEqual(filterActivity([...items], DEFAULT_ACTIVITY_FILTERS).map((i) => i.key), ['r1', 'p2', 'o1', 'p1', 'o2', 'r2']);
  assert.equal(activityNeedsActionCount(items), 2);
  assert.equal(itemsText(2), '2 items');
  assert.equal(itemsText(1), '1 item');
});

test('filters: Show, Type and Sort, combined', () => {
  const run = (filters) => filterActivity([...items], { ...DEFAULT_ACTIVITY_FILTERS, ...filters }).map((i) => i.key);
  assert.deepEqual(run({ show: 'needs_action' }), ['r1', 'o1']);
  assert.deepEqual(run({ show: 'waiting' }), ['p1']);
  assert.deepEqual(run({ show: 'approved' }), ['o2', 'r2'], 'Approved or Added');
  assert.deepEqual(run({ type: 'species_request' }), ['r1', 'r2']);
  assert.deepEqual(run({ type: 'new_plant', sort: 'oldest' }), ['p1', 'p2']);
  assert.deepEqual(run({ show: 'needs_action', type: 'observation' }), ['o1']);
});

test('"Filter · N" counts the changed groups; pills name them', () => {
  assert.equal(activityFilterCount(DEFAULT_ACTIVITY_FILTERS), 0);
  const filters = { show: 'needs_action', type: 'species_request', sort: 'oldest' };
  assert.equal(activityFilterCount(filters), 3);
  assert.deepEqual(activityFilterPills(filters), [
    { group: 'show', label: 'Needs my action' },
    { group: 'type', label: 'Species requests' },
    { group: 'sort', label: 'Oldest first' },
  ]);
  assert.deepEqual(activityFilterPills({ ...DEFAULT_ACTIVITY_FILTERS, show: 'approved' }), [{ group: 'show', label: 'Approved or Added' }]);
});

test('relative time: Today / Yesterday / "19 Nov 15:30"', () => {
  const now = new Date(2026, 10, 21, 18, 0);
  assert.equal(activityTime(new Date(2026, 10, 21, 9, 42).toISOString(), now), 'Today 09:42');
  assert.equal(activityTime(new Date(2026, 10, 20, 16, 20).toISOString(), now), 'Yesterday 16:20');
  assert.equal(activityTime(new Date(2026, 10, 19, 15, 30).toISOString(), now), '19 Nov 15:30');
  assert.equal(activityTime(new Date(2025, 11, 30, 8, 5).toISOString(), now), '30 Dec 2025 08:05');
  assert.equal(activityTime(null, now), 'Time not recorded');
  assert.equal(activityTime('not a date', now), 'Time not recorded');
});
