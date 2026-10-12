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

export default function SpeciesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const records = useRecordStore((state) => state.records);

  const filtered = SPECIES_CATALOG.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'EN': return { bg: '#FDE2E2', text: '#9B1C1C' };
      case 'VU': return { bg: '#FEF08A', text: '#854D0E' };
      default: return { bg: '#E4F2E7', text: '#215A36' };
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Species Reference</Text>
        <TextInput
          style={styles.searchBar}
          placeholder="Search scientific or common name"
          placeholderTextColor="#8C9A91"
          value={search}
          onChangeText={setSearch}
        />

        <View style={styles.filterRow}>
          <TouchableOpacity style={styles.filterPill}><Text style={styles.filterText}>Category ▾</Text></TouchableOpacity>
          <TouchableOpacity style={styles.filterPill}><Text style={styles.filterText}>Location ▾</Text></TouchableOpacity>
          <TouchableOpacity style={styles.filterPill}><Text style={styles.filterText}>Conservation status ▾</Text></TouchableOpacity>
        </View>

        <Text style={styles.countBanner}>48 species available offline</Text>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const badge = getStatusColor(item.status);
            const matchedRecord = records.find((r) => r.scientificName === item.name);
            return (
              <TouchableOpacity
                style={styles.speciesCard}
                onPress={() => router.push({ pathname: '/plant-detail', params: { id: matchedRecord?.recordId || item.id, name: item.name } } as any)}
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
  filterPill: { backgroundColor: '#FFFFFF', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#DCE4DF', marginRight: 8 },
  filterText: { fontSize: 12, fontWeight: '600', color: '#4E6254' },
  countBanner: { fontSize: 12.5, color: '#68776D', marginBottom: 14, fontWeight: '500' },
  speciesCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 18, borderRadius: 24, marginBottom: 10, borderWidth: 1.2, borderColor: '#E6ECE8' },
  speciesName: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  statusBadge: { marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 10.5, fontWeight: '800' },
  speciesLoc: { fontSize: 12.5, color: '#68776D', marginTop: 4 },
  chevron: { fontSize: 22, color: '#88988D', marginLeft: 8 },
});