import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, FlatList, SafeAreaView, StatusBar, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useRecordStore, RecordStatus } from '../../src/store/useRecordStore';

export default function HomeScreen() {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRecords = records.filter(
    (item) => item.scientificName.toLowerCase().includes(searchQuery.toLowerCase()) || item.locationName.toLowerCase().includes(searchQuery.toLowerCase())
  );

 const getStatusStyle = (status: string) => {
    switch (status) {
      case RecordStatus.SYNCED:
        return { bg: '#AECBB7', text: '#20402C' };
      case RecordStatus.PENDING:
        return { bg: '#F8DB96', text: '#7C4A03' };
      case RecordStatus.FAILED:
        return { bg: '#F8B4B4', text: '#771D1D' };
      default:
        return { bg: '#DDE5E0', text: '#3E5044' };
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F6F8F6" />
      <View style={styles.container}>
        
        <View style={styles.topHeader}>
          <Text style={styles.brandTitle}>Niah BioTrack</Text>
        </View>

        <View style={styles.searchBarContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput style={styles.searchInput} placeholder="Search species" placeholderTextColor="#8C9A91" value={searchQuery} onChangeText={setSearchQuery} />
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.bigCard, styles.scanCard]} activeOpacity={0.85} onPress={() => router.push('/scan-qr' as any)}>
            <Text style={{fontSize: 32}}>📷</Text>
            <Text style={styles.bigCardText}>Scan QR</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.bigCard, styles.newRecordCard]} activeOpacity={0.85} onPress={() => router.push('/new-record' as any)}>
            <Text style={{fontSize: 32}}>➕</Text>
            <Text style={styles.bigCardText}>New Record</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Records</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/records' as any)}><Text style={styles.seeAllText}>See All</Text></TouchableOpacity>
        </View>

        {filteredRecords.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No records logged yet</Text>
            <Text style={styles.emptySubtitle}>Tap "New Record" above to document your first plant observation.</Text>
          </View>
        ) : (
          <FlatList
            data={filteredRecords}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const badge = getStatusStyle(item.status);
              return (
                <TouchableOpacity style={styles.pillCard} activeOpacity={0.7} onPress={() => router.push({ pathname: '/plant-detail', params: { id: item.recordId } } as any)}>
                  <View style={styles.cardLeft}>
                    <Text style={styles.speciesName}>{item.scientificName}</Text>
                    <Text style={styles.locationSubtitle}>{item.locationName}</Text>
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
  safeArea: { flex: 1, backgroundColor: '#F6F8F6',paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 22, paddingTop: 16 },
  topHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, marginTop: 6 },
  brandTitle: { fontSize: 24, fontWeight: '800', color: '#213B2A', letterSpacing: -0.4 },
  searchBarContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', height: 54, borderRadius: 27, paddingHorizontal: 18, marginBottom: 20, borderWidth: 1.2, borderColor: '#E6ECE8', elevation: 1 },
  searchIcon: { fontSize: 16, color: '#8C9A91', marginRight: 10 },
  searchInput: { flex: 1, fontSize: 15, color: '#1E2B22' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  bigCard: { flex: 1, height: 150, borderRadius: 24, justifyContent: 'center', alignItems: 'center', elevation: 1 },
  scanCard: { backgroundColor: '#DDEAE2', marginRight: 10, borderWidth: 1, borderColor: '#D0E0D6' },
  newRecordCard: { backgroundColor: '#EEF4F0', marginLeft: 10, borderWidth: 1, borderColor: '#E2ECE5' },
  bigCardText: { fontSize: 16, fontWeight: '700', color: '#233F2E', marginTop: 14 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#213B2A' },
  seeAllText: { fontSize: 13, color: '#526659', fontWeight: '600' },
  listContent: { paddingBottom: 24 },
  pillCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', paddingVertical: 18, paddingHorizontal: 22, borderRadius: 28, marginBottom: 12, borderWidth: 1.2, borderColor: '#E7EEE9', elevation: 1 },
  cardLeft: { flex: 1, paddingRight: 10 },
  speciesName: { fontSize: 16, fontWeight: '700', color: '#22382A', marginBottom: 4 },
  locationSubtitle: { fontSize: 13, color: '#6F8074' },
  statusBadge: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 20 },
  statusBadgeText: { fontSize: 13, fontWeight: '700' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 40, paddingHorizontal: 20 },
  emptyIcon: { fontSize: 42, marginBottom: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#22382A' },
  emptySubtitle: { fontSize: 13, color: '#718377', textAlign: 'center', marginTop: 4, lineHeight: 18 },
});