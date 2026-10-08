import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { useRecordStore, RecordStatus } from '../../src/store/useRecordStore';

export default function RecordsScreen() {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const [selectedTab, setSelectedTab] = useState<string | RecordStatus>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate counts for the tabs
  const countAll = records.length;
  const countSynced = records.filter((r) => r.status === RecordStatus.SYNCED).length;
  const countPending = records.filter((r) => r.status === RecordStatus.PENDING).length;
  const countFailed = records.filter((r) => r.status === RecordStatus.FAILED).length;

  // Filter records based on active tab and search query
  const filteredRecords = records.filter((r) => {
    const matchesTab = selectedTab === 'All' ? true : r.status === selectedTab;
    const matchesQuery = r.scientificName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesQuery;
  });

  const getStatusStyle = (status: string) => {
    switch (status) {
      case RecordStatus.SYNCED: return { bg: '#AECBB7', text: '#20402C' };
      case RecordStatus.PENDING: return { bg: '#F8DB96', text: '#7C4A03' };
      case RecordStatus.FAILED: return { bg: '#F8B4B4', text: '#771D1D' };
      default: return { bg: '#DDE5E0', text: '#3E5044' };
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.headerTitle}>My Records</Text>

        <TextInput
          style={styles.searchBar}
          placeholder="Search records"
          placeholderTextColor="#8C9A91"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        <View style={styles.tabBar}>
          {['All', RecordStatus.SYNCED, RecordStatus.PENDING, RecordStatus.FAILED].map((tab) => {
            const count = tab === 'All' ? countAll : tab === RecordStatus.SYNCED ? countSynced : tab === RecordStatus.PENDING ? countPending : countFailed;
            const isActive = selectedTab === tab;
            return (
              <TouchableOpacity key={tab} onPress={() => setSelectedTab(tab)} style={[styles.tabItem, isActive && styles.activeTabBorder]}>
                <Text style={[styles.tabLabel, isActive && styles.activeTabLabel]}>
                  {tab} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {filteredRecords.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No records found</Text>
          </View>
        ) : (
          <FlatList
            data={filteredRecords}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => {
              const badge = getStatusStyle(item.status);
              return (
                <TouchableOpacity
                  style={styles.recordCard}
                  activeOpacity={0.7}
                  onPress={() =>
                    router.push({
                      pathname: '/plant-detail',
                      params: { id: item.recordId },
                    } as any)
                  }
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recordSpecies}>{item.scientificName}</Text>
                    <Text style={styles.recordMeta}>{item.locationName} · {item.createdAt}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: badge.text }]}>{item.status}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#1E2B22', marginBottom: 14 },
  searchBar: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, fontSize: 13.5, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 14 },
  tabBar: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#DEE4DF', marginBottom: 16 },
  tabItem: { paddingBottom: 10, paddingHorizontal: 4 },
  activeTabBorder: { borderBottomWidth: 2.5, borderBottomColor: '#213B2A' },
  tabLabel: { fontSize: 13, color: '#68776D', fontWeight: '500' },
  activeTabLabel: { color: '#213B2A', fontWeight: '700' },
  recordCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFFFFF', paddingVertical: 18, paddingHorizontal: 20, borderRadius: 28, marginBottom: 10, borderWidth: 1.2, borderColor: '#E6ECE8', elevation: 1 },
  recordSpecies: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  recordMeta: { fontSize: 12.5, color: '#68776D', marginTop: 4 },
  statusBadge: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },
  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#88988D', fontSize: 14, fontWeight: '500' },
});