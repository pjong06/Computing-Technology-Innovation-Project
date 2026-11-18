import React, { useCallback, useMemo, useState } from 'react';
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
import Toast from 'react-native-toast-message';
import { useStaffOnly } from '../../src/context/AuthRoleContext';
import {
  SyncStatus,
  useRecordStore,
  type ObservationVisit,
  type PlantRecord,
} from '../../src/store/useRecordStore';
import { useProposalStore, type SpeciesProposal } from '../../src/store/useProposalStore';
import { buildSyncSummary } from '../../src/services/syncSummary';
import { plantReviewBadge, reviewOutcomeBadge } from '../../src/utils/reviewStatus';
import { firstVisitOf, isRecordSubmitted, isVisitSubmitted } from '../../src/utils/submissionState';
import { routesUploadedText } from '../../src/utils/routeSync';
import { resumeAllPausedRecordRetries } from '../../src/services/offlineDatabase';
import { pullServerRecords, serverPullError } from '../../src/services/serverPull';

type SubmissionType = 'All' | 'Plants' | 'Observations' | 'Species';

// A newly registered plant and its first visit are one submission, so they share one
// "New plant" row (with the first visit's status). Only later visits (revisits) get their
// own "Visit" row.
type SubmissionItem =
  | { key: string; type: 'plant'; timestamp: number; record: PlantRecord; firstVisit: ObservationVisit | null }
  | { key: string; type: 'visit'; timestamp: number; record: PlantRecord; visit: ObservationVisit }
  | { key: string; type: 'species'; timestamp: number; proposal: SpeciesProposal };

function timestampFor(value?: string): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatDate(value?: string): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function submissionBadge(
  syncStatus: SyncStatus,
  reviewStatus?: string,
  submitted = true
): { label: string; bg: string; text: string } {
  if (syncStatus !== SyncStatus.UPLOADED) {
    return { label: 'Not synced', bg: '#FDF4D8', text: '#8C5E03' };
  }
  return reviewOutcomeBadge(reviewStatus, 'Pending', submitted);
}

// Why an uploaded plant or visit has not been sent for review (server refusal, photo over
// 5 MB), so "Not submitted yet" always comes with a reason when there is one.
function submitProblem(item: SubmissionItem): string | null {
  if (item.type === 'visit') {
    return isVisitSubmitted(item.visit) ? null : item.visit.submitError ?? null;
  }
  if (item.type === 'plant' && item.firstVisit) {
    return isVisitSubmitted(item.firstVisit) ? null : item.firstVisit.submitError ?? null;
  }
  return null;
}

function submissionName(item: SubmissionItem): string {
  if (item.type === 'species') return item.proposal.scientificName;
  return item.record.scientificName || 'Identification pending';
}

function searchableValues(item: SubmissionItem): (string | undefined)[] {
  if (item.type === 'species') {
    return [
      item.proposal.scientificName,
      item.proposal.commonName,
      item.proposal.localName,
      item.proposal.family,
      item.proposal.description,
      item.proposal.habitat,
    ];
  }
  return [
    item.record.scientificName,
    item.record.commonName,
    item.record.family,
    item.record.locationName,
    item.record.tagCode ?? undefined,
    item.type === 'visit' ? item.visit.notes : item.firstVisit?.notes,
  ];
}

function rejectionReason(item: SubmissionItem): string | null {
  // A new plant's row follows its first visit (the plant record itself when there is none).
  const visit = item.type === 'visit' ? item.visit : item.type === 'plant' ? item.firstVisit : null;
  const review = item.type === 'species'
    ? item.proposal.review
    : visit
      ? visit.reviewStatus
      : item.record.reviewStatus;
  if (String(review) !== 'rejected') return null;

  const reason = item.type === 'species'
    ? item.proposal.reviewComment
    : visit
      ? visit.reviewComment
      : item.record.reviewComment;
  return reason?.trim() || 'No reason was given.';
}

