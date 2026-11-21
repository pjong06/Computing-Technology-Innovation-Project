// recordsList.ts - the botanist Plants tab (app/(tabs)/records.tsx): status groups,
// the Filter sheet's options, search and sort.
// Plain TypeScript with no imports, so Node can test it (src/utils/recordsList.test.mjs).
//
// Each plant gets one status, the most urgent of the plant itself and the botanist's own
// visits to it:
//   Needs my action   - Needs changes (officer sent it back), Not submitted yet,
//                       Upload failed, or Needs species (saved to identify later)
//   Not uploaded      - saved on the phone, not sent yet (only under "Any status")
//   Waiting for review
//   Approved

export type RecordStatusGroup = 'needs_action' | 'waiting' | 'approved' | 'not_uploaded';
export type NeedsActionReason = 'needs_changes' | 'not_submitted' | 'upload_failed' | 'needs_species';
export type ReviewOutcomeValue = 'not_submitted' | 'pending' | 'approved' | 'rejected';

// The sync status words used by the record and proposal stores.
const UPLOADED = 'Uploaded';
const UPLOAD_FAILED = 'Upload failed';

export function rowStatus(input: {
  syncStatus: string;
  outcome: ReviewOutcomeValue;
  needsSpecies?: boolean;
}): { group: RecordStatusGroup; action: NeedsActionReason | null } {
  if (input.syncStatus === UPLOAD_FAILED) return { group: 'needs_action', action: 'upload_failed' };
  if (input.needsSpecies) return { group: 'needs_action', action: 'needs_species' };
  if (input.syncStatus !== UPLOADED) return { group: 'not_uploaded', action: null };
  if (input.outcome === 'rejected') return { group: 'needs_action', action: 'needs_changes' };
  if (input.outcome === 'not_submitted') return { group: 'needs_action', action: 'not_submitted' };
  if (input.outcome === 'approved') return { group: 'approved', action: null };
  return { group: 'waiting', action: null };
}

// A species proposal's review in the same words (archived counts as approved).
export function proposalOutcome(review: string | null | undefined): ReviewOutcomeValue {
  if (review === 'rejected') return 'rejected';
  if (review === 'approved' || review === 'archived') return 'approved';
  return 'pending';
}

const URGENCY: Record<RecordStatusGroup, number> = {
  needs_action: 0,
  not_uploaded: 1,
  waiting: 2,
  approved: 3,
};

// The most urgent of several statuses (the first one wins a tie). Returns the index too,
// so the caller can use that item's badge and reason.
export function mostUrgent<T extends { group: RecordStatusGroup }>(items: T[]): { item: T; index: number } | null {
  let best: { item: T; index: number } | null = null;
  items.forEach((item, index) => {
    if (best === null || URGENCY[item.group] < URGENCY[best.item.group]) best = { item, index };
  });
  return best;
}

// ---- The Filter sheet ----

export type ShowFilter = 'all' | 'mine';
export type StatusFilter = 'any' | 'needs_action' | 'waiting' | 'approved';
export type SortOrder = 'newest' | 'species';

export interface PlantFilters {
  show: ShowFilter;
  status: StatusFilter;
  sort: SortOrder;
}

export const DEFAULT_FILTERS: PlantFilters = { show: 'all', status: 'any', sort: 'newest' };

export const SHOW_FILTERS: { value: ShowFilter; label: string }[] = [
  { value: 'all', label: 'All plants' },
  { value: 'mine', label: 'My plants' },
];

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'any', label: 'Any status' },
  { value: 'needs_action', label: 'Needs my action' },
  { value: 'waiting', label: 'Waiting for review' },
  { value: 'approved', label: 'Approved' },
];

export const SORT_ORDERS: { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'species', label: 'Species A-Z' },
];

// How many of the three groups differ from the default (the number on the Filter button).
export function activeFilterCount(filters: PlantFilters): number {
  return (
    (filters.show !== DEFAULT_FILTERS.show ? 1 : 0) +
    (filters.status !== DEFAULT_FILTERS.status ? 1 : 0) +
    (filters.sort !== DEFAULT_FILTERS.sort ? 1 : 0)
  );
}

