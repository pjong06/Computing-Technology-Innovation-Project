import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  Platform,
  StatusBar,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import {
  IdentificationStatus,
  SyncStatus,
  useRecordStore,
} from '../../src/store/useRecordStore';
import { buildSyncSummary } from '../../src/services/syncSummary';

export default function HomeScreen() {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const syncAll = useRecordStore((state) => state.syncAll);
  const syncRecord = useRecordStore((state) => state.syncRecord);

  const [syncingAll, setSyncingAll] = useState(false);
  // IDs of records whose Retry is running, so each row can show its own spinner.
  const [retryingIds, setRetryingIds] = useState<string[]>([]);

  // Same counts the Profile tab uses, worked out from the records on the phone.
  const summary = buildSyncSummary(records, syncingAll);
  const pendingCount = summary.pendingRecordCount;
  const failedCount = summary.failedRecordCount;
  const totalToSync = pendingCount + failedCount;
  const identificationDraftCount = records.filter(
    (record) => record.identificationStatus === IdentificationStatus.PENDING
  ).length;

  const handleSyncNow = async () => {
    setSyncingAll(true);
    // syncAll never throws: every problem comes back as a count.
    const { uploaded, failed, skipped } = await syncAll();
    setSyncingAll(false);

    const parts = [`${uploaded} uploaded`];
    if (failed > 0) parts.push(`${failed} failed`);
    // Only mention skipped records when there are some (they were already uploading).
    if (skipped > 0) parts.push(`${skipped} already uploading`);

    Toast.show({
      type: failed > 0 ? 'error' : 'success',
      text1: failed > 0 ? 'Some records did not upload' : 'Sync complete',
      text2: failed > 0 ? `${parts.join(' · ')}. Tap Retry to try again.` : parts.join(' · '),
      position: 'bottom',
    });
  };

  const handleRetry = async (id: string) => {
    setRetryingIds((ids) => [...ids, id]);
    const result = await syncRecord(id);
    setRetryingIds((ids) => ids.filter((x) => x !== id));

    Toast.show(
      result.ok
        ? { type: 'success', text1: 'Record uploaded', position: 'bottom' }
        : { type: 'error', text1: 'Upload failed', text2: result.reason, position: 'bottom' }
    );
  };

  const getStatusBadge = (status: SyncStatus) => {
    switch (status) {
      case SyncStatus.UPLOADED:
        return { bg: '#E4F2E7', text: '#215A36', label: '• Uploaded' };
      case SyncStatus.NOT_UPLOADED:
        return { bg: '#FDF4D8', text: '#8C5E03', label: '• Not uploaded' };
      case SyncStatus.FAILED:
        return { bg: '#FDE2E2', text: '#9B1C1C', label: '• Upload failed' };
      case SyncStatus.LOCAL_ONLY:
        return { bg: '#E8ECE9', text: '#526158', label: '• Local draft' };
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header with Inline Logo */}
        <View style={styles.headerRow}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <Text style={styles.headerTitle}>Niah Ground-Truth</Text>
        </View>

        {/* Sync status banner */}
        {totalToSync > 0 ? (
          <View style={styles.syncCard}>
            <Text style={styles.syncTitle}>
              {totalToSync} {totalToSync === 1 ? 'record' : 'records'} not yet uploaded
            </Text>
            <Text style={styles.syncSub}>
              {pendingCount} not uploaded{failedCount > 0 ? ` · ${failedCount} failed` : ''} · saved on this device
            </Text>
            <TouchableOpacity
              style={[styles.syncBtn, syncingAll && styles.syncBtnDisabled]}
              onPress={handleSyncNow}
              disabled={syncingAll}
            >
              {syncingAll ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.syncBtnText}>Sync now</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {identificationDraftCount > 0 ? (
          <TouchableOpacity
            style={styles.draftCard}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/records' as any)}
          >
            <Text style={styles.syncTitle}>
              {identificationDraftCount}{' '}
              {identificationDraftCount === 1 ? 'record needs' : 'records need'} identification
            </Text>
            <Text style={styles.syncSub}>
              Field information is saved locally. Continue editing when you can confirm the species.
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* 2x1 Action Cards Grid */}
        <View style={styles.actionGrid}>
          <TouchableOpacity
            style={styles.scanCard}
            activeOpacity={0.85}
            onPress={() => router.push('/(tabs)/scan' as any)}
          >
            <View style={styles.scanIconWrap}>
              <Text style={styles.scanIconGlyph}>⛶</Text>
            </View>
            <Text style={styles.scanCardLabel}>Scan QR</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.newRecordCard}
            activeOpacity={0.85}
            onPress={() => router.push('/new-record' as any)}
          >
            <Text style={styles.newRecordPlus}>+</Text>
            <Text style={styles.newRecordLabel}>New Record</Text>
          </TouchableOpacity>
        </View>

        {/* Record Route Stadium Pill */}
        <TouchableOpacity
          style={styles.routePill}
          activeOpacity={0.85}
          onPress={() => router.push('/record-route' as any)}
        >
          <View style={styles.routeLeft}>
            <Text style={styles.routeIcon}>⥉</Text>
            <Text style={styles.routeLabel}>Record route</Text>
          </View>
          <Text style={styles.routeTag}>works offline</Text>
        </TouchableOpacity>

        {/* Recent records Header */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionHeading}>Recent records</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/records' as any)}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>

        {/* Records list */}
        {records.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No records logged yet</Text>
            <Text style={styles.emptySub}>
              Plants you record in the field will appear here even before they sync.
            </Text>
          </View>
        ) : (
          <FlatList
            data={records.slice(0, 5)}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const badge = getStatusBadge(item.syncStatus);
              return (
                <View style={styles.recordItem}>
                  <TouchableOpacity
                    style={styles.recordCard}
                    activeOpacity={0.7}
                    onPress={() =>
                      router.push({
                        pathname: '/plant-detail',
                        params: { id: item.id },
                      } as any)
                    }
                  >
                    <View style={styles.plantIconCircle}>
                      <Text style={{ fontSize: 20 }}>🌿</Text>
                    </View>
                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                      <Text style={styles.speciesText}>
                        {item.scientificName || 'Identification pending'}
                      </Text>
                      <Text style={styles.locationText}>
                        {item.locationName} · {item.createdAt}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.badgePill,
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
                          styles.badgeText,
                          {
                            color:
                              item.identificationStatus === IdentificationStatus.PENDING
                                ? '#8C5E03'
                                : badge.text,
                          },
                        ]}
                      >
                        {item.identificationStatus === IdentificationStatus.PENDING
                          ? '• Identify later'
                          : badge.label}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {item.syncStatus === SyncStatus.FAILED && (
                    <View style={styles.errorSubRow}>
                      <Text style={styles.errorSubText}>Upload failed</Text>
                      {retryingIds.includes(item.id) ? (
                        <ActivityIndicator size="small" color="#9B1C1C" />
                      ) : (
                        // Disabled during "Sync now", which is already retrying this record.
                        <TouchableOpacity onPress={() => handleRetry(item.id)} disabled={syncingAll}>
                          <Text style={styles.retryBtn}>Retry</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
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
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLogo: {
    width: 38,
    height: 38,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: '#284632',
    letterSpacing: -0.3,
  },
  syncCard: {
    backgroundColor: '#E6EFE9',
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  draftCard: {
    backgroundColor: '#FDF4D8',
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  syncTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#213B2A',
    marginBottom: 4,
  },
  syncSub: {
    fontSize: 12,
    color: '#5C7163',
    marginTop: 2,
  },
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
  syncBtnDisabled: {
    opacity: 0.6,
  },
  syncBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  actionGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  scanCard: {
    flex: 1,
    height: 140,
    backgroundColor: '#DDEAE1',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanIconWrap: {
    marginBottom: 8,
  },
  scanIconGlyph: {
    fontSize: 34,
    color: '#284632',
    fontWeight: '900',
  },
  scanCardLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#284632',
  },
  newRecordCard: {
    flex: 1,
    height: 140,
    backgroundColor: '#284632',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  newRecordPlus: {
    fontSize: 34,
    color: '#FFFFFF',
    fontWeight: '300',
    lineHeight: 36,
    marginBottom: 6,
  },
  newRecordLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  routePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#284632',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  routeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeIcon: {
    fontSize: 18,
    color: '#284632',
    fontWeight: '800',
    marginRight: 10,
  },
  routeLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#284632',
  },
  routeTag: {
    fontSize: 12.5,
    color: '#5C7163',
    fontWeight: '500',
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B22',
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '600',
    color: '#526659',
  },
  recordItem: {
    marginBottom: 10,
  },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 24,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  plantIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E7EFEA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  speciesText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B22',
  },
  locationText: {
    fontSize: 12.5,
    color: '#68776D',
    marginTop: 3,
  },
  badgePill: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  badgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  errorSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FDF2F2',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 4,
  },
  errorSubText: {
    fontSize: 11.5,
    color: '#9B1C1C',
  },
  retryBtn: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#9B1C1C',
    textDecorationLine: 'underline',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 36,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B22',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    color: '#68776D',
    textAlign: 'center',
    lineHeight: 18,
  },
});
