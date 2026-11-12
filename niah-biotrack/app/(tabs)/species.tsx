import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSpeciesStore } from '../../src/store/useSpeciesStore';
import type { Species } from '../../src/api/species';
import { useProposalStore, type SpeciesProposal } from '../../src/store/useProposalStore';
import { SyncStatus } from '../../src/store/useRecordStore';
import Toast from 'react-native-toast-message';
import { useAuthRole } from '../../src/context/AuthRoleContext';

// Badge for one of my proposals: upload state first, then the officer's decision.
function proposalBadge(p: SpeciesProposal): { label: string; bg: string; text: string } {
  if (p.syncStatus === SyncStatus.NOT_UPLOADED) return { label: 'Not uploaded', bg: '#FDF4D8', text: '#8C5E03' };
  if (p.syncStatus === SyncStatus.FAILED) return { label: 'Upload failed', bg: '#FDE2E2', text: '#9B1C1C' };
  if (p.review === 'approved') return { label: 'Approved', bg: '#E4F2E7', text: '#215A36' };
  if (p.review === 'rejected') return { label: 'Rejected', bg: '#FDE2E2', text: '#9B1C1C' };
  if (p.review === 'archived') return { label: 'Archived', bg: '#EEF1EF', text: '#5B6B60' };
  return { label: 'Pending approval', bg: '#EEF1EF', text: '#5B6B60' };
}

const STATUS_LABELS: Record<string, string> = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
  DD: 'Data Deficient',
  NA: 'Not assessed',
};

const STATUS_ORDER = ['CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NA'];
const statusCode = (species: Species) =>
  species.conservation_status?.trim() || 'NA';
const statusLabel = (code: string) => STATUS_LABELS[code] ?? code;

const getStatusColor = (code: string) => {
  switch (code) {
    case 'CR':
    case 'EN':
      return { bg: '#FDE2E2', text: '#9B1C1C' };
    case 'VU':
    case 'NT':
      return { bg: '#FEF08A', text: '#854D0E' };
    case 'LC':
      return { bg: '#E4F2E7', text: '#215A36' };
    default:
      return { bg: '#EEF1EF', text: '#5B6B60' };
  }
};

