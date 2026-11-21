// recentActivity.ts - Home's "Recent activity": the botanist's own new plants, observations
// and species requests in one list, with the Filter sheet's options, filtering, sorting,
// pills and the "need your action" count.
// Plain TypeScript with no imports, so Node can test it (recentActivity.test.mjs).

export type ActivityType = 'new_plant' | 'observation' | 'species_request';
// Same groups as the Plants tab (src/utils/recordsList.ts).
export type ActivityGroup = 'needs_action' | 'not_uploaded' | 'waiting' | 'approved';

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  new_plant: 'NEW PLANT',
  observation: 'OBSERVATION',
  species_request: 'SPECIES REQUEST',
};

export interface ActivityItem {
  key: string;
  type: ActivityType;
  group: ActivityGroup;
  timestamp: number;
}

// How many rows Home shows before "See all in Plants".
export const RECENT_ACTIVITY_LIMIT = 8;

// ---- Species requests ----

export type SpeciesRequestAction = 'not_added' | 'upload_failed' | null;

// A species request's one status, in the words botanists see:
//   Waiting for review / Added / Not added, or Not uploaded / Upload failed before upload.
// The officer's 'approved' and 'archived' both mean it was added to the species list.
export function speciesRequestStatus(request: { syncStatus: string; review: string | null | undefined }): {
  group: ActivityGroup;
  action: SpeciesRequestAction;
  badge: { label: string; bg: string; text: string };
} {
  if (request.syncStatus === 'Upload failed') {
    return { group: 'needs_action', action: 'upload_failed', badge: { label: 'Upload failed', bg: '#FDE2E2', text: '#9B1C1C' } };
  }
  if (request.syncStatus !== 'Uploaded') {
    return { group: 'not_uploaded', action: null, badge: { label: 'Not uploaded', bg: '#EEF1EF', text: '#4A5A50' } };
  }
  if (request.review === 'rejected') {
    return { group: 'needs_action', action: 'not_added', badge: { label: 'Not added', bg: '#FDE2E2', text: '#9B1C1C' } };
  }
  if (request.review === 'approved' || request.review === 'archived') {
    return { group: 'approved', action: null, badge: { label: 'Added', bg: '#E4F2E7', text: '#215A36' } };
  }
  return { group: 'waiting', action: null, badge: { label: 'Waiting for review', bg: '#E3ECF8', text: '#1F4E8C' } };
}

// ---- The Filter sheet ----

export type ActivityShow = 'all' | 'needs_action' | 'waiting' | 'approved';
export type ActivityTypeFilter = 'all' | ActivityType;
export type ActivitySort = 'newest' | 'oldest';

export interface ActivityFilters {
  show: ActivityShow;
  type: ActivityTypeFilter;
  sort: ActivitySort;
}

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = { show: 'all', type: 'all', sort: 'newest' };

export const ACTIVITY_SHOW_OPTIONS: { value: ActivityShow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs_action', label: 'Needs my action' },
  { value: 'waiting', label: 'Waiting for review' },
  { value: 'approved', label: 'Approved or Added' },
];

export const ACTIVITY_TYPE_OPTIONS: { value: ActivityTypeFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'new_plant', label: 'New plants' },
  { value: 'observation', label: 'Observations' },
  { value: 'species_request', label: 'Species requests' },
];

export const ACTIVITY_SORT_OPTIONS: { value: ActivitySort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

// How many of the three groups differ from the default ("Filter · N").
export function activityFilterCount(filters: ActivityFilters): number {
  return (
    (filters.show !== DEFAULT_ACTIVITY_FILTERS.show ? 1 : 0) +
    (filters.type !== DEFAULT_ACTIVITY_FILTERS.type ? 1 : 0) +
    (filters.sort !== DEFAULT_ACTIVITY_FILTERS.sort ? 1 : 0)
  );
}

// The removable pills under the heading: one per group that is not the default.
export function activityFilterPills(filters: ActivityFilters): { group: keyof ActivityFilters; label: string }[] {
  const label = <T extends string>(options: { value: T; label: string }[], value: T) =>
    options.find((option) => option.value === value)?.label ?? value;
  const pills: { group: keyof ActivityFilters; label: string }[] = [];
  if (filters.show !== DEFAULT_ACTIVITY_FILTERS.show) pills.push({ group: 'show', label: label(ACTIVITY_SHOW_OPTIONS, filters.show) });
  if (filters.type !== DEFAULT_ACTIVITY_FILTERS.type) pills.push({ group: 'type', label: label(ACTIVITY_TYPE_OPTIONS, filters.type) });
  if (filters.sort !== DEFAULT_ACTIVITY_FILTERS.sort) pills.push({ group: 'sort', label: label(ACTIVITY_SORT_OPTIONS, filters.sort) });
  return pills;
}

// Everything that needs the botanist (species requests included).
export function activityNeedsActionCount(items: ActivityItem[]): number {
  return items.filter((item) => item.group === 'needs_action').length;
}

export function filterActivity<T extends ActivityItem>(items: T[], filters: ActivityFilters): T[] {
  const matching = items.filter(
    (item) =>
      (filters.show === 'all' || item.group === filters.show) &&
      (filters.type === 'all' || item.type === filters.type)
  );
  return matching.sort((a, b) =>
    filters.sort === 'oldest' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
  );
}

// "8 items" / "1 item".
export function itemsText(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

// ---- Time ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const twoDigits = (value: number) => String(value).padStart(2, '0');

// "Today 09:42", "Yesterday 16:20", otherwise "19 Nov 15:30" (with the year when it isn't
// this year). The same words as the web Review page.
export function activityTime(value: string | number | null | undefined, now: Date = new Date()): string {
  const date = value === null || value === undefined || value === '' ? null : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return 'Time not recorded';
  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return `${date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`} ${time}`;
}
