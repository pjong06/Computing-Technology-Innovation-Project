import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { IdentificationStatus, SyncStatus, useRecordStore, type PlantRecord } from '../store/useRecordStore';
import { useProposalStore, type SpeciesProposal } from '../store/useProposalStore';
import { plantReviewBadge, recordRowBadge, statusReason, visitStatus } from '../utils/reviewStatus';
import { firstVisitOf, isVisitSubmitted, newPlantReview } from '../utils/submissionState';
import { rowStatus } from '../utils/recordsList';
import { resolveStoredPhotoUri } from '../utils/photoStorage';
import { parseTagCode } from '../utils/tagCode';
import {
  ACTIVITY_SHOW_OPTIONS,
  ACTIVITY_SORT_OPTIONS,
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_OPTIONS,
  DEFAULT_ACTIVITY_FILTERS,
  RECENT_ACTIVITY_LIMIT,
  activityFilterCount,
  activityFilterPills,
  activityNeedsActionCount,
  activityTime,
  filterActivity,
  itemsText,
  speciesRequestStatus,
  type ActivityFilters,
  type ActivityItem,
} from '../utils/recentActivity';
import { FilterButton, FilterPills, FilterSheet } from './FilterSheet';
import RemotePhoto from './RemotePhoto';
import { publicPhotoUri } from '../utils/publicPhoto';
import { BASE_URL } from '../api/client';

// Home's "Recent activity" (botanists): the botanist's own new plants, observations and
// species requests in one list, newest first, with a Filter sheet (shared with the Plants
// tab), removable pills, the "need your action" banner and the latest 8, then "See all in
// Plants". Rows that need action say why, with what can be done right there.

type Badge = { label: string; bg: string; text: string };

type ActivityRow = ActivityItem & {
  name: string;
  tag: string | null;
  when: string | null; // ISO or text, for activityTime
  badge: Badge;
  reason: string | null;
  photoUri: string | null;
  recordId: string | null; // plants and observations: opens Plant detail
  request: SpeciesProposal | null;
  retry: 'record' | 'request' | null;
};

function timestampFor(value?: string | null): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

const tagOf = (tag?: string | null) => (tag ? parseTagCode(tag) : null);

