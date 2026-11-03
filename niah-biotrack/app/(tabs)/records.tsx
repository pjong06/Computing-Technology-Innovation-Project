import React, { useState } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  IdentificationStatus,
  SyncStatus,
  useRecordStore,
} from '../../src/store/useRecordStore';

type RecordFilter = 'All' | 'Needs identification' | SyncStatus;

export default function RecordsScreen() {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const [selectedTab, setSelectedTab] = useState<RecordFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const countAll = records.length;
  const countSynced = records.filter((r) => r.syncStatus === SyncStatus.UPLOADED).length;
  const countPending = records.filter((r) => r.syncStatus === SyncStatus.NOT_UPLOADED).length;
  const countFailed = records.filter((r) => r.syncStatus === SyncStatus.FAILED).length;
  const countNeedsIdentification = records.filter(
    (record) => record.identificationStatus === IdentificationStatus.PENDING
  ).length;

  const filtered = records.filter((r) => {
    const matchesTab =
      selectedTab === 'All'
        ? true
        : selectedTab === 'Needs identification'
          ? r.identificationStatus === IdentificationStatus.PENDING
          : r.syncStatus === selectedTab;
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const matchesQuery = [r.scientificName, r.commonName, r.family, r.locationName]
      .some((value) => value?.toLowerCase().includes(normalizedQuery));
    return matchesTab && matchesQuery;
  });

  const getStatusBadge = (status: SyncStatus) => {
    switch (status) {
      case SyncStatus.UPLOADED:
        return { bg: '#E4F2E7', text: '#215A36' };
      case SyncStatus.NOT_UPLOADED:
        return { bg: '#FDF4D8', text: '#8C5E03' };
      case SyncStatus.FAILED:
        return { bg: '#FDE2E2', text: '#9B1C1C' };
      case SyncStatus.LOCAL_ONLY:
        return { bg: '#E8ECE9', text: '#526158' };
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.headerTitle}>My Records</Text>

        <TextInput
          style={styles.searchBar}
          placeholder="Search my records"
          placeholderTextColor="#8C9A91"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        {/* Record workflow and upload-state filters */}
        <View style={styles.tabBar}>
          {([
            { label: 'All', value: 'All', count: countAll },
            { label: 'Identify', value: 'Needs identification', count: countNeedsIdentification },
            { label: 'Synced', value: SyncStatus.UPLOADED, count: countSynced },
            { label: 'Pending', value: SyncStatus.NOT_UPLOADED, count: countPending },
            { label: 'Failed', value: SyncStatus.FAILED, count: countFailed },
          ] as { label: string; value: RecordFilter; count: number }[]).map((tab) => {
            const isActive = selectedTab === tab.value;
            return (
              <TouchableOpacity
                key={tab.label}
                onPress={() => setSelectedTab(tab.value)}
                style={[styles.tabItem, isActive && styles.activeTabBorder]}
              >
                <Text style={[styles.tabLabel, isActive && styles.activeTabLabel]}>
                  {tab.label} {tab.count}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {filtered.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No records yet</Text>
            <Text style={styles.emptySub}>
              Plants you record in the field will appear here even before they sync.
            </Text>
            <TouchableOpacity
              style={styles.primaryPillBtn}
              onPress={() => router.push('/new-record' as any)}
            >
              <Text style={styles.primaryPillText}>+ Record your first plant</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryPillBtn}
              onPress={() => router.push('/(tabs)/scan' as any)}
            >
              <Text style={styles.secondaryPillText}>Scan an existing tag</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            renderItem={({ item }) => {
              const badge = getStatusBadge(item.syncStatus);
              return (
                <TouchableOpacity
                  style={styles.recordCard}
                  activeOpacity={0.7}
                  onPress={() =>
                    router.push({ pathname: '/plant-detail', params: { id: item.id } } as any)
                  }
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recordSpecies}>
                      {item.scientificName || 'Identification pending'}
                    </Text>
                    <Text style={styles.recordMeta}>
                      {item.locationName} · {item.createdAt}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          item.identificationStatus === IdentificationStatus.PENDING
                            ? '#FDF4D8'
                            : badge.bg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        {
                          color:
                            item.identificationStatus === IdentificationStatus.PENDING
                              ? '#8C5E03'
                              : badge.text,
                        },
                      ]}
                    >
                      • {item.identificationStatus === IdentificationStatus.PENDING ? 'Identify later' : item.syncStatus}
                    </Text>
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
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1E2B22', marginBottom: 14 },
  searchBar: {
    backgroundColor: '#FFFFFF',
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 18,
    fontSize: 13.5,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 14,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#DEE4DF',
    marginBottom: 16,
  },
  tabItem: { paddingBottom: 10, paddingHorizontal: 6 },
  activeTabBorder: { borderBottomWidth: 2.5, borderBottomColor: '#213B2A' },
  tabLabel: { fontSize: 13, color: '#68776D', fontWeight: '500' },
  activeTabLabel: { color: '#213B2A', fontWeight: '700' },
  recordCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 24,
    marginBottom: 10,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  recordSpecies: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  recordMeta: { fontSize: 12.5, color: '#68776D', marginTop: 4 },
  statusBadge: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 16 },
  statusBadgeText: { fontSize: 11.5, fontWeight: '700' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
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
