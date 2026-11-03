import React from 'react';
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
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useAuthRole } from '../../src/context/AuthRoleContext';
import { useRecordStore, SyncStatus } from '../../src/store/useRecordStore';

export default function HomeScreen() {
  const router = useRouter();
  const { isVisitor, userName, logout } = useAuthRole();
  const records = useRecordStore((state) => state.records);
  const retryRecord = useRecordStore((state: any) => state.retryRecord);

  const pendingCount = records.filter((r) => r.syncStatus === SyncStatus.NOT_UPLOADED).length;
  const failedCount = records.filter((r) => r.syncStatus === SyncStatus.FAILED).length;
  const totalToSync = pendingCount + failedCount;

  const getStatusBadge = (status: SyncStatus) => {
    switch (status) {
      case SyncStatus.UPLOADED:
        return { bg: '#E4F2E7', text: '#215A36', label: '• Uploaded' };
      case SyncStatus.NOT_UPLOADED:
        return { bg: '#FDF4D8', text: '#8C5E03', label: '• Not uploaded' };
      case SyncStatus.FAILED:
        return { bg: '#FDE2E2', text: '#9B1C1C', label: '• Upload failed' };
      default:
        return { bg: '#FDF4D8', text: '#8C5E03', label: '• Pending' };
    }
  };

  const handleProfilePress = () => {
    if (isVisitor) {
      Alert.alert('Visitor Mode', 'You are browsing as a guest. Switch to Staff Login?', [
        { text: 'Keep Exploring', style: 'cancel' },
        {
          text: 'Staff Sign In',
          onPress: async () => {
            await logout();
            router.replace('/');
          },
        },
      ]);
    } else {
      router.push('/(tabs)/profile');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.roleBanner, isVisitor ? styles.roleBannerVisitor : styles.roleBannerBotanist]}>
        <Ionicons
          name={isVisitor ? 'eye-outline' : 'shield-checkmark-outline'}
          size={15}
          color={isVisitor ? '#0284C7' : '#2D6A4F'}
        />
        <Text style={[styles.roleBannerText, { color: isVisitor ? '#0369A1' : '#2D6A4F' }]}>
          {isVisitor ? 'Visitor Mode: Read-Only Botanical Guide' : 'Authorized Staff: Full Research Access'}
        </Text>
      </View>

      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.headerLogo}
              resizeMode="contain"
            />
            <View>
              <Text style={styles.headerTitle}>Niah BioTrack</Text>
              <Text style={styles.headerSubtitle}>Hello, {userName}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleProfilePress} style={styles.profileBtn}>
            <Ionicons
              name={isVisitor ? 'compass-outline' : 'person-circle-outline'}
              size={32}
              color="#284632"
            />
          </TouchableOpacity>
        </View>

        {!isVisitor ? (
          <>
            {totalToSync > 0 && (
              <View style={styles.syncCard}>
                <Text style={styles.syncTitle}>
                  {totalToSync} {totalToSync === 1 ? 'record' : 'records'} pending sync
                </Text>
                <Text style={styles.syncSub}>
                  {pendingCount} queued{failedCount > 0 ? ` · ${failedCount} failed` : ''} · local storage safe
                </Text>
              </View>
            )}

            <View style={styles.actionGrid}>
              <TouchableOpacity
                style={styles.scanCard}
                activeOpacity={0.85}
                onPress={() => router.push('/(tabs)/scan')}
              >
                <View style={styles.scanIconWrap}>
                  <Ionicons name="scan-outline" size={32} color="#284632" />
                </View>
                <Text style={styles.scanCardLabel}>Scan Tag</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.newRecordCard}
                activeOpacity={0.85}
                onPress={() => router.push('/add-observation')}
              >
                <Ionicons name="add-circle-outline" size={32} color="#FFFFFF" />
                <Text style={styles.newRecordLabel}>Add Observation</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.routePill}
              activeOpacity={0.85}
              onPress={() => router.push('/record-route')}
            >
              <View style={styles.routeLeft}>
                <Ionicons name="navigate-outline" size={20} color="#284632" style={{ marginRight: 8 }} />
                <Text style={styles.routeLabel}>Record Transect Route</Text>
              </View>
              <Text style={styles.routeTag}>GPS Canvas</Text>
            </TouchableOpacity>

            <View style={styles.sectionRow}>
              <Text style={styles.sectionHeading}>Recent Field Records</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/records')}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>

            {records.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyTitle}>No records logged yet</Text>
                <Text style={styles.emptySub}>
                  Field observations recorded on patrols will appear here automatically.
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
                          })
                        }
                      >
                        <View style={styles.plantIconCircle}>
                          <Ionicons name="leaf" size={20} color="#2D6A4F" />
                        </View>
                        <View style={{ flex: 1, marginHorizontal: 12 }}>
                          <Text style={styles.speciesText}>{item.scientificName}</Text>
                          <Text style={styles.locationText}>
                            {item.locationName} · {item.createdAt}
                          </Text>
                        </View>
                        <View style={[styles.badgePill, { backgroundColor: badge.bg }]}>
                          <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
                        </View>
                      </TouchableOpacity>

                      {item.syncStatus === SyncStatus.FAILED && (
                        <View style={styles.errorSubRow}>
                          <Text style={styles.errorSubText}>Upload failed</Text>
                          <TouchableOpacity
                            onPress={() => {
                              if (retryRecord) retryRecord(item.id);
                              Toast.show({ type: 'info', text1: 'Retrying sync...' });
                            }}
                          >
                            <Text style={styles.retryBtn}>Retry</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                }}
              />
            )}
          </>
        ) : (
          <View style={styles.visitorSection}>
            <TouchableOpacity
              style={styles.visitorHeroCard}
              activeOpacity={0.85}
              onPress={() => router.push('/(tabs)/scan')}
            >
              <View style={styles.visitorHeroInfo}>
                <View style={styles.visitorBadge}>
                  <Ionicons name="scan" size={12} color="#CCFBF1" />
                  <Text style={styles.visitorBadgeText}>TREE IDENTIFIER</Text>
                </View>
                <Text style={styles.visitorHeroTitle}>Scan Tree Plaques</Text>
                <Text style={styles.visitorHeroSub}>
                  Scan QR codes affixed to trees along Niah Park trails to read botanical data and historical facts.
                </Text>
              </View>
              <View style={styles.visitorHeroIconCircle}>
                <Ionicons name="camera" size={22} color="#FFFFFF" />
              </View>
            </TouchableOpacity>

            <View style={styles.actionGrid}>
              <TouchableOpacity
                style={styles.visitorNavCard}
                onPress={() => router.push('/(tabs)/species')}
              >
                <Ionicons name="book-outline" size={26} color="#059669" />
                <Text style={styles.visitorNavTitle}>Flora Guide</Text>
                <Text style={styles.visitorNavSub}>Park species catalog</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.visitorNavCard}
                onPress={() => router.push('/(tabs)/records')}
              >
                <Ionicons name="images-outline" size={26} color="#0284C7" />
                <Text style={styles.visitorNavTitle}>Sightings</Text>
                <Text style={styles.visitorNavSub}>Verified photos</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.readOnlyNoticeBox}>
              <Ionicons name="information-circle-outline" size={20} color="#0369A1" />
              <Text style={styles.readOnlyNoticeText}>
                You are currently in <Text style={{ fontWeight: '800' }}>Visitor Mode</Text>. You have full view access. Submitting observations and GPS paths is restricted to Forestry staff.
              </Text>
            </View>
          </View>
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
  roleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  roleBannerVisitor: { backgroundColor: '#E0F2FE' },
  roleBannerBotanist: { backgroundColor: '#E8F5E9' },
  roleBannerText: { fontSize: 12, fontWeight: '700' },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerLogo: { width: 38, height: 38, marginRight: 10 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#284632' },
  headerSubtitle: { fontSize: 12, color: '#68776D', fontWeight: '600' },
  profileBtn: { padding: 4 },
  syncCard: {
    backgroundColor: '#E6EFE9',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  syncTitle: { fontSize: 13.5, fontWeight: '700', color: '#213B2A' },
  syncSub: { fontSize: 11.5, color: '#5C7163', marginTop: 2 },
  actionGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  scanCard: {
    flex: 1,
    height: 120,
    backgroundColor: '#DDEAE1',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanIconWrap: { marginBottom: 6 },
  scanCardLabel: { fontSize: 14.5, fontWeight: '700', color: '#284632' },
  newRecordCard: {
    flex: 1,
    height: 120,
    backgroundColor: '#284632',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  newRecordLabel: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  routePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#284632',
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  routeLeft: { flexDirection: 'row', alignItems: 'center' },
  routeLabel: { fontSize: 14, fontWeight: '700', color: '#284632' },
  routeTag: { fontSize: 11.5, color: '#5C7163', fontWeight: '700' },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionHeading: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  seeAll: { fontSize: 12.5, fontWeight: '600', color: '#526659' },
  recordItem: { marginBottom: 8 },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  plantIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E7EFEA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  speciesText: { fontSize: 14, fontWeight: '700', color: '#1E2B22' },
  locationText: { fontSize: 12, color: '#68776D', marginTop: 2 },
  badgePill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  errorSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FDF2F2',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    marginTop: 4,
  },
  errorSubText: { fontSize: 11, color: '#9B1C1C' },
  retryBtn: { fontSize: 11, fontWeight: '700', color: '#9B1C1C', textDecorationLine: 'underline' },
  emptyContainer: { alignItems: 'center', paddingVertical: 30 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B22', marginBottom: 4 },
  emptySub: { fontSize: 12.5, color: '#68776D', textAlign: 'center', lineHeight: 17 },
  visitorSection: { marginTop: 6 },
  visitorHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#134E4A',
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
  },
  visitorHeroInfo: { flex: 1, paddingRight: 10 },
  visitorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 8,
  },
  visitorBadgeText: { fontSize: 10, fontWeight: '800', color: '#CCFBF1' },
  visitorHeroTitle: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  visitorHeroSub: { fontSize: 12, color: '#CCFBF1', marginTop: 4, lineHeight: 16 },
  visitorHeroIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0D9488',
    justifyContent: 'center',
    alignItems: 'center',
  },
  visitorNavCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    gap: 4,
  },
  visitorNavTitle: { fontSize: 14, fontWeight: '800', color: '#213B2A' },
  visitorNavSub: { fontSize: 11, color: '#76877B' },
  readOnlyNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
  },
  readOnlyNoticeText: { flex: 1, fontSize: 12, color: '#0369A1', lineHeight: 17 },
});