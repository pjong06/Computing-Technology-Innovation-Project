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
import { isPhysicalTag } from '../../src/utils/myTags';
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
  type NeedsActionReason,
  type PlantFilters,
  type PlantRow,
  type RecordStatusGroup,
} from '../../src/utils/recordsList';
import { routesUploadedText } from '../../src/utils/routeSync';
import { resolveStoredPhotoUri } from '../../src/utils/photoStorage';
import { resumeAllPausedRecordRetries } from '../../src/services/offlineDatabase';
import { pullServerRecords, serverPullError } from '../../src/services/serverPull';
import { type OtherApprovedPlant } from '../../src/services/approvedPlants';
import { resetExpiryRefresh, usePlantListStore } from '../../src/store/usePlantListStore';
import { lookupTag, describeTagLookup } from '../../src/services/tagLookup';
import { FilterButton, FilterPills, FilterSheet } from '../../src/components/FilterSheet';
import PlantThumbnail from '../../src/components/PlantThumbnail';
import { thumbnailSources, type SignedThumbnail, type ThumbnailSource } from '../../src/utils/thumbnailSources';
import { BASE_URL } from '../../src/api/client';
import RowActions from '../../src/components/RowActions';
import { isGoneCode, rowActions, type RowActionKind } from '../../src/utils/rowActions';
import { explainAnswer, retryableRecord } from '../../src/utils/syncDetails';
import { reportBackgroundError } from '../../src/utils/dbQueue';

// The explanation shown when the plant no longer exists on the server.
const GONE_TEXT = explainAnswer('plant_deleted').explanation;

// Plants (botanist tab, route "records"): one row per plant. Each row shows the most urgent
// status of the plant and the botanist's own visits to it; the visits themselves are listed
// in Plant detail. "All plants" adds other botanists' approved plants from the server
// (src/services/approvedPlants.ts: never their coordinates). Species proposals are on Home.

type Badge = { label: string; bg: string; text: string };

type PlantItem = PlantRow & {
  record: PlantRecord | null; // null: another botanist's plant that is not on this phone
  tag: string | null;
  speciesId: string | null;
  // Where its picture comes from, in order (phone photo, signed thumbnail, public copy).
  photo: ThumbnailSource[];
  place: string;
  badge: Badge;
  action: NeedsActionReason | null;
  reason: string | null;
  // What can be done on the row (src/utils/rowActions.ts), and which record it is about.
  actions: RowActionKind[];
  obsId: string | null;
  isRegistration: boolean;
};

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