// The removable pills under the search box: one per group that is not the default.
export function activeFilterPills(filters: PlantFilters): { group: keyof PlantFilters; label: string }[] {
  const label = <T extends string>(options: { value: T; label: string }[], value: T) =>
    options.find((option) => option.value === value)?.label ?? value;
  const pills: { group: keyof PlantFilters; label: string }[] = [];
  if (filters.show !== DEFAULT_FILTERS.show) pills.push({ group: 'show', label: label(SHOW_FILTERS, filters.show) });
  if (filters.status !== DEFAULT_FILTERS.status) {
    pills.push({ group: 'status', label: label(STATUS_FILTERS, filters.status) });
  }
  if (filters.sort !== DEFAULT_FILTERS.sort) pills.push({ group: 'sort', label: label(SORT_ORDERS, filters.sort) });
  return pills;
}

// ---- The list ----

export interface PlantRow {
  key: string;
  // Registered by this botanist, or has their own visits.
  mine: boolean;
  timestamp: number;
  name: string;
  group: RecordStatusGroup;
  // What the search box looks in: scientific name, common name, plant name and tag.
  searchText: string;
}

// "Needs my action": only the botanist's own plants.
export function needsActionCount(rows: PlantRow[]): number {
  return rows.filter((row) => row.mine && row.group === 'needs_action').length;
}

export function filterAndSortPlants<T extends PlantRow>(rows: T[], filters: PlantFilters, query: string): T[] {
  const words = query.trim().toLowerCase();
  const matching = rows.filter(
    (row) =>
      (filters.show === 'all' || row.mine) &&
      (filters.status === 'any' || (row.group === filters.status && (filters.status !== 'needs_action' || row.mine))) &&
      (words === '' || row.searchText.toLowerCase().includes(words))
  );
  const byNewest = (a: T, b: T) => b.timestamp - a.timestamp;
  if (filters.sort === 'species') {
    return matching.sort((a, b) => a.name.localeCompare(b.name) || byNewest(a, b));
  }
  return matching.sort(byNewest);
}

// "34 plants · newest first"
export function listSummary(count: number, sort: SortOrder): string {
  const order = sort === 'species' ? 'species A-Z' : 'newest first';
  return `${count} ${count === 1 ? 'plant' : 'plants'} · ${order}`;
}

