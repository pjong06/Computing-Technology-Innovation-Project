import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { useRecordStore } from '../../src/store/useRecordStore';

const SPECIES_CATALOG = [
  { id: '1', name: 'Rafflesia tuan-mudae', status: 'EN', loc: 'West trail junction' },
  { id: '2', name: 'Nepenthes ampullaria', status: 'LC', loc: 'Cave entrance area' },
  { id: '3', name: 'Shorea platyclados', status: 'VU', loc: '2.3 km trail, Niah' },
  { id: '4', name: 'Dipterocarpus caudatus', status: 'VU', loc: 'Bukit Kasut trail' },
  { id: '5', name: 'Eusideroxylon zwageri', status: 'VU', loc: 'Madu trail' },
  { id: '6', name: 'Nepenthes rafflesiana', status: 'LC', loc: 'Plankwalk km 1.2' },
];

const STATUS_LABELS: Record<string, string> = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  LC: 'Least Concern',
};

// Filter options come from the catalog itself, so only values that exist are offered.
const LOCATION_OPTIONS = [...new Set(SPECIES_CATALOG.map((s) => s.loc))].sort();
const STATUS_OPTIONS = Object.keys(STATUS_LABELS).filter((code) => SPECIES_CATALOG.some((s) => s.status === code));

type FilterKey = 'location' | 'status';

export default function SpeciesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const records = useRecordStore((state) => state.records);

  const filtered = SPECIES_CATALOG.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) &&
      (locationFilter === null || s.loc === locationFilter) &&
      (statusFilter === null || s.status === statusFilter)
  );

  const hasFilters = locationFilter !== null || statusFilter !== null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CR':
      case 'EN': return { bg: '#FDE2E2', text: '#9B1C1C' };
      case 'VU': return { bg: '#FEF08A', text: '#854D0E' };
      default: return { bg: '#E4F2E7', text: '#215A36' };
    }
  };

  const toggleFilter = (key: FilterKey) => setOpenFilter((current) => (current === key ? null : key));

  const chooseOption = (value: string | null) => {
    if (openFilter === 'location') setLocationFilter(value);
    if (openFilter === 'status') setStatusFilter(value);
    setOpenFilter(null);
  };

  const clearFilters = () => {
    setLocationFilter(null);
    setStatusFilter(null);
    setOpenFilter(null);
  };

  const openOptions = openFilter === 'location' ? LOCATION_OPTIONS : openFilter === 'status' ? STATUS_OPTIONS : [];
  const openSelected = openFilter === 'location' ? locationFilter : statusFilter;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Species Reference</Text>
        <TextInput
          style={styles.searchBar}
          placeholder="Search scientific name"
          placeholderTextColor="#8C9A91"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterPill, (locationFilter !== null || openFilter === 'location') && styles.filterPillActive]}
            onPress={() => toggleFilter('location')}
          >
            <Text style={[styles.filterText, locationFilter !== null && styles.filterTextActive]} numberOfLines={1}>
              {locationFilter ?? 'Location'} {openFilter === 'location' ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterPill, (statusFilter !== null || openFilter === 'status') && styles.filterPillActive]}
            onPress={() => toggleFilter('status')}
          >
            <Text style={[styles.filterText, statusFilter !== null && styles.filterTextActive]} numberOfLines={1}>
              {statusFilter ? STATUS_LABELS[statusFilter] : 'Conservation status'} {openFilter === 'status' ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>
        </View>

        {openFilter !== null && (
          <View style={styles.optionPanel}>
            <TouchableOpacity style={styles.optionRow} onPress={() => chooseOption(null)}>
              <Text style={[styles.optionText, openSelected === null && styles.optionTextSelected]}>
                {openFilter === 'location' ? 'All locations' : 'All statuses'}
              </Text>
              {openSelected === null && <Text style={styles.optionCheck}>✓</Text>}
            </TouchableOpacity>
            {openOptions.map((option) => (
              <TouchableOpacity key={option} style={styles.optionRow} onPress={() => chooseOption(option)}>
                <Text style={[styles.optionText, openSelected === option && styles.optionTextSelected]}>
                  {openFilter === 'status' ? `${STATUS_LABELS[option]} (${option})` : option}
                </Text>
                {openSelected === option && <Text style={styles.optionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.countRow}>
          <Text style={styles.countBanner}>
            Showing {filtered.length} of {SPECIES_CATALOG.length} species
          </Text>
          {hasFilters && (
            <TouchableOpacity onPress={clearFilters} hitSlop={8}>
              <Text style={styles.clearText}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          ListEmptyComponent={<Text style={styles.emptyText}>No species match your search or filters.</Text>}
          renderItem={({ item }) => {
            const badge = getStatusColor(item.status);
            const matchedRecord = records.find((r) => r.scientificName === item.name);
            return (
              <TouchableOpacity
                style={styles.speciesCard}
                onPress={() => router.push({ pathname: '/plant-detail', params: { id: matchedRecord?.id || item.id, name: item.name } } as any)}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.speciesName}>{item.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.statusText, { color: badge.text }]}>{item.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.speciesLoc}>{item.loc}</Text>
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
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#213B2A', marginBottom: 14 },
  searchBar: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 12 },
  filterRow: { flexDirection: 'row', marginBottom: 12 },
  filterPill: { flexShrink: 1, backgroundColor: '#FFFFFF', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#DCE4DF', marginRight: 8 },
  filterPillActive: { borderColor: '#213B2A', backgroundColor: '#EEF5F0' },
  filterText: { fontSize: 12, fontWeight: '600', color: '#4E6254' },
  filterTextActive: { color: '#213B2A', fontWeight: '700' },
  optionPanel: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#DCE4DF', marginBottom: 12, paddingVertical: 4 },
  optionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 16 },
  optionText: { fontSize: 13.5, color: '#3A5243' },
  optionTextSelected: { color: '#213B2A', fontWeight: '700' },
  optionCheck: { fontSize: 14, color: '#213B2A', fontWeight: '800' },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  countBanner: { fontSize: 12.5, color: '#68776D', fontWeight: '500' },
  clearText: { fontSize: 12.5, color: '#213B2A', fontWeight: '700' },
  emptyText: { fontSize: 13, color: '#68776D', textAlign: 'center', marginTop: 24 },
  speciesCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 18, borderRadius: 24, marginBottom: 10, borderWidth: 1.2, borderColor: '#E6ECE8' },
  speciesName: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  statusBadge: { marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 10.5, fontWeight: '800' },
  speciesLoc: { fontSize: 12.5, color: '#68776D', marginTop: 4 },
  chevron: { fontSize: 22, color: '#88988D', marginLeft: 8 },
});