// The thumbnail is the plant's own photo (on the phone, else the signed server thumbnail
// from the list), its public copy for someone else's plant, or the leaf placeholder
// (species reference photos are not shown).
function localItem(key: string, stored: PlantRecord, signed: SignedThumbnail | null): PlantItem {
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
  type Candidate = {
    group: RecordStatusGroup;
    action: NeedsActionReason | null;
    badge: Badge;
    reason: string | null;
    obsId: string | null;
    isRegistration: boolean;
    retryable: boolean;
    gone: boolean;
  };
  const plantGone = firstVisit ? isGoneCode(firstVisit.submitCode) : false;
  const candidates: Candidate[] = [
    {
      ...plantStatus,
      obsId: firstVisit?.id ?? null,
      isRegistration: true,
      retryable: record.syncStatus !== SyncStatus.UPLOADED && retryableRecord(record),
      gone: plantGone,
      badge: recordRowBadge(plantStatus, plantReviewBadge(record, 'Waiting for review').badge),
      reason: plantGone
        ? GONE_TEXT
        : statusReason(
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
    const gone = isGoneCode(visit.submitCode);
    const reason = gone ? GONE_TEXT : status.reason;
    candidates.push({
      ...status,
      reason: reason ? `Observation on ${visit.date}: ${reason}` : null,
      obsId: visit.id,
      isRegistration: false,
      retryable: retryableRecord(record, visit.id),
      gone,
    });
  }
  const pick = mostUrgent(candidates)?.item ?? candidates[0];

  // The latest observation on the phone, or the latest approved one on the server.
  const lastVisit = [...visits.map((visit) => visit.observedAt || visit.date), record.serverDetails?.observedAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => timestampFor(b) - timestampFor(a))[0];
  const when = lastVisit && dayText(lastVisit)
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
    // Someone else's plant: nothing to do on it here.
    actions: record.otherBotanist ? [] : rowActions({ action: pick.action, retryable: pick.retryable, gone: pick.gone }),
    obsId: pick.obsId,
    isRegistration: pick.isRegistration,
    tag: record.tagCode ?? null,
    speciesId: record.speciesId,
    // Its own photo on this phone, else its signed server thumbnail; for a plant someone else
    // registered, its public photo.
    photo: thumbnailSources({
      localUri: ownPhoto ? resolveStoredPhotoUri(ownPhoto) : null,
      signed: record.otherBotanist ? null : signed,
      publicPath: record.otherBotanist ? record.publicPhotoUrl : null,
      baseUrl: BASE_URL,
    }),
    // Someone else's plant: the server's location note first (src/utils/plantDetails.ts).
    place: [record.otherBotanist ? record.serverDetails?.locationNote ?? record.locationName : record.locationName, when]
      .filter(Boolean)
      .join(' · '),
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
  // The server's details of this approved plant: location note and latest observation.
  const lastObserved = dayText(plant.details?.observedAt);
  let when = registered ? `Registered ${registered}` : '';
  if (lastObserved) when = `Last observation ${lastObserved}`;
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
    actions: [],
    obsId: null,
    isRegistration: false,
    tag: plant.tagCode,
    speciesId: plant.speciesId,
    // Its public stripped photo (small copy, served by the backend), or the placeholder.
    photo: thumbnailSources({ publicPath: plant.photoUrl, baseUrl: BASE_URL }),
    place: [plant.details?.locationNote, when].filter(Boolean).join(' · '),
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
  // Other botanists' plants and own plants' thumbnails: one request per page, shared with
  // Home and plant detail, and kept between visits so the list does not flicker.
  const otherPlants = usePlantListStore((state) => state.others);
  const ownThumbnails = usePlantListStore((state) => state.ownThumbnails);
  const listState = usePlantListStore((state) => state.state);
  const othersState = listState === 'idle' ? 'loading' : listState;
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  const loadOtherPlants = useCallback(async (force = false) => {
    if (force) resetExpiryRefresh();
    await usePlantListStore.getState().load({ force });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (blocked) return undefined;
      void refreshReviewStatuses().catch(reportBackgroundError('Checking review results'));
      void refreshProposalStatuses().catch(reportBackgroundError('Checking species requests'));
      if (useSpeciesStore.getState().species.length === 0) void loadSpecies();
      void loadOtherPlants();
      return undefined;
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
        ? localItem(entry.key, entry.plant, entry.plant.serverId ? ownThumbnails[entry.plant.serverId] ?? null : null)
        : otherItem(
            entry.key,
            entry.plant,
            entry.plant.speciesId ? speciesById.get(entry.plant.speciesId) : undefined
          )
    );
  }, [records, otherPlants, ownThumbnails, speciesById]);

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
        text1: failed > 0 ? 'Some records did not upload' : downloadError ? 'Uploaded, but couldn\'t download updates' : 'Sync complete',
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
      // After a sync: fresh list and thumbnails (new photos may have been uploaded).
      void loadOtherPlants(true);
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
          {/* Sync status ("Synced 2 min ago" / "Not synced yet") is on Home and Profile; here
              only "Sync now", when something is waiting to upload. */}
          <View style={styles.syncRow}>
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
            <View style={styles.plantCardWrap}>
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
              accessibilityLabel={`${item.name}${isPhysicalTag(item.tag) ? `, tag ${item.tag}` : ''}, ${item.badge.label}`}
            >
              <PlantThumbnail
                sources={item.photo}
                style={styles.thumb}
                placeholder={
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <Ionicons name="leaf-outline" size={22} color="#46654F" />
                  </View>
                }
              />
              <View style={styles.plantText}>
                {/* Plant first (its tag), species second, then where it is. */}
                <Text style={[styles.plantTag, !isPhysicalTag(item.tag) && styles.plantTagMuted]} numberOfLines={1}>
                  {isPhysicalTag(item.tag) ? item.tag : 'No tag yet'}
                </Text>
                <Text style={styles.plantName} numberOfLines={2}>{item.name}</Text>
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
            {item.record && item.actions.length > 0 ? (
              <View style={styles.rowActions}>
                <RowActions
                  actions={item.actions}
                  recordId={item.record.id}
                  obsId={item.obsId}
                  isRegistration={item.isRegistration}
                />
              </View>
            ) : null}
            </View>
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
  plantCardWrap: { marginBottom: 0 },
  rowActions: { paddingHorizontal: 12, marginTop: -4, marginBottom: 10 },
  plantTag: { fontSize: 14.5, fontWeight: '800', color: '#1E2B22', fontVariant: ['tabular-nums'] },
  plantTagMuted: { color: '#68776D' },
  plantName: { fontSize: 13.5, fontWeight: '600', fontStyle: 'italic', color: '#33463A', marginTop: 2 },
  plantMeta: { fontSize: 12, color: '#68776D', marginTop: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  statusBadge: { flexShrink: 1, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  reasonText: { fontSize: 12, fontWeight: '600', color: '#9B1C1C', marginTop: 6 },
  hintText: { fontSize: 12, fontWeight: '600', color: '#8C5E03', marginTop: 6 },
  registerBtn: {
    minHeight: 46,
    paddingVertical: 8,
    borderRadius: 23,
    backgroundColor: '#213B2A',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 8,
  },
  registerText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, flexShrink: 1, textAlign: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 30 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1E2B22', marginBottom: 6, textAlign: 'center' },
  emptySub: { fontSize: 13, color: '#68776D', textAlign: 'center', lineHeight: 18, marginBottom: 18 },
  secondaryPillBtn: {
    minHeight: 46,
    paddingVertical: 8,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#213B2A',
    backgroundColor: '#FFF',
  },
  secondaryPillText: { color: '#213B2A', fontWeight: '700', fontSize: 14, flexShrink: 1, textAlign: 'center' },
});