// The sync line next to the title: "N not uploaded" when anything is waiting, otherwise
// "Synced 2 min ago" (or "Not synced yet").
export function syncStatusText(lastSyncIso: string | null, notUploaded: number, now: number): string {
  if (notUploaded > 0) return `${notUploaded} not uploaded`;
  const last = lastSyncIso ? Date.parse(lastSyncIso) : Number.NaN;
  if (Number.isNaN(last)) return 'Not synced yet';
  const minutes = Math.max(0, Math.floor((now - last) / 60000));
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

// ---- One row per plant ----

// What identifies a plant: its server id, else its id on the phone, else its tag code.
export interface PlantIdentity {
  serverId?: string | null;
  localId?: string | null;
  tagCode?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
}

// The row key: "plant:" + server id, else phone id, else tag. null when there is nothing to
// identify the plant by (such a plant can't be listed or opened).
export function plantKey(plant: PlantIdentity): string | null {
  const id = clean(plant.serverId) ?? clean(plant.localId) ?? clean(plant.tagCode)?.toUpperCase() ?? null;
  return id === null ? null : `plant:${id}`;
}

// Puts the plants on the phone and the plants from GET /api/plants into one list with one row
// per plant. The same plant (same server id, phone id or tag) is kept once, and the phone's
// copy wins (it has the visits and the sync state); repeats within either list are dropped
// too. Entries without any identity, or that aren't objects, are left out.
export function mergePlants<L, R>(
  local: { plant: L; identity: PlantIdentity }[],
  server: { plant: R; identity: PlantIdentity }[]
): ({ key: string; source: 'local'; plant: L } | { key: string; source: 'server'; plant: R })[] {
  const seenServer = new Set<string>();
  const seenLocal = new Set<string>();
  const seenTag = new Set<string>();
  const seenKey = new Set<string>();
  const merged: ({ key: string; source: 'local'; plant: L } | { key: string; source: 'server'; plant: R })[] = [];

  const take = <T>(entry: { plant: T; identity: PlantIdentity } | null | undefined): string | null => {
    if (!entry || entry.plant === null || entry.plant === undefined || !entry.identity) return null;
    const serverId = clean(entry.identity.serverId);
    const localId = clean(entry.identity.localId);
    const tag = clean(entry.identity.tagCode)?.toUpperCase() ?? null;
    if (
      (serverId !== null && seenServer.has(serverId)) ||
      (localId !== null && seenLocal.has(localId)) ||
      (tag !== null && seenTag.has(tag))
    ) {
      return null;
    }
    const key = plantKey(entry.identity);
    if (key === null || seenKey.has(key)) return null;
    if (serverId !== null) seenServer.add(serverId);
    if (localId !== null) seenLocal.add(localId);
    if (tag !== null) seenTag.add(tag);
    seenKey.add(key);
    return key;
  };

  for (const entry of local) {
    const key = take(entry);
    if (key !== null) merged.push({ key, source: 'local', plant: entry.plant });
  }
  for (const entry of server) {
    const key = take(entry);
    if (key !== null) merged.push({ key, source: 'server', plant: entry.plant });
  }
  return merged;
}

// ---- "Find plant": one row per plant with coordinates ----

export interface PlantCoordinates {
  latitude: number;
  longitude: number;
}

const validCoordinates = (value: PlantCoordinates | null | undefined): value is PlantCoordinates =>
  Boolean(value) &&
  Number.isFinite(value!.latitude) && Number.isFinite(value!.longitude) &&
  Math.abs(value!.latitude) <= 90 && Math.abs(value!.longitude) <= 180;

// The plants "Find plant" can navigate to: the plants on the phone and the server positions
// saved on the phone (savedPlantPositions.ts), merged with mergePlants (one row per plant by
// server id, then phone id, then tag; the phone's copy wins, it has more data). A phone copy
// without coordinates takes them from the server entry for the same plant. Plants with no
// identity or no coordinates are left out. Each row's key ("plant:" + id or tag) is unique.
export function navigablePlantRows<L, R>(
  local: { plant: L; identity: PlantIdentity; coordinates: PlantCoordinates | null }[],
  server: { plant: R; identity: PlantIdentity; coordinates: PlantCoordinates | null }[]
): (({ key: string; source: 'local'; plant: L } | { key: string; source: 'server'; plant: R }) & PlantCoordinates)[] {
  // Server coordinates by every identity they can be matched on.
  const serverCoordinates = new Map<string, PlantCoordinates>();
  for (const entry of server) {
    if (!entry?.identity || !validCoordinates(entry.coordinates)) continue;
    const serverId = clean(entry.identity.serverId);
    const localId = clean(entry.identity.localId);
    const tag = clean(entry.identity.tagCode)?.toUpperCase() ?? null;
    if (serverId !== null && !serverCoordinates.has(`s:${serverId}`)) serverCoordinates.set(`s:${serverId}`, entry.coordinates);
    if (localId !== null && !serverCoordinates.has(`l:${localId}`)) serverCoordinates.set(`l:${localId}`, entry.coordinates);
    if (tag !== null && !serverCoordinates.has(`t:${tag}`)) serverCoordinates.set(`t:${tag}`, entry.coordinates);
  }
  const fromServer = (identity: PlantIdentity): PlantCoordinates | null => {
    const serverId = clean(identity.serverId);
    const localId = clean(identity.localId);
    const tag = clean(identity.tagCode)?.toUpperCase() ?? null;
    return (serverId !== null ? serverCoordinates.get(`s:${serverId}`) : undefined) ??
      (localId !== null ? serverCoordinates.get(`l:${localId}`) : undefined) ??
      (tag !== null ? serverCoordinates.get(`t:${tag}`) : undefined) ??
      null;
  };

  const merged = mergePlants(
    local.map((entry) => ({ plant: entry, identity: entry?.identity })),
    server.map((entry) => ({ plant: entry, identity: entry?.identity }))
  );
  const rows: (({ key: string; source: 'local'; plant: L } | { key: string; source: 'server'; plant: R }) & PlantCoordinates)[] = [];
  for (const row of merged) {
    const own = validCoordinates(row.plant.coordinates) ? row.plant.coordinates : null;
    const coordinates = own ?? (row.source === 'local' ? fromServer(row.plant.identity) : null);
    if (!coordinates) continue;
    const { latitude, longitude } = coordinates;
    rows.push(
      row.source === 'local'
        ? { key: row.key, source: 'local', plant: row.plant.plant as L, latitude, longitude }
        : { key: row.key, source: 'server', plant: row.plant.plant as R, latitude, longitude }
    );
  }
  return rows;
}