// The rows, built with the same status rules as the Plants tab and Plant detail.
function buildRows(records: PlantRecord[], requests: SpeciesProposal[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const seen = new Set<string>();
  const push = (row: ActivityRow) => {
    if (seen.has(row.key)) return;
    seen.add(row.key);
    rows.push(row);
  };

  for (const stored of records) {
    if (!stored || !stored.id) continue;
    const visits = (Array.isArray(stored.observations) ? stored.observations : []).filter(Boolean);
    const record: PlantRecord = { ...stored, observations: visits };
    const firstVisit = firstVisitOf(record);
    const name = record.scientificName || 'Identification pending';
    const tag = tagOf(record.tagCode);

    // The plant's first record (registering it): only for plants this botanist registered.
    if (!record.otherBotanist) {
      const status = rowStatus({
        syncStatus: firstVisit?.syncStatus ?? record.syncStatus,
        outcome: newPlantReview(record).outcome,
        needsSpecies: record.identificationStatus === IdentificationStatus.PENDING,
      });
      const ownPhoto = Array.isArray(record.photoUris) ? record.photoUris[0] : undefined;
      push({
        key: `plant:${record.id}`,
        type: 'new_plant',
        group: status.group,
        timestamp: timestampFor(record.createdAtIso || record.createdAt),
        name,
        tag,
        when: record.createdAtIso || record.createdAt || null,
        badge: recordRowBadge(status, plantReviewBadge(record, 'Waiting for review').badge),
        reason: statusReason(
          status.action,
          firstVisit?.reviewComment ?? record.reviewComment,
          firstVisit && !isVisitSubmitted(firstVisit) ? firstVisit.submitError : null,
          record.syncError
        ),
        photoUri: ownPhoto ? resolveStoredPhotoUri(ownPhoto) : null,
        recordId: record.id,
        request: null,
        retry: record.syncStatus !== SyncStatus.UPLOADED ? 'record' : null,
      });
    }

    // Every later record of the plant by this botanist is an observation.
    for (const visit of visits) {
      if (visit === firstVisit || !visit.id) continue;
      const status = visitStatus(visit, record.syncError);
      const photo = Array.isArray(visit.photoUris) ? visit.photoUris[0] : undefined;
      push({
        key: `observation:${record.id}:${visit.id}`,
        type: 'observation',
        group: status.group,
        timestamp: timestampFor(visit.observedAt || visit.date),
        name,
        tag,
        when: visit.observedAt || visit.date || null,
        badge: status.badge,
        reason: status.reason,
        // The observation's own photo; on a plant someone else registered, else the plant's
        // public photo.
        photoUri: photo
          ? resolveStoredPhotoUri(photo)
          : record.otherBotanist
            ? publicPhotoUri(BASE_URL, record.publicPhotoUrl)
            : null,
        recordId: record.id,
        request: null,
        retry: visit.syncStatus !== SyncStatus.UPLOADED ? 'record' : null,
      });
    }
  }

  for (const request of requests) {
    if (!request || !request.id || request.dismissed) continue;
    const status = speciesRequestStatus(request);
    push({
      key: `request:${request.id}`,
      type: 'species_request',
      group: status.group,
      timestamp: timestampFor(request.createdAt),
      name: request.scientificName,
      tag: null,
      when: request.createdAt,
      badge: status.badge,
      reason:
        status.action === 'not_added'
          ? `Officer's reason: ${request.reviewComment?.trim() || 'No reason was given.'}`
          : null,
      photoUri: null,
      recordId: null,
      request,
      retry: request.syncStatus !== SyncStatus.UPLOADED ? 'request' : null,
    });
  }
  return rows;
}

export default function RecentActivity({
  onRetryRecord,
  retryingRecordIds,
  syncing,
  header,
}: {
  onRetryRecord: (recordId: string) => void;
  retryingRecordIds: string[];
  syncing: boolean;
  // Shown above the list and scrolls with it (sync card, action cards...).
  header?: React.ReactElement | null;
}) {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const requests = useProposalStore((state) => state.proposals);
  const syncProposal = useProposalStore((state) => state.syncProposal);
  const removeProposal = useProposalStore((state) => state.removeProposal);
  const dismissProposal = useProposalStore((state) => state.dismissProposal);

  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_ACTIVITY_FILTERS);
  const [draft, setDraft] = useState<ActivityFilters>(DEFAULT_ACTIVITY_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [retryingRequestId, setRetryingRequestId] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(records, requests), [records, requests]);
  const matching = useMemo(() => filterActivity([...rows], filters), [rows, filters]);
  const draftCount = useMemo(() => filterActivity([...rows], draft).length, [rows, draft]);
  const shown = matching.slice(0, RECENT_ACTIVITY_LIMIT);
  const actionCount = activityNeedsActionCount(rows);
  const filterCount = activityFilterCount(filters);
  const now = new Date();

  const retryRequest = async (id: string) => {
    setRetryingRequestId(id);
    const result = await syncProposal(id);
    setRetryingRequestId(null);
    Toast.show(
      result.ok
        ? { type: 'success', text1: 'Species request sent', text2: 'Waiting for review by an officer.', position: 'bottom' }
        : { type: 'error', text1: 'Upload failed', text2: result.reason, position: 'bottom' }
    );
  };

  const removeRequest = (request: SpeciesProposal) => {
    void removeProposal(request.id)
      .then(() => Toast.show({ type: 'success', text1: 'Species request removed', position: 'bottom' }))
      .catch(() => Toast.show({ type: 'error', text1: 'Could not remove the species request.', position: 'bottom' }));
  };

  const confirmDismiss = (request: SpeciesProposal) => {
    Alert.alert(
      'Dismiss this species request?',
      `${request.scientificName} will be hidden from Recent activity on this phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: () => {
            void dismissProposal(request.id).catch(() =>
              Toast.show({ type: 'error', text1: 'Could not dismiss the species request.', position: 'bottom' })
            );
          },
        },
      ]
    );
  };

  const renderRow = ({ item }: { item: ActivityRow }) => {
    const open = item.recordId
      ? () => router.push({ pathname: '/plant-detail', params: { id: item.recordId as string } })
      : undefined;
    const request = item.request;
    const notAdded = request !== null && item.group === 'needs_action' && request.review === 'rejected' &&
      request.syncStatus === SyncStatus.UPLOADED;
    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.rowMain}
          activeOpacity={open ? 0.7 : 1}
          disabled={!open}
          onPress={open}
          accessibilityRole={open ? 'button' : undefined}
          accessibilityLabel={`${ACTIVITY_TYPE_LABELS[item.type]}: ${item.name}, ${item.badge.label}`}
        >
          {item.type === 'species_request' ? null : (
            <RemotePhoto
              uri={item.photoUri}
              style={styles.thumb}
              placeholder={
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Ionicons name="leaf-outline" size={20} color="#2D6A4F" />
                </View>
              }
            />
          )}
          <View style={styles.rowText}>
            <Text style={[styles.typeLabel, item.type === 'species_request' && styles.typeLabelRequest]}>
              {ACTIVITY_TYPE_LABELS[item.type]}
            </Text>
            <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[item.tag, activityTime(item.when, now)].filter(Boolean).join(' · ')}
            </Text>
            <View style={[styles.badge, { backgroundColor: item.badge.bg }]}>
              <Text style={[styles.badgeText, { color: item.badge.text }]} numberOfLines={1}>{item.badge.label}</Text>
            </View>
          </View>
        </TouchableOpacity>

        {item.reason ? <Text style={styles.reason}>{item.reason}</Text> : null}

        {notAdded && request ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionPrimary}
              onPress={() => router.push({ pathname: '/propose-species', params: { editId: request.id } } as any)}
              accessibilityRole="button"
            >
              <Text style={styles.actionPrimaryText}>Edit and resend</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionSecondary} onPress={() => confirmDismiss(request)} accessibilityRole="button">
              <Text style={styles.actionSecondaryText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {item.retry === 'record' && item.recordId ? (
          <View style={styles.actions}>
            {retryingRecordIds.includes(item.recordId) ? (
              <ActivityIndicator size="small" color="#213B2A" />
            ) : (
              <TouchableOpacity onPress={() => onRetryRecord(item.recordId as string)} disabled={syncing} accessibilityRole="button">
                <Text style={styles.link}>Retry upload</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {item.retry === 'request' && request ? (
          <View style={styles.actions}>
            {retryingRequestId === request.id ? (
              <ActivityIndicator size="small" color="#213B2A" />
            ) : (
              <TouchableOpacity onPress={() => void retryRequest(request.id)} disabled={syncing} accessibilityRole="button">
                <Text style={styles.link}>Retry upload</Text>
              </TouchableOpacity>
            )}
            {request.syncStatus === SyncStatus.FAILED && retryingRequestId !== request.id ? (
              <TouchableOpacity onPress={() => removeRequest(request)} accessibilityRole="button">
                <Text style={[styles.link, styles.linkDanger]}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const listHeader = (
    <View>
      {header}
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Recent activity</Text>
        <FilterButton
          variant="inline"
          count={filterCount}
          onPress={() => {
            setDraft(filters);
            setSheetOpen(true);
          }}
        />
      </View>
      <FilterPills
        pills={activityFilterPills(filters)}
        onRemove={(group) => {
          const key = group as keyof ActivityFilters;
          setFilters({ ...filters, [key]: DEFAULT_ACTIVITY_FILTERS[key] });
        }}
      />
      {actionCount > 0 && filters.show !== 'needs_action' ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {itemsText(actionCount)} {actionCount === 1 ? 'needs' : 'need'} your action
          </Text>
          <TouchableOpacity
            onPress={() => setFilters({ ...filters, show: 'needs_action' })}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Show the items that need your action"
          >
            <Text style={styles.bannerLink}>Show</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <FlatList
        data={shown}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          rows.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptySub}>
                Plants you register, observations you record and species you request will appear here.
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing matches these filters</Text>
              <TouchableOpacity onPress={() => setFilters(DEFAULT_ACTIVITY_FILTERS)} accessibilityRole="button">
                <Text style={styles.link}>Reset filters</Text>
              </TouchableOpacity>
            </View>
          )
        }
        ListFooterComponent={
          rows.length > 0 ? (
            <TouchableOpacity
              style={styles.seeAll}
              onPress={() => router.push('/(tabs)/records')}
              accessibilityRole="button"
            >
              <Text style={styles.seeAllText}>See all in Plants</Text>
            </TouchableOpacity>
          ) : undefined
        }
        contentContainerStyle={styles.listContent}
      />
      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        groups={[
          {
            key: 'show',
            title: 'Show',
            options: ACTIVITY_SHOW_OPTIONS.map((option) => ({
              ...option,
              label: option.value === 'needs_action' ? `${option.label} (${actionCount})` : option.label,
            })),
            selected: draft.show,
          },
          { key: 'type', title: 'Type', options: ACTIVITY_TYPE_OPTIONS, selected: draft.type },
          { key: 'sort', title: 'Sort', options: ACTIVITY_SORT_OPTIONS, selected: draft.sort },
        ]}
        onSelect={(group, value) => setDraft({ ...draft, [group]: value } as ActivityFilters)}
        onReset={() => setDraft(DEFAULT_ACTIVITY_FILTERS)}
        applyLabel={`Show ${itemsText(draftCount)}`}
        onApply={() => {
          setFilters(draft);
          setSheetOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 20 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4, marginBottom: 10 },
  heading: { fontSize: 15, fontWeight: '700', color: '#1E2B22', flexShrink: 1 },
  banner: {
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
  bannerText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700', color: '#8C5E03' },
  bannerLink: { fontSize: 13, fontWeight: '800', color: '#213B2A', textDecorationLine: 'underline' },
  row: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 12,
    marginBottom: 8,
  },
  rowMain: { flexDirection: 'row', gap: 12 },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#E7EFEA' },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  typeLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, color: '#68776D' },
  typeLabelRequest: { color: '#7A4E9C' },
  name: { fontSize: 14.5, fontWeight: '700', fontStyle: 'italic', color: '#1E2B22', marginTop: 2 },
  meta: { fontSize: 12, color: '#68776D', marginTop: 2 },
  badge: { alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, marginTop: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  reason: { fontSize: 12, fontWeight: '600', color: '#9B1C1C', marginTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 10 },
  actionPrimary: { flexGrow: 1, height: 40, borderRadius: 20, backgroundColor: '#213B2A', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14 },
  actionPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  actionSecondary: { flexGrow: 1, height: 40, borderRadius: 20, borderWidth: 1.2, borderColor: '#213B2A', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14 },
  actionSecondaryText: { color: '#213B2A', fontWeight: '700', fontSize: 13 },
  link: { fontSize: 13, fontWeight: '700', color: '#213B2A', textDecorationLine: 'underline' },
  linkDanger: { color: '#9B1C1C' },
  empty: { paddingVertical: 24, paddingHorizontal: 8, alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B22', textAlign: 'center' },
  emptySub: { fontSize: 13, color: '#68776D', textAlign: 'center', lineHeight: 18 },
  seeAll: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  seeAllText: { fontSize: 13.5, fontWeight: '700', color: '#213B2A', textDecorationLine: 'underline' },
});
