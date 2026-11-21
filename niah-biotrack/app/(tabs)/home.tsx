import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  StatusBar,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useAuthRole } from '../../src/context/AuthRoleContext';
import { useRecordStore, SyncStatus, IdentificationStatus } from '../../src/store/useRecordStore';
import { buildSyncSummary } from '../../src/services/syncSummary';
import {
  resumeAllPausedRecordRetries,
  resumePausedRecordRetries,
} from '../../src/services/offlineDatabase';
import { pullServerRecords, serverPullError } from '../../src/services/serverPull';
import { useProposalStore } from '../../src/store/useProposalStore';
import { useSpeciesStore } from '../../src/store/useSpeciesStore';
import { conservationStatusColors, plainConservationStatus } from '../../src/utils/conservationStatus';
import { routesUploadedText } from '../../src/utils/routeSync';
import { plantPhotoCaption } from '../../src/utils/plantPhotoCaption';
import { BASE_URL } from '../../src/api/client';
import PlantThumbnail from '../../src/components/PlantThumbnail';
import { thumbnailSources } from '../../src/utils/thumbnailSources';
import RecentActivity from '../../src/components/RecentActivity';

const FEATURED_COUNT = 4;

export default function HomeScreen() {
  const router = useRouter();
  const { isVisitor, userName, logout } = useAuthRole();
  const refreshReviewStatuses = useRecordStore((state) => state.refreshReviewStatuses);

  useFocusEffect(
    React.useCallback(() => {
      if (!isVisitor) void refreshReviewStatuses();
    }, [isVisitor, refreshReviewStatuses])
  );

  const species = useSpeciesStore((state) => state.species);
  const loadSpecies = useSpeciesStore((state) => state.loadSpecies);
  const featured = species.slice(0, FEATURED_COUNT);

  useEffect(() => {
    if (isVisitor) void loadSpecies();
  }, [isVisitor, loadSpecies]);


  const records = useRecordStore((state) => state.records);
  const syncAll = useRecordStore((state) => state.syncAll);
  const syncRoutes = useRecordStore((state) => state.syncRoutes);
  const syncRecord = useRecordStore((state) => state.syncRecord);
  const unsentRouteCount = useRecordStore(
    (state) => state.routes.filter((route) => route.syncStatus !== 'uploaded').length
  );
  const syncAllProposals = useProposalStore((state) => state.syncAllProposals);
  const refreshProposalStatuses = useProposalStore((state) => state.refreshProposalStatuses);

  const [syncingAll, setSyncingAll] = useState(false);
  const [retryingIds, setRetryingIds] = useState<string[]>([]);

  const summary = buildSyncSummary(records, syncingAll);
  const pendingCount = summary.pendingRecordCount;
  const failedCount = summary.failedRecordCount;
  const totalToSync = pendingCount + failedCount;
  const unsentProposalCount = useProposalStore(
    (state) => state.proposals.filter((p) => p.syncStatus !== SyncStatus.UPLOADED).length
  );
  const identificationDraftCount = records.filter(
    (record) => record.identificationStatus === IdentificationStatus.PENDING
  ).length;

  const handleSyncNow = async () => {
    setSyncingAll(true);
    try {
      await resumeAllPausedRecordRetries();
      const { uploaded, failed: recordsFailed, skipped, photosUploaded, photoProblems } = await syncAll();
      const routesResult = await syncRoutes();
      const proposalsResult = await syncAllProposals();
      await refreshProposalStatuses();

      let downloaded = 0;
      let downloadError: string | null = null;
      try {
        downloaded = (await pullServerRecords()).downloaded;
      } catch (error) {
        downloadError = serverPullError(error);
      }

      const failed = recordsFailed + proposalsResult.failed + routesResult.failed;
      const parts = [`${uploaded} uploaded`];
      if (downloaded > 0) parts.push(`${downloaded} downloaded`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (skipped > 0) parts.push(`${skipped} already uploading`);
      if (photosUploaded > 0) parts.push(`${photosUploaded} ${photosUploaded === 1 ? 'photo' : 'photos'} uploaded`);
      if (photoProblems > 0) {
        parts.push(`${photoProblems} ${photoProblems === 1 ? 'photo' : 'photos'} over 5 MB (see the plant page)`);
      }
      if (proposalsResult.uploaded > 0) {
        parts.push(`${proposalsResult.uploaded} species ${proposalsResult.uploaded === 1 ? 'request' : 'requests'} sent`);
      }
      if (routesResult.uploaded > 0) parts.push(routesUploadedText(routesResult.uploaded));
      if (routesResult.failed > 0) {
        parts.push(`${routesResult.failed} ${routesResult.failed === 1 ? 'route' : 'routes'} not uploaded`);
      }

      const problem = proposalsResult.reasons[0] ?? downloadError;
      Toast.show({
        type: failed > 0 || downloadError ? 'error' : 'success',
        text1: failed > 0 ? 'Some records did not upload' : downloadError ? 'Upload complete; download pending' : 'Sync complete',
        text2: problem ? `${parts.join(' · ')}. ${problem}` : parts.join(' · '),
        position: 'bottom',
      });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Sync could not finish',
        text2: error instanceof Error ? error.message : 'Please try again.',
        position: 'bottom',
      });
    } finally {
      setSyncingAll(false);
    }
  };

  const handleRetry = async (id: string) => {
    setRetryingIds((ids) => [...ids, id]);
    try {
      const record = useRecordStore.getState().records.find((item) => item.id === id);
      await resumePausedRecordRetries(id, record?.observations.map((visit) => visit.id) ?? []);
      const result = await syncRecord(id);
      Toast.show(
        result.ok
          ? { type: 'success', text1: 'Record uploaded', position: 'bottom' }
          : { type: 'error', text1: 'Upload failed', text2: result.reason, position: 'bottom' }
      );
    } catch {
      Toast.show({ type: 'error', text1: 'Could not retry this record. Please try again.' });
    } finally {
      setRetryingIds((ids) => ids.filter((x) => x !== id));
    }
  };

  const handleProfilePress = () => {
    if (isVisitor) {
      Alert.alert('Exploring as a guest', 'Log in to use your account?', [
        { text: 'Keep Exploring', style: 'cancel' },
        {
          text: 'Log in',
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
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.headerLogo}
              resizeMode="contain"
            />
            <View style={styles.headerText}>
              <Text style={styles.headerTitle} numberOfLines={1}>Niah BioTrack</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1} ellipsizeMode="tail">
                Hello, {userName}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={handleProfilePress}
            style={styles.profileBtn}
            accessibilityRole="button"
            accessibilityLabel="User profile and settings"
          >
            <Ionicons
              name={isVisitor ? 'compass-outline' : 'person-circle-outline'}
              size={32}
              color="#284632"
            />
          </TouchableOpacity>
        </View>

        {!isVisitor ? (
          // One scrolling list: the sync and action cards, then "Recent activity" (the
          // botanist's own new plants, observations and species requests).
          <RecentActivity
            onRetryRecord={(id) => void handleRetry(id)}
            retryingRecordIds={retryingIds}
            syncing={syncingAll}
            header={
              <>
                {(totalToSync > 0 || unsentProposalCount > 0 || unsentRouteCount > 0) && (
                  <View style={styles.syncCard}>
                    <Text style={styles.syncTitle}>
                      {[
                        totalToSync > 0 ? `${totalToSync} ${totalToSync === 1 ? 'record' : 'records'}` : null,
                        unsentProposalCount > 0
                          ? `${unsentProposalCount} species ${unsentProposalCount === 1 ? 'request' : 'requests'}`
                          : null,
                        unsentRouteCount > 0
                          ? `${unsentRouteCount} ${unsentRouteCount === 1 ? 'route' : 'routes'}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' and ')}{' '}
                      pending sync
                    </Text>
                    <Text style={styles.syncSub}>
                      {pendingCount} queued{failedCount > 0 ? ` · ${failedCount} failed` : ''} · local storage safe
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
                )}

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

                <View style={styles.actionSection}>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.actionCard}
                      activeOpacity={0.85}
                      onPress={() => router.push('/(tabs)/scan')}
                      accessibilityRole="button"
                      accessibilityLabel="Scan QR code"
                    >
                      <View style={styles.actionIconWrap}>
                        <Ionicons name="qr-code-outline" size={28} color="#284632" />
                      </View>
                      <Text style={styles.actionCardLabel}>Scan QR code</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionCard}
                      activeOpacity={0.85}
                      onPress={() => router.push('/add-observation')}
                      accessibilityRole="button"
                      accessibilityLabel="Record observation"
                    >
                      <View style={styles.actionIconWrap}>
                        <Ionicons name="add-circle-outline" size={28} color="#284632" />
                      </View>
                      <Text style={styles.actionCardLabel}>Record observation</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.actionCard}
                      activeOpacity={0.85}
                      onPress={() => router.push('/new-record')}
                      accessibilityRole="button"
                      accessibilityLabel="Register plant"
                    >
                      <View style={styles.actionIconWrap}>
                        <Ionicons name="leaf-outline" size={28} color="#284632" />
                      </View>
                      <Text style={styles.actionCardLabel}>Register plant</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionCard}
                      activeOpacity={0.85}
                      onPress={() => router.push('/propose-species')}
                      accessibilityRole="button"
                      accessibilityLabel="Request a new species"
                    >
                      <View style={styles.actionIconWrap}>
                        <Ionicons name="create-outline" size={28} color="#284632" />
                      </View>
                      <Text style={styles.actionCardLabel}>Request a new species</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            }
          />
        ) : (
          <View style={styles.visitorSection}>
            <TouchableOpacity
              style={styles.visitorHeroCard}
              activeOpacity={0.85}
              onPress={() => router.push('/(tabs)/scan')}
            >
              <View style={styles.visitorHeroInfo}>
                <Text style={styles.visitorHeroTitle}>Scan a plant tag</Text>
                <Text style={styles.visitorHeroSub}>
                  Point your camera at the QR tag next to a plant to learn about it.
                </Text>
              </View>
              <View style={styles.visitorHeroIconCircle}>
                <Ionicons name="camera-outline" size={22} color="#FFFFFF" />
              </View>
            </TouchableOpacity>

            {featured.length > 0 && (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionHeading}>Featured plants</Text>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/plants' as any)}>
                    <Text style={styles.seeAll}>See all</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.featuredGrid}>
                  {featured.map((item) => {
                    const status = plainConservationStatus(item.conservation_status);
                    const colors = conservationStatusColors(status.code);
                    // The species' public plant photo (served stripped by the backend), or the leaf.
                    const photo = item.public_photo ?? null;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.featuredCard}
                        activeOpacity={0.8}
                        onPress={() => router.push({ pathname: '/plant-info', params: { speciesId: item.id } } as any)}
                      >
                        <PlantThumbnail
                          sources={thumbnailSources({ publicPath: photo?.url, baseUrl: BASE_URL })}
                          style={styles.featuredPhoto}
                          caption={
                            photo ? (
                              <Text style={styles.featuredCaption} numberOfLines={1}>{plantPhotoCaption(photo.tag)}</Text>
                            ) : null
                          }
                          placeholder={
                            <View style={[styles.featuredPhoto, styles.featuredPlaceholder]}>
                              <Ionicons name="leaf-outline" size={26} color="#46654F" />
                            </View>
                          }
                        />
                        <Text style={styles.featuredName} numberOfLines={1}>
                          {item.common_name || item.scientific_name}
                        </Text>
                        <View style={[styles.featuredBadge, { backgroundColor: colors.bg }]}>
                          <Text style={[styles.featuredBadgeText, { color: colors.text }]}>{status.label}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            <View style={styles.respectBox}>
              <Text style={styles.respectText}>Please don't pick or touch plants. Many here are protected.</Text>
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
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  // A long name never pushes the profile button off-screen.
  headerLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', marginRight: 8 },
  headerText: { flex: 1, minWidth: 0 },
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
  syncBtnDisabled: { opacity: 0.6 },
  syncBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  draftCard: {
    backgroundColor: '#FDF4D8',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  actionSection: {
    gap: 10,
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionCard: {
    flex: 1,
    height: 98,
    backgroundColor: '#DDEAE1',
    borderRadius: 20,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionIconWrap: { marginBottom: 5 },
  actionCardLabel: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#284632',
    textAlign: 'center',
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionHeading: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  seeAll: { fontSize: 12.5, fontWeight: '600', color: '#526659' },
  featuredGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  featuredCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 10,
    marginBottom: 12,
  },
  featuredPhoto: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: '#E7EFEA' },
  featuredPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  featuredName: { fontSize: 13.5, fontWeight: '700', color: '#1E2B22', marginTop: 8 },
  featuredCaption: { fontSize: 11, color: '#68776D', marginTop: 4 },
  featuredBadge: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, marginTop: 4 },
  featuredBadgeText: { fontSize: 10.5, fontWeight: '700' },
  respectBox: { backgroundColor: '#E8F5E9', borderRadius: 14, padding: 14, marginTop: 4 },
  respectText: { fontSize: 13, color: '#215A36', fontWeight: '600', textAlign: 'center' },
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
});
