import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useStaffOnly } from '../../src/context/AuthRoleContext';
import {
  IdentificationStatus,
  ReviewStatus,
  SyncStatus,
  useRecordStore,
  type PlantRecord,
} from '../../src/store/useRecordStore';
import { useProposalStore } from '../../src/store/useProposalStore';
import { useSpeciesStore } from '../../src/store/useSpeciesStore';
import { buildSyncSummary } from '../../src/services/syncSummary';
import {
  REVIEW_BADGE,
  plantReviewBadge,
  recordRowBadge,
  statusReason,
  visitStatus,
} from '../../src/utils/reviewStatus';
import { firstVisitOf, isVisitSubmitted, newPlantReview } from '../../src/utils/submissionState';
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
  needsActionCount,
  rowStatus,
  syncStatusText,
  type NeedsActionReason,
  type PlantFilters,
  type PlantRow,
  type RecordStatusGroup,
} from '../../src/utils/recordsList';
import { routesUploadedText } from '../../src/utils/routeSync';
import { resolveStoredPhotoUri } from '../../src/utils/photoStorage';
import { getLastSuccessfulSync, resumeAllPausedRecordRetries } from '../../src/services/offlineDatabase';
import { pullServerRecords, serverPullError } from '../../src/services/serverPull';
import { fetchOtherApprovedPlants, type OtherApprovedPlant } from '../../src/services/approvedPlants';
import { lookupTag, describeTagLookup } from '../../src/services/tagLookup';
import { FilterButton, FilterPills, FilterSheet } from '../../src/components/FilterSheet';
import RemotePhoto from '../../src/components/RemotePhoto';
import { publicPhotoUri } from '../../src/utils/publicPhoto';
import { BASE_URL } from '../../src/api/client';

// Plants (botanist tab, route "records"): one row per plant. Each row shows the most urgent
// status of the plant and the botanist's own visits to it; the visits themselves are listed
// in Plant detail. "All plants" adds other botanists' approved plants from the server
// (src/services/approvedPlants.ts: never their coordinates). Species proposals are on Home.

type Badge = { label: string; bg: string; text: string };

type PlantItem = PlantRow & {
  record: PlantRecord | null; // null: another botanist's plant that is not on this phone
  tag: string | null;
  speciesId: string | null;
  photoUri: string | null;
  place: string;
  badge: Badge;
  action: NeedsActionReason | null;
  reason: string | null;
};

// Kept between visits to the tab, so the list does not flicker while it reloads.
let otherPlantsCache: OtherApprovedPlant[] = [];