export default function RecordsScreen() {
  const router = useRouter();
  const blocked = useStaffOnly();
  const records = useRecordStore((state) => state.records);
  const syncAll = useRecordStore((state) => state.syncAll);
  const syncRoutes = useRecordStore((state) => state.syncRoutes);
  const unsentRouteCount = useRecordStore(
    (state) => state.routes.filter((route) => route.syncStatus !== 'uploaded').length
  );
  const refreshReviewStatuses = useRecordStore((state) => state.refreshReviewStatuses);
  const proposals = useProposalStore((state) => state.proposals);
  const syncAllProposals = useProposalStore((state) => state.syncAllProposals);
  const refreshProposalStatuses = useProposalStore((state) => state.refreshProposalStatuses);

  const [selectedType, setSelectedType] = useState<SubmissionType>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!blocked) {
        void refreshReviewStatuses();
        void refreshProposalStatuses();
      }
    }, [blocked, refreshReviewStatuses, refreshProposalStatuses])
  );

  const submissions = useMemo(() => {
    const items: SubmissionItem[] = records.flatMap((record) => {
      const firstVisit = firstVisitOf(record);
      return [
        {
          key: `plant:${record.id}`,
          type: 'plant' as const,
          timestamp: timestampFor(record.createdAtIso || record.createdAt),
          record,
          firstVisit,
        },
        // Revisits only: the first visit is part of the "New plant" row.
        ...record.observations.filter((visit) => visit !== firstVisit).map((visit) => ({
          key: `visit:${record.id}:${visit.id}`,
          type: 'visit' as const,
          timestamp: timestampFor(visit.observedAt || visit.date),
          record,
          visit,
        })),
      ];
    });

    items.push(
      ...proposals.map((proposal) => ({
        key: `species:${proposal.id}`,
        type: 'species' as const,
        timestamp: timestampFor(proposal.createdAt),
        proposal,
      }))
    );

    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [records, proposals]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return submissions.filter((item) => {
      const matchesType =
        selectedType === 'All' ||
        (selectedType === 'Plants' && item.type === 'plant') ||
        (selectedType === 'Observations' && item.type === 'visit') ||
        (selectedType === 'Species' && item.type === 'species');
      const matchesQuery =
        query === '' ||
        searchableValues(item).some((value) => value?.toLowerCase().includes(query));
      return matchesType && matchesQuery;
    });
  }, [searchQuery, selectedType, submissions]);

  const summary = buildSyncSummary(records, syncingAll);
  const pendingCount = summary.pendingItemCount;
  const failedCount = summary.failedItemCount;
  const recordsToSync = pendingCount + failedCount;
  const unsentProposalCount = proposals.filter(
    (proposal) => proposal.syncStatus !== SyncStatus.UPLOADED
  ).length;

  const handleSyncNow = async () => {
    setSyncingAll(true);
    try {
      await resumeAllPausedRecordRetries();
      const {
        uploaded,
        failed: recordsFailed,
        skipped,
        photosUploaded,
        photoProblems,
      } = await syncAll();
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
      if (photosUploaded > 0) {
        parts.push(`${photosUploaded} ${photosUploaded === 1 ? 'photo' : 'photos'} uploaded`);
      }
      if (photoProblems > 0) {
        parts.push(
          `${photoProblems} ${photoProblems === 1 ? 'photo' : 'photos'} over 5 MB (see the plant page)`
        );
      }
      if (proposalsResult.uploaded > 0) {
        parts.push(
          `${proposalsResult.uploaded} species ${
            proposalsResult.uploaded === 1 ? 'proposal' : 'proposals'
          } sent`
        );
      }
      if (routesResult.uploaded > 0) parts.push(routesUploadedText(routesResult.uploaded));
      if (routesResult.failed > 0) {
        parts.push(
          `${routesResult.failed} ${routesResult.failed === 1 ? 'route' : 'routes'} not uploaded`
        );
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
    }
  };

  if (blocked) return null;

  const filters: SubmissionType[] = ['All', 'Plants', 'Observations', 'Species'];
  // Short chip labels so all four fit on one line on a 360 px phone ("Observations" wrapped).
  const filterLabels: Record<SubmissionType, string> = {
    All: 'All',
    Plants: 'Plants',
    Observations: 'Visits',
    Species: 'Species',
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.headerTitle}>My submissions</Text>

        {(recordsToSync > 0 || unsentProposalCount > 0 || unsentRouteCount > 0) && (
          <View style={styles.syncCard}>
            <Text style={styles.syncTitle}>
              {[
                recordsToSync > 0
                  ? `${recordsToSync} ${
                      recordsToSync === 1 ? 'submission' : 'submissions'
                    }`
                  : null,
                unsentProposalCount > 0
                  ? `${unsentProposalCount} species ${
                      unsentProposalCount === 1 ? 'proposal' : 'proposals'
                    }`
                  : null,
                unsentRouteCount > 0
                  ? `${unsentRouteCount} ${unsentRouteCount === 1 ? 'route' : 'routes'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' and ')}{' '}
              pending sync
            </Text>
            <Text style={styles.syncSub}>
              {pendingCount} queued{failedCount > 0 ? ` · ${failedCount} failed` : ''} · local storage safe
            </Text>
            <TouchableOpacity
              style={[styles.syncBtn, syncingAll && styles.syncBtnDisabled]}
              onPress={() => void handleSyncNow()}
              disabled={syncingAll}
            >
              {syncingAll ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.syncBtnText}>Sync now</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <TextInput
          style={styles.searchBar}
          placeholder="Search my submissions"
          placeholderTextColor="#8C9A91"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        <View style={styles.filterRow}>
          {filters.map((filter) => {
            const isActive = selectedType === filter;
            return (
              <TouchableOpacity
                key={filter}
                onPress={() => setSelectedType(filter)}
                style={[styles.filterChip, isActive && styles.activeFilterChip]}
                accessibilityRole="button"
                accessibilityLabel={filter === 'Observations' ? 'Visits (observations)' : filter}
                accessibilityState={{ selected: isActive }}
              >
                <Text
                  style={[styles.filterLabel, isActive && styles.activeFilterLabel]}
                  numberOfLines={1}
                >
                  {filterLabels[filter]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.key}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>
                {submissions.length === 0 ? 'No submissions yet' : 'No submissions match'}
              </Text>
              <Text style={styles.emptySub}>
                {submissions.length === 0
                  ? 'Plants, observations and species proposals saved on this phone will appear here.'
                  : 'Try a different filter or search term.'}
              </Text>
              {submissions.length === 0 ? (
                <>
                  <TouchableOpacity
                    style={styles.primaryPillBtn}
                    onPress={() => router.push('/new-record' as any)}
                  >
                    <Text style={styles.primaryPillText}>+ Register a plant</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryPillBtn}
                    onPress={() => router.push('/(tabs)/scan' as any)}
                  >
                    <Text style={styles.secondaryPillText}>Scan an existing tag</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            // A new plant shows its first visit's status. Once approved, waiting revisits add a
            // small "1 visit waiting for review" line (they also have their own Visit rows).
            const plantSynced =
              item.type === 'plant' &&
              (item.firstVisit?.syncStatus ?? item.record.syncStatus) === SyncStatus.UPLOADED;
            const plantReview =
              item.type === 'plant' && plantSynced ? plantReviewBadge(item.record, 'Pending') : null;
            const badge = item.type === 'species'
              ? submissionBadge(item.proposal.syncStatus, item.proposal.review)
              : item.type === 'visit'
                ? submissionBadge(item.visit.syncStatus, item.visit.reviewStatus, isVisitSubmitted(item.visit))
                : plantReview?.badge ??
                  submissionBadge(
                    item.firstVisit?.syncStatus ?? item.record.syncStatus,
                    item.record.reviewStatus,
                    isRecordSubmitted(item.record)
                  );
            const reason = rejectionReason(item);
            const notSentReason = submitProblem(item);
            const tagCode = item.type === 'species' ? null : item.record.tagCode;
            const date = item.type === 'plant'
              ? formatDate(item.record.createdAtIso || item.record.createdAt)
              : item.type === 'visit'
                ? formatDate(item.visit.observedAt || item.visit.date)
                : formatDate(item.proposal.createdAt);
            const metadata = [
              tagCode ? `Tag ${tagCode}` : null,
              item.type !== 'species' ? item.record.locationName : null,
              date,
            ]
              .filter(Boolean)
              .join(' · ');
            const isProposalExpanded =
              item.type === 'species' && expandedProposalId === item.proposal.id;

            return (
              <TouchableOpacity
                style={styles.recordCard}
                activeOpacity={0.75}
                onPress={() => {
                  if (item.type === 'species') {
                    setExpandedProposalId(isProposalExpanded ? null : item.proposal.id);
                    return;
                  }
                  router.push({ pathname: '/plant-detail', params: { id: item.record.id } } as any);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.type === 'plant' ? (item.firstVisit ? 'new plant' : 'plant') : item.type} submission: ${submissionName(item)}`}
              >
                <View style={styles.rowTop}>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText} numberOfLines={1}>
                      {/* "New plant" only for a plant registered on this phone (it has a first
                          visit); a scanned plant registered by someone else is just "Plant". */}
                      {item.type === 'plant'
                        ? item.firstVisit ? 'NEW PLANT' : 'PLANT'
                        : item.type === 'visit' ? 'VISIT' : 'SPECIES'}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: badge.text }]} numberOfLines={1}>
                      {badge.label}
                    </Text>
                  </View>
                </View>
                {plantReview?.waitingNote ? (
                  <Text style={styles.waitingNote}>{plantReview.waitingNote}</Text>
                ) : null}
                <Text style={styles.recordSpecies}>{submissionName(item)}</Text>
                <Text style={styles.recordMeta}>{metadata}</Text>
                {item.type === 'plant' && item.firstVisit ? (
                  <Text style={styles.recordMeta}>Includes first visit</Text>
                ) : null}
                {reason ? <Text style={styles.reasonText}>Officer's reason: {reason}</Text> : null}
                {notSentReason ? (
                  <Text style={styles.reasonText}>Not sent for review: {notSentReason}</Text>
                ) : null}

                {isProposalExpanded && item.type === 'species' ? (
                  <View style={styles.proposalDetails}>
                    {item.proposal.commonName ? (
                      <Text style={styles.detailText}>Common name: {item.proposal.commonName}</Text>
                    ) : null}
                    {item.proposal.localName ? (
                      <Text style={styles.detailText}>Local name: {item.proposal.localName}</Text>
                    ) : null}
                    {item.proposal.family ? (
                      <Text style={styles.detailText}>Family: {item.proposal.family}</Text>
                    ) : null}
                    {item.proposal.description ? (
                      <Text style={styles.detailText}>Description: {item.proposal.description}</Text>
                    ) : null}
                    {item.proposal.habitat ? (
                      <Text style={styles.detailText}>Habitat: {item.proposal.habitat}</Text>
                    ) : null}
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          }}
        />
      </View>
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
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1E2B22', marginBottom: 14 },
  syncCard: {
    backgroundColor: '#E6EFE9',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  syncTitle: { fontSize: 13.5, fontWeight: '700', color: '#213B2A' },
  syncSub: { fontSize: 11.5, color: '#5C7163', marginTop: 2 },
  syncBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#213B2A',
    minWidth: 104,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  syncBtnDisabled: { opacity: 0.6 },
  syncBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  searchBar: {
    backgroundColor: '#FFFFFF',
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 18,
    fontSize: 13.5,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 12,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 14,
  },
  filterChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#E9EEEA',
  },
  activeFilterChip: { backgroundColor: '#213B2A' },
  filterLabel: { fontSize: 12.5, color: '#68776D', fontWeight: '600', paddingHorizontal: 4 },
  activeFilterLabel: { color: '#FFFFFF', fontWeight: '700' },
  listContent: { paddingBottom: 12 },
  emptyList: { flexGrow: 1 },
  recordCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 20,
    marginBottom: 10,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeBadge: {
    backgroundColor: '#E9EEEA',
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 10,
  },
  typeBadgeText: { fontSize: 9.5, letterSpacing: 0.5, fontWeight: '800', color: '#526158' },
  statusBadge: { flexShrink: 1, marginLeft: 8, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 16 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  waitingNote: { fontSize: 11.5, fontWeight: '600', color: '#1F4E8C', marginTop: -2, marginBottom: 6 },
  recordSpecies: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  recordMeta: { fontSize: 12.5, color: '#68776D', marginTop: 4 },
  reasonText: { fontSize: 12, fontWeight: '600', color: '#9B1C1C', marginTop: 6 },
  proposalDetails: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E6ECE8',
    gap: 4,
  },
  detailText: { fontSize: 12.5, color: '#526158', lineHeight: 18 },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 30,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1E2B22', marginBottom: 6 },
  emptySub: {
    fontSize: 13,
    color: '#68776D',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 24,
  },
  primaryPillBtn: {
    backgroundColor: '#213B2A',
    height: 48,
    borderRadius: 24,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryPillText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  secondaryPillBtn: {
    height: 48,
    borderRadius: 24,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#213B2A',
    backgroundColor: '#FFF',
  },
  secondaryPillText: { color: '#213B2A', fontWeight: '700', fontSize: 14 },
});
