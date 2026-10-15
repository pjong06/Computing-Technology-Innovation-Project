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
import Toast from 'react-native-toast-message';
import { useRecordStore } from '../../src/store/useRecordStore';
import { useSpeciesStore } from '../../src/store/useSpeciesStore';
import type { Species } from '../../src/api/species';

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

const statusCode = (s: Species) => s.conservation_status?.trim() || 'NA';
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

  const species = useSpeciesStore((s) => s.species);
  const loading = useSpeciesStore((s) => s.loading);
  const error = useSpeciesStore((s) => s.error);
  const lastUpdated = useSpeciesStore((s) => s.lastUpdated);
  const loadSpecies = useSpeciesStore((s) => s.loadSpecies);
  const records = useRecordStore((s) => s.records);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    loadSpecies();
  }, [loadSpecies]);

  const statusOptions = useMemo(() => {
    const codes = new Set(species.map(statusCode));
    const known = STATUS_ORDER.filter((c) => codes.has(c));
    const other = [...codes].filter((c) => !STATUS_ORDER.includes(c));
    return [...known, ...other];
  }, [species]);

  const query = search.trim().toLowerCase();
  const filtered = species.filter((s) => {
    const matchesSearch =
      query === '' ||
      [s.scientific_name, s.common_name, s.local_name].some((name) =>
        name?.toLowerCase().includes(query)
      );
    const matchesStatus = statusFilter === null || statusCode(s) === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const chooseStatus = (value: string | null) => {
    setStatusFilter(value);
    setFilterOpen(false);
  };

  const updatedText = lastUpdated
    ? new Date(lastUpdated).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

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
          <Text style={styles.emptyText}>Check your connection. Once loaded, the list works offline.</Text>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadSpecies}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return <Text style={styles.emptyText}>No species match your search or filter.</Text>;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>
          Species <Text style={styles.titleAccent}>Reference</Text>
        </Text>

        <TextInput
          style={styles.searchBar}
          placeholder="Search scientific or common name"
          placeholderTextColor="#8C9A91"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        {error && species.length > 0 && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              Couldn't refresh - showing the list saved on this phone
              {updatedText ? ` (updated ${updatedText})` : ''}.
            </Text>
          </View>
        )}

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterPill, (statusFilter !== null || filterOpen) && styles.filterPillActive]}
            onPress={() => setFilterOpen((open) => !open)}
          >
            <Text
              style={[styles.filterText, statusFilter !== null && styles.filterTextActive]}
              numberOfLines={1}
            >
              {statusFilter ? statusLabel(statusFilter) : 'Conservation status'}{' '}
              {filterOpen ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>
        </View>

        {filterOpen && (
          <View style={styles.optionPanel}>
            <TouchableOpacity style={styles.optionRow} onPress={() => chooseStatus(null)}>
              <Text style={[styles.optionText, statusFilter === null && styles.optionTextSelected]}>
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
                <Text style={[styles.optionText, statusFilter === code && styles.optionTextSelected]}>
                  {code === 'NA' ? statusLabel(code) : `${statusLabel(code)} (${code})`}
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
                ? `${species.length} species · available offline`
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
          onRefresh={loadSpecies}
          ListEmptyComponent={renderEmpty}
          renderItem={({ item }) => {
            const code = statusCode(item);
            const badge = getStatusColor(code);
            const subtitle = item.common_name || item.local_name || 'No common name recorded';

            const matchedRecord = records.find(
              (r) => r.scientificName.toLowerCase() === item.scientific_name.toLowerCase()
            );

            return (
              <TouchableOpacity
                style={styles.speciesCard}
                activeOpacity={0.7}
                onPress={() => {
                  if (matchedRecord) {
                    router.push({ pathname: '/plant-detail', params: { id: matchedRecord.id } } as any);
                  } else {
                    Toast.show({
                      type: 'info',
                      text1: item.scientific_name,
                      text2: 'No field specimens logged for this species yet.',
                      position: 'bottom',
                    });
                  }
                }}
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
                      !item.common_name && !item.local_name && styles.speciesSubEmpty,
                    ]}
                  >
                    {subtitle}
                  </Text>
                </View>
                {matchedRecord && <Text style={styles.chevron}>›</Text>}
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
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B22', marginBottom: 6, textAlign: 'center' },
  emptyText: { fontSize: 13, color: '#5B6B60', textAlign: 'center', marginTop: 10, lineHeight: 18 },
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
  speciesName: { fontSize: 15, fontWeight: '700', fontStyle: 'italic', color: '#1E2B22' },
  statusBadge: { marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 10.5, fontWeight: '800' },
  speciesSub: { fontSize: 12.5, color: '#5B6B60', marginTop: 4 },
  speciesSubEmpty: { fontStyle: 'italic', color: '#8C9A91' },
  chevron: { fontSize: 22, color: '#88988D', marginLeft: 8 },
});