function timestampFor(value?: string | null): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function dayText(value?: string | null): string | null {
  const time = timestampFor(value);
  return time === 0
    ? null
    : new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The thumbnail is the plant's own photo, or the leaf placeholder (species reference photos
// are not shown).
function localItem(key: string, stored: PlantRecord): PlantItem {
  // Older or partly downloaded records may lack these lists; treat them as empty.
  const visits = (Array.isArray(stored.observations) ? stored.observations : []).filter(Boolean);
  const record: PlantRecord = { ...stored, observations: visits };
  const firstVisit = firstVisitOf(record);
  // The plant (with its first visit: registering and the first visit are one submission).
  const plantStatus = rowStatus({
    syncStatus: firstVisit?.syncStatus ?? record.syncStatus,
    outcome: newPlantReview(record).outcome,
    needsSpecies: record.identificationStatus === IdentificationStatus.PENDING,
  });
  const candidates: { group: RecordStatusGroup; action: NeedsActionReason | null; badge: Badge; reason: string | null }[] = [
    {
      ...plantStatus,
      badge: recordRowBadge(plantStatus, plantReviewBadge(record, 'Waiting for review').badge),
      reason: statusReason(
        plantStatus.action,
        firstVisit?.reviewComment ?? record.reviewComment,
        firstVisit && !isVisitSubmitted(firstVisit) ? firstVisit.submitError : null,
        record.syncError
      ),
    },
  ];
  // Then each later visit by this botanist.
  const revisits = visits.filter((visit) => visit !== firstVisit);
  for (const visit of revisits) {
    const status = visitStatus(visit, record.syncError);
    candidates.push({ ...status, reason: status.reason ? `Observation ${visit.date}: ${status.reason}` : null });
  }
  const pick = mostUrgent(candidates)?.item ?? candidates[0];

  const lastVisit = visits
    .map((visit) => visit.observedAt || visit.date)
    .sort((a, b) => timestampFor(b) - timestampFor(a))[0];
  const when = visits.length > 0 && dayText(lastVisit)
    ? `Last observation ${dayText(lastVisit)}`
    : dayText(record.createdAtIso)
      ? `Registered ${dayText(record.createdAtIso)}`
      : record.createdAt;
  const name = record.scientificName || 'Identification pending';
  const ownPhoto = Array.isArray(record.photoUris) ? record.photoUris[0] : undefined;
  return {
    key,
    record,
    mine: !record.otherBotanist || visits.length > 0,
    timestamp: timestampFor(record.createdAtIso || record.createdAt),
    name,
    group: pick.group,
    action: pick.action,
    badge: pick.badge,
    reason: pick.reason,
    tag: record.tagCode ?? null,
    speciesId: record.speciesId,
    // Its own photo on this phone; for a plant someone else registered, its public photo.
    photoUri: ownPhoto
      ? resolveStoredPhotoUri(ownPhoto)
      : record.otherBotanist
        ? publicPhotoUri(BASE_URL, record.publicPhotoUrl)
        : null,
    place: [record.locationName, when].filter(Boolean).join(' · '),
    searchText: [name, record.commonName, record.plantName, record.tagCode].filter(Boolean).join(' '),
  };
}

function otherItem(
  key: string,
  plant: OtherApprovedPlant,
  species: { scientific_name: string; common_name: string | null } | undefined
): PlantItem {
  const name = species?.scientific_name || 'Species not recorded';
  const registered = dayText(plant.registeredAt);
  return {
    key,
    record: null,
    mine: false,
    timestamp: timestampFor(plant.registeredAt),
    name,
    group: 'approved',
    action: null,
    badge: REVIEW_BADGE[ReviewStatus.APPROVED],
    reason: null,
    tag: plant.tagCode,
    speciesId: plant.speciesId,
    // Its public stripped photo (served by the backend), or the placeholder.
    photoUri: publicPhotoUri(BASE_URL, plant.photoUrl),
    place: registered ? `Registered ${registered}` : '',
    searchText: [name, species?.common_name, plant.tagCode].filter(Boolean).join(' '),
  };
}

export default function PlantsListScreen() {
  const router = useRouter();
  const blocked = useStaffOnly();
  const records = useRecordStore((state) => state.records);
  const syncAll = useRecordStore((state) => state.syncAll);
  const syncRoutes = useRecordStore((state) => state.syncRoutes);
  const unsentRouteCount = useRecordStore(
    (state) => state.routes.filter((route) => route.syncStatus !== 'uploaded').length
  );
  const refreshReviewStatuses = useRecordStore((state) => state.refreshReviewStatuses);
  const syncAllProposals = useProposalStore((state) => state.syncAllProposals);
  const refreshProposalStatuses = useProposalStore((state) => state.refreshProposalStatuses);
  const unsentProposalCount = useProposalStore(
    (state) => state.proposals.filter((proposal) => proposal.syncStatus !== SyncStatus.UPLOADED).length
  );
  const species = useSpeciesStore((state) => state.species);
  const loadSpecies = useSpeciesStore((state) => state.loadSpecies);

  const [filters, setFilters] = useState<PlantFilters>(DEFAULT_FILTERS);
  const [draft, setDraft] = useState<PlantFilters>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [syncingAll, setSyncingAll] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [otherPlants, setOtherPlants] = useState<OtherApprovedPlant[]>(otherPlantsCache);
  const [othersState, setOthersState] = useState<'loading' | 'ok' | 'offline'>('loading');
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  const loadOtherPlants = useCallback(async () => {
    const own = new Set(
      useRecordStore
        .getState()
        .records.map((record) => record.serverId)
        .filter((id): id is string => Boolean(id))
    );
    setOthersState('loading');
    try {
      const plants = await fetchOtherApprovedPlants(own);
      otherPlantsCache = plants;
      setOtherPlants(plants);
      setOthersState('ok');
    } catch {
      setOthersState('offline');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (blocked) return undefined;
      void refreshReviewStatuses();
      void refreshProposalStatuses();
      void getLastSuccessfulSync().then(setLastSync).catch(() => undefined);
      if (useSpeciesStore.getState().species.length === 0) void loadSpecies();
      void loadOtherPlants();
      setNow(Date.now());
      // Keeps "Synced 2 min ago" current while the tab is open.
      const timer = setInterval(() => setNow(Date.now()), 60000);
      return () => clearInterval(timer);
    }, [blocked, refreshReviewStatuses, refreshProposalStatuses, loadSpecies, loadOtherPlants])
  );

  const speciesById = useMemo(() => new Map(species.map((item) => [item.id, item])), [species]);

  const items = useMemo<PlantItem[]>(() => {
    // One row per plant: the phone's copy wins over the same plant from the server, and
    // every row gets a unique "plant:<id>" key (src/utils/recordsList.ts mergePlants).
    const merged = mergePlants(
      records
        .filter((record): record is PlantRecord => Boolean(record && record.id))
        .map((record) => ({
          plant: record,
          identity: { serverId: record.serverId, localId: record.id, tagCode: record.tagCode },
        })),
      otherPlants
        .filter((plant): plant is OtherApprovedPlant => Boolean(plant && plant.serverId))
        .map((plant) => ({ plant, identity: { serverId: plant.serverId, tagCode: plant.tagCode } }))
    );
    return merged.map((entry) =>
      entry.source === 'local'
        ? localItem(entry.key, entry.plant)
        : otherItem(
            entry.key,
            entry.plant,
            entry.plant.speciesId ? speciesById.get(entry.plant.speciesId) : undefined
          )
    );
  }, [records, otherPlants, speciesById]);

  const visible = useMemo(() => filterAndSortPlants(items, filters, searchQuery), [items, filters, searchQuery]);
  const draftCount = useMemo(() => filterAndSortPlants(items, draft, searchQuery).length, [items, draft, searchQuery]);
  const actionCount = needsActionCount(items);

  const summary = buildSyncSummary(records, syncingAll);
  const notUploaded = summary.pendingItemCount + summary.failedItemCount + unsentProposalCount + unsentRouteCount;

  const handleSyncNow = async () => {
    setSyncingAll(true);
    try {
      await resumeAllPausedRecordRetries();
      const { uploaded, failed: recordsFailed, skipped, photosUploaded, photoProblems } = await syncAll();
      // Routes upload on their own path, after the plant/visit sync.
      const routesResult = await syncRoutes();
      const proposalsResult = await syncAllProposals();
      await refreshProposalStatuses();

      let downloaded = 0;
      let downloadError: string | null = null;
      try {
        downloaded = (await pullServerRecords()).downloaded;
      } catch (error) {
        downloadError = serverPullError(error);
      }

      const failed = recordsFailed + proposalsResult.failed + routesResult.failed;
      const parts = [`${uploaded} uploaded`];
      if (downloaded > 0) parts.push(`${downloaded} downloaded`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (skipped > 0) parts.push(`${skipped} already uploading`);
      if (photosUploaded > 0) parts.push(`${photosUploaded} ${photosUploaded === 1 ? 'photo' : 'photos'} uploaded`);
      if (photoProblems > 0) {
        parts.push(`${photoProblems} ${photoProblems === 1 ? 'photo' : 'photos'} over 5 MB (see the plant page)`);
      }
      if (proposalsResult.uploaded > 0) {
        parts.push(`${proposalsResult.uploaded} species ${proposalsResult.uploaded === 1 ? 'request' : 'requests'} sent`);
      }
      if (routesResult.uploaded > 0) parts.push(routesUploadedText(routesResult.uploaded));
      if (routesResult.failed > 0) {
        parts.push(`${routesResult.failed} ${routesResult.failed === 1 ? 'route' : 'routes'} not uploaded`);
      }

      const problem = proposalsResult.reasons[0] ?? downloadError;
      Toast.show({
        type: failed > 0 || downloadError ? 'error' : 'success',
        text1: failed > 0 ? 'Some records did not upload' : downloadError ? 'Upload complete; download pending' : 'Sync complete',
        text2: problem ? `${parts.join(' · ')}. ${problem}` : parts.join(' · '),
        position: 'bottom',
      });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Sync could not finish',
        text2: error instanceof Error ? error.message : 'Please try again.',
        position: 'bottom',
      });
    } finally {
      setSyncingAll(false);
      void getLastSuccessfulSync().then(setLastSync).catch(() => undefined);
      setNow(Date.now());
      void loadOtherPlants();
    }
  };

  // Another botanist's plant: look its tag up (the same path as scanning it), then open it.
  const openOtherPlant = async (item: PlantItem) => {
    if (!item.tag) {
      Toast.show({ type: 'info', text1: 'This plant has no tag yet', text2: 'Scan its tag in the field to open it.', position: 'bottom' });
      return;
    }
    setOpeningKey(item.key);
    try {
      const result = await lookupTag(item.tag);
      if (result.status === 'on-phone') {
        router.push({ pathname: '/plant-detail', params: { id: result.record.id } } as any);
      } else {
        const { title, message } = describeTagLookup(result);
        Toast.show({ type: 'error', text1: title, text2: message, position: 'bottom' });
      }
    } finally {
      setOpeningKey(null);
    }
  };

  if (blocked) return null;

  const openSheet = () => {
    setDraft(filters);
    setSheetOpen(true);
  };
  const pills = activeFilterPills(filters);
  const filterCount = activeFilterCount(filters);
  const showingActionList = filters.status === 'needs_action' && filters.show === 'mine';

  const header = (
    <View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchBar}
          placeholder="Search plant or species"
          placeholderTextColor="#8C9A91"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search plant or species"
        />
        <FilterButton count={filterCount} onPress={openSheet} />
      </View>

      <FilterPills
        pills={pills}
        onRemove={(group) => {
          const key = group as keyof PlantFilters;
          setFilters({ ...filters, [key]: DEFAULT_FILTERS[key] });
        }}
      />

      <Text style={styles.summaryText}>
        {listSummary(visible.length, filters.sort)}
        {filters.show === 'all' && othersState === 'loading' ? ' · loading other botanists’ plants…' : ''}
        {filters.show === 'all' && othersState === 'offline' ? ' · other botanists’ plants could not be loaded (check the connection)' : ''}
      </Text>

      {actionCount > 0 && !showingActionList ? (
        <View style={styles.actionBanner}>
          <Text style={styles.actionBannerText}>
            {actionCount} of your {actionCount === 1 ? 'plants needs' : 'plants need'} action
          </Text>
          <TouchableOpacity
            onPress={() => setFilters({ ...filters, status: 'needs_action', show: 'mine' })}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Show the plants that need your action"
          >
            <Text style={styles.actionBannerLink}>Show</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  const registerButton = (
    <TouchableOpacity
      style={styles.registerBtn}
      onPress={() => router.push('/new-record' as any)}
      accessibilityRole="button"
    >
      <Text style={styles.registerText}>+ Register plant</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.titleRow}>
          <Text style={styles.headerTitle}>Plants</Text>
          <View style={styles.syncRow}>
            <Text
              style={[styles.syncText, notUploaded > 0 && styles.syncTextPending]}
              numberOfLines={1}
            >
              {syncStatusText(lastSync, notUploaded, now)}
            </Text>
            {notUploaded > 0 ? (
              syncingAll ? (
                <ActivityIndicator size="small" color="#213B2A" />
              ) : (
                <TouchableOpacity
                  style={styles.syncBtn}
                  onPress={() => void handleSyncNow()}
                  accessibilityRole="button"
                >
                  <Text style={styles.syncBtnText}>Sync now</Text>
                </TouchableOpacity>
              )
            ) : null}
          </View>
        </View>

        <FlatList
          data={visible}
          keyExtractor={(item) => item.key}
          ListHeaderComponent={header}
          ListFooterComponent={visible.length > 0 ? registerButton : undefined}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>{items.length === 0 ? 'No plants yet' : 'No plants match'}</Text>
              <Text style={styles.emptySub}>
                {items.length === 0
                  ? 'Plants you register, and plants you scan, will appear here.'
                  : 'Try a different search, or reset the filters.'}
              </Text>
              {items.length > 0 && filterCount > 0 ? (
                <TouchableOpacity style={styles.secondaryPillBtn} onPress={() => setFilters(DEFAULT_FILTERS)}>
                  <Text style={styles.secondaryPillText}>Reset filters</Text>
                </TouchableOpacity>
              ) : null}
              {registerButton}
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.plantCard}
              activeOpacity={0.75}
              disabled={openingKey === item.key}
              onPress={() => {
                if (item.record) {
                  router.push({ pathname: '/plant-detail', params: { id: item.record.id } } as any);
                } else {
                  void openOtherPlant(item);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}${item.tag ? `, tag ${item.tag}` : ''}, ${item.badge.label}`}
            >
              <RemotePhoto
                uri={item.photoUri}
                style={styles.thumb}
                placeholder={
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <Ionicons name="leaf-outline" size={22} color="#46654F" />
                  </View>
                }
              />
              <View style={styles.plantText}>
                <Text style={styles.plantName} numberOfLines={2}>{item.name}</Text>
                {item.tag ? <Text style={styles.plantMeta} numberOfLines={1}>{item.tag}</Text> : null}
                {item.place ? <Text style={styles.plantMeta} numberOfLines={1}>{item.place}</Text> : null}
                <View style={styles.badgeRow}>
                  <View style={[styles.statusBadge, { backgroundColor: item.badge.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: item.badge.text }]} numberOfLines={1}>
                      {item.badge.label}
                    </Text>
                  </View>
                  {openingKey === item.key ? <ActivityIndicator size="small" color="#213B2A" /> : null}
                </View>
                {item.reason ? (
                  <Text style={item.action === 'needs_species' ? styles.hintText : styles.reasonText} numberOfLines={3}>
                    {item.reason}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Filter: a bottom sheet with Show, Status and Sort by (shared with Home). */}
      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        groups={[
          { key: 'show', title: 'Show', options: SHOW_FILTERS, selected: draft.show },
          {
            key: 'status',
            title: 'Status',
            options: STATUS_FILTERS.map((option) => ({
              ...option,
              label: option.value === 'needs_action' ? `${option.label} (${actionCount})` : option.label,
            })),
            selected: draft.status,
          },
          { key: 'sort', title: 'Sort by', options: SORT_ORDERS, selected: draft.sort },
        ]}
        onSelect={(group, value) => setDraft({ ...draft, [group]: value } as PlantFilters)}
        onReset={() => setDraft(DEFAULT_FILTERS)}
        applyLabel={`Show ${draftCount} ${draftCount === 1 ? 'plant' : 'plants'}`}
        onApply={() => {
          setFilters(draft);
          setSheetOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1E2B22' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  syncText: { fontSize: 12, color: '#68776D', flexShrink: 1 },
  syncTextPending: { color: '#8C5E03', fontWeight: '700' },
  syncBtn: { backgroundColor: '#213B2A', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12 },
  syncBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  searchBar: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#FFFFFF',
    height: 46,
    borderRadius: 23,
    paddingHorizontal: 16,
    fontSize: 13.5,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  summaryText: { fontSize: 12.5, color: '#68776D', marginBottom: 10 },
  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#FDF4D8',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  actionBannerText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700', color: '#8C5E03' },
  actionBannerLink: { fontSize: 13, fontWeight: '800', color: '#213B2A', textDecorationLine: 'underline' },
  listContent: { paddingBottom: 16, flexGrow: 1 },
  plantCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 18,
    marginBottom: 8,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#E7EFEA' },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  plantText: { flex: 1, minWidth: 0, marginLeft: 12 },
  plantName: { fontSize: 14.5, fontWeight: '700', fontStyle: 'italic', color: '#1E2B22' },
  plantMeta: { fontSize: 12, color: '#68776D', marginTop: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  statusBadge: { flexShrink: 1, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  reasonText: { fontSize: 12, fontWeight: '600', color: '#9B1C1C', marginTop: 6 },
  hintText: { fontSize: 12, fontWeight: '600', color: '#8C5E03', marginTop: 6 },
  registerBtn: {
    height: 46,
    borderRadius: 23,
    backgroundColor: '#213B2A',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 8,
  },
  registerText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  emptyContainer: { flex: 1, justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 30 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1E2B22', marginBottom: 6, textAlign: 'center' },
  emptySub: { fontSize: 13, color: '#68776D', textAlign: 'center', lineHeight: 18, marginBottom: 18 },
  secondaryPillBtn: {
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#213B2A',
    backgroundColor: '#FFF',
  },
  secondaryPillText: { color: '#213B2A', fontWeight: '700', fontSize: 14 },
});