export default function SpeciesScreen() {
  const router = useRouter();
  // Proposing is botanist-only (POST /species/proposals refuses other roles).
  const { role } = useAuthRole();
  const canPropose = role === 'botanist';
  const species = useSpeciesStore((state) => state.species);
  const loading = useSpeciesStore((state) => state.loading);
  const error = useSpeciesStore((state) => state.error);
  const lastUpdated = useSpeciesStore((state) => state.lastUpdated);
  const loadSpecies = useSpeciesStore((state) => state.loadSpecies);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const proposals = useProposalStore((state) => state.proposals);
  const syncProposal = useProposalStore((state) => state.syncProposal);
  const removeProposal = useProposalStore((state) => state.removeProposal);
  const refreshProposalStatuses = useProposalStore((state) => state.refreshProposalStatuses);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => {
    void loadSpecies();
    // Pick up officers' decisions (does nothing when offline).
    if (canPropose) void refreshProposalStatuses();
  }, [loadSpecies, refreshProposalStatuses, canPropose]);

  const retryProposal = async (id: string) => {
    setRetryingId(id);
    const result = await syncProposal(id);
    setRetryingId(null);
    Toast.show(
      result.ok
        ? { type: 'success', text1: 'Proposal uploaded', text2: 'Pending approval by an officer.', position: 'bottom' }
        : { type: 'error', text1: 'Upload failed', text2: result.reason, position: 'bottom' }
    );
  };

  // My proposals, shown above the approved list. They are never part of the approved
  // list itself (or the New Record picker) until an officer approves them.
  const renderProposals = () =>
    proposals.length === 0 ? null : (
      <View style={styles.proposalSection}>
        <Text style={styles.proposalHeading}>My proposals</Text>
        {proposals.map((p) => {
          const badge = proposalBadge(p);
          const notSent = p.syncStatus !== SyncStatus.UPLOADED;
          return (
            <View key={p.id} style={styles.proposalCard}>
              <View style={styles.nameRow}>
                <Text style={styles.speciesName}>{p.scientificName}</Text>
                <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.statusText, { color: badge.text }]}>{badge.label}</Text>
                </View>
              </View>
              {p.commonName || p.localName ? (
                <Text style={styles.speciesSub}>{[p.commonName, p.localName].filter(Boolean).join(' · ')}</Text>
              ) : null}
              {p.review === 'rejected' && p.reviewComment ? (
                <Text style={styles.proposalComment}>Officer: {p.reviewComment}</Text>
              ) : null}
              {notSent && (
                <View style={styles.proposalActions}>
                  {retryingId === p.id ? (
                    <ActivityIndicator size="small" color="#213B2A" />
                  ) : (
                    <TouchableOpacity onPress={() => void retryProposal(p.id)} hitSlop={8}>
                      <Text style={styles.proposalAction}>Retry</Text>
                    </TouchableOpacity>
                  )}
                  {p.syncStatus === SyncStatus.FAILED && retryingId !== p.id && (
                    <TouchableOpacity onPress={() => {
                      void removeProposal(p.id).catch(() => {
                        Toast.show({ type: 'error', text1: 'Could not remove the proposal.' });
                      });
                    }} hitSlop={8}>
                      <Text style={[styles.proposalAction, styles.proposalRemove]}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    );

  const statusOptions = useMemo(() => {
    const codes = new Set(species.map(statusCode));
    const known = STATUS_ORDER.filter((code) => codes.has(code));
    const other = [...codes].filter((code) => !STATUS_ORDER.includes(code));
    return [...known, ...other];
  }, [species]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return species.filter((item) => {
      const matchesSearch =
        query === '' ||
        [item.scientific_name, item.common_name, item.local_name].some((name) =>
          name?.toLowerCase().includes(query)
        );
      const matchesStatus =
        statusFilter === null || statusCode(item) === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [search, species, statusFilter]);

  const updatedText = lastUpdated
    ? new Date(lastUpdated).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const chooseStatus = (value: string | null) => {
    setStatusFilter(value);
    setFilterOpen(false);
  };

  const renderEmpty = () => {
    if (species.length === 0 && loading) {
      return (
        <View style={styles.centerBox}>
          <ActivityIndicator color="#213B2A" />
        </View>
      );
    }

    if (species.length === 0 && error) {
      return (
        <View style={styles.centerBox}>
          <Text style={styles.emptyTitle}>Couldn't load the species list</Text>
          <Text style={styles.emptyText}>
            Connect to refresh the species catalogue. The last saved catalogue remains available offline.
          </Text>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void loadSpecies()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <Text style={styles.emptyText}>
        No species match your search or filter.
      </Text>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>
          Species <Text style={styles.titleAccent}>Reference</Text>
        </Text>

        {canPropose && (
          <TouchableOpacity
            style={styles.proposeBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/propose-species' as any)}
          >
            <Text style={styles.proposeBtnText}>+ Propose new species</Text>
          </TouchableOpacity>
        )}

        <TextInput
          style={styles.searchBar}
          placeholder="Search scientific, common or local name"
          placeholderTextColor="#8C9A91"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        {error && species.length > 0 && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              Couldn't refresh — showing the catalogue saved on this phone
              {updatedText ? ` (updated ${updatedText})` : ''}.
            </Text>
          </View>
        )}

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.filterPill,
              (statusFilter !== null || filterOpen) && styles.filterPillActive,
            ]}
            onPress={() => setFilterOpen((open) => !open)}
          >
            <Text
              style={[
                styles.filterText,
                statusFilter !== null && styles.filterTextActive,
              ]}
              numberOfLines={1}
            >
              {statusFilter ? statusLabel(statusFilter) : 'Conservation status'}{' '}
              {filterOpen ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>
        </View>

        {filterOpen && (
          <View style={styles.optionPanel}>
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => chooseStatus(null)}
            >
              <Text
                style={[
                  styles.optionText,
                  statusFilter === null && styles.optionTextSelected,
                ]}
              >
                All statuses
              </Text>
              {statusFilter === null && <Text style={styles.optionCheck}>✓</Text>}
            </TouchableOpacity>

            {statusOptions.map((code) => (
              <TouchableOpacity
                key={code}
                style={styles.optionRow}
                onPress={() => chooseStatus(code)}
              >
                <Text
                  style={[
                    styles.optionText,
                    statusFilter === code && styles.optionTextSelected,
                  ]}
                >
                  {code === 'NA'
                    ? statusLabel(code)
                    : `${statusLabel(code)} (${code})`}
                </Text>
                {statusFilter === code && <Text style={styles.optionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {species.length > 0 && (
          <View style={styles.countRow}>
            <Text style={styles.countBanner}>
              {filtered.length === species.length
                ? `${species.length} species · automatically synced`
                : `Showing ${filtered.length} of ${species.length} species`}
            </Text>
            {statusFilter !== null && (
              <TouchableOpacity onPress={() => chooseStatus(null)} hitSlop={8}>
                <Text style={styles.clearText}>Clear filter</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          refreshing={loading && species.length > 0}
          onRefresh={() => {
            void loadSpecies();
            if (canPropose) void refreshProposalStatuses();
          }}
          ListHeaderComponent={canPropose ? renderProposals : undefined}
          ListEmptyComponent={renderEmpty}
          renderItem={({ item }) => {
            const code = statusCode(item);
            const badge = getStatusColor(code);
            const subtitle =
              item.common_name || item.local_name || 'No common name recorded';

            return (
              <TouchableOpacity
                style={styles.speciesCard}
                activeOpacity={0.7}
                onPress={() =>
                  router.push({
                    pathname: '/species-reference/[id]',
                    params: { id: item.id },
                  } as any)
                }
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.speciesName}>{item.scientific_name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.statusText, { color: badge.text }]}>
                        {code === 'NA' ? 'Not assessed' : code}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.speciesSub,
                      !item.common_name &&
                        !item.local_name &&
                        styles.speciesSubEmpty,
                    ]}
                  >
                    {subtitle}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
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
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22', marginBottom: 14 },
  titleAccent: { color: '#6B8F72' },
  searchBar: {
    backgroundColor: '#FFFFFF',
    height: 50,
    borderRadius: 25,
    paddingHorizontal: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 12,
    color: '#1E2B22',
  },
  offlineBanner: {
    backgroundColor: '#FFF7DB',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  offlineText: { fontSize: 12.5, color: '#6B5310', lineHeight: 17 },
  filterRow: { flexDirection: 'row', marginBottom: 12 },
  filterPill: {
    flexShrink: 1,
    backgroundColor: '#FFFFFF',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DCE4DF',
    marginRight: 8,
  },
  filterPillActive: { borderColor: '#213B2A', backgroundColor: '#EEF5F0' },
  filterText: { fontSize: 12.5, fontWeight: '600', color: '#4E6254' },
  filterTextActive: { color: '#213B2A', fontWeight: '700' },
  optionPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCE4DF',
    marginBottom: 12,
    paddingVertical: 4,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  optionText: { fontSize: 13.5, color: '#3A5243' },
  optionTextSelected: { color: '#213B2A', fontWeight: '700' },
  optionCheck: { fontSize: 14, color: '#213B2A', fontWeight: '800' },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  countBanner: { fontSize: 12.5, color: '#5B6B60', fontWeight: '500' },
  clearText: { fontSize: 12.5, color: '#213B2A', fontWeight: '700' },
  centerBox: { alignItems: 'center', marginTop: 40, paddingHorizontal: 20 },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B22',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#5B6B60',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: '#213B2A',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 24,
  },
  retryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  speciesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 24,
    marginBottom: 10,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  speciesName: {
    fontSize: 15,
    fontWeight: '700',
    fontStyle: 'italic',
    color: '#1E2B22',
  },
  statusBadge: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: { fontSize: 10.5, fontWeight: '800' },
  speciesSub: { fontSize: 12.5, color: '#5B6B60', marginTop: 4 },
  speciesSubEmpty: { fontStyle: 'italic', color: '#8C9A91' },
  chevron: { fontSize: 22, color: '#88988D', marginLeft: 8 },
  proposeBtn: {
    borderWidth: 1.2,
    borderColor: '#213B2A',
    borderRadius: 22,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  proposeBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 13.5 },
  proposalSection: { marginBottom: 14 },
  proposalHeading: { fontSize: 13, fontWeight: '800', color: '#4E6254', marginBottom: 8 },
  proposalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    borderStyle: 'dashed',
    marginBottom: 8,
  },
  proposalComment: { fontSize: 12, color: '#9B1C1C', marginTop: 6 },
  proposalActions: { flexDirection: 'row', gap: 18, marginTop: 8, alignItems: 'center' },
  proposalAction: { fontSize: 12.5, fontWeight: '700', color: '#213B2A', textDecorationLine: 'underline' },
  proposalRemove: { color: '#9B1C1C' },
});
