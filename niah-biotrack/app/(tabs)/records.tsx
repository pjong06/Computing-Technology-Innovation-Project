import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { useRecordStore } from '../../src/store/useRecordStore';

export default function RecordsScreen() {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const [tab, setTab] = useState('All');
  const [search, setSearch] = useState('');

  const filtered = records.filter(r => (tab === 'All' || r.status === tab) && r.scientificName.toLowerCase().includes(search.toLowerCase()));

  const getBadge = (status: string) => {
    switch (status) {
      case 'Synced': return { bg: '#AECBB7', text: '#20402C' };
      case 'Pending': return { bg: '#F8DB96', text: '#7C4A03' };
      default: return { bg: '#F8B4B4', text: '#771D1D' };
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.headerTitle}>My Records</Text>
        <TextInput style={styles.searchBar} placeholder="Search records" value={search} onChangeText={setSearch} />
        
        <View style={styles.tabBar}>
          {['All', 'Synced', 'Pending', 'Failed'].map(t => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tabItem, tab === t && styles.activeTab]}>
              <Text style={[styles.tabLabel, tab === t && {color: '#213B2A', fontWeight:'700'}]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const badge = getBadge(item.status);
            return (
              <TouchableOpacity style={styles.pillCard} onPress={() => router.push({ pathname: '/plant-detail', params: { id: item.recordId } } as any)}>
                <View><Text style={styles.speciesName}>{item.scientificName}</Text><Text style={styles.locationSubtitle}>{item.locationName}</Text></View>
                <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}><Text style={[styles.statusBadgeText, { color: badge.text }]}>{item.status}</Text></View>
              </TouchableOpacity>
            )
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6' },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#1E2B22', marginBottom: 14 },
  searchBar: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 14 },
  tabBar: { flexDirection: 'row', justifyContent: 'space-around', borderBottomWidth: 1, borderBottomColor: '#DEE4DF', marginBottom: 16 },
  tabItem: { paddingBottom: 10 },
  activeTab: { borderBottomWidth: 2.5, borderBottomColor: '#213B2A' },
  tabLabel: { fontSize: 13, color: '#68776D', fontWeight: '500' },
  pillCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', padding: 18, borderRadius: 24, marginBottom: 10, borderWidth: 1.2, borderColor: '#E6ECE8' },
  speciesName: { fontSize: 16, fontWeight: '700', color: '#1E2B22' },
  locationSubtitle: { fontSize: 13, color: '#68776D', marginTop: 4 },
  statusBadge: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },
});