import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthRole } from '../../src/context/AuthRoleContext';
import { supabase } from '../../src/lib/supabase';
import { useRecordStore, SyncStatus } from '../../src/store/useRecordStore';
import { getLastSuccessfulSync } from '../../src/services/offlineDatabase';

interface ProfileData {
  fullName: string;
  email: string;
  role: string;
  staffId?: string;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { isVisitor, userName, role, logout } = useAuthRole();
  const records = useRecordStore((state) => state.records);
  const syncAll = useRecordStore((state) => state.syncAll);

  const [loading, setLoading] = useState<boolean>(!isVisitor);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const uploadedCount = records.filter((r) => r.syncStatus === SyncStatus.UPLOADED).length;
  const pendingCount = records.filter((r) => r.syncStatus === SyncStatus.NOT_UPLOADED).length;
  const failedCount = records.filter((r) => r.syncStatus === SyncStatus.FAILED).length;

  useEffect(() => {
    if (isVisitor) {
      setLoading(false);
      return;
    }

    async function fetchStaffProfile() {
      try {
        setLoading(true);

        // 1. Read cached session from device storage first (never fails on network drops)
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData?.session?.user;

        if (!user) {
          setLoading(false);
          return;
        }

        // Establish default fallback from the session token
        let resolvedName = user.user_metadata?.full_name || userName || 'Field Botanist';
        let resolvedRole = user.user_metadata?.role || role || 'Botanist';
        let resolvedStaffId = 'SFC-BOT-001';

        // 2. Query the profiles table for extended details
        try {
          const { data: dbProfile } = await supabase
            .from('profiles')
            .select('full_name, role, staff_id')
            .eq('id', user.id)
            .maybeSingle();

          if (dbProfile) {
            resolvedName = dbProfile.full_name || resolvedName;
            resolvedRole = dbProfile.role || resolvedRole;
            resolvedStaffId = dbProfile.staff_id || resolvedStaffId;
          }
        } catch {
          // If profiles table query fails or times out, keep session defaults
        }

        setProfile({
          fullName: resolvedName,
          email: user.email || 'botanist@sarawak.gov',
          role: resolvedRole,
          staffId: resolvedStaffId,
        });
      } catch {
        setProfile({
          fullName: userName || 'Field Botanist',
          email: 'Active Staff Session',
          role: role || 'Botanist',
          staffId: 'SFC-BOT',
        });
      } finally {
        setLoading(false);
      }
    }

    fetchStaffProfile();
  }, [isVisitor]);

  useEffect(() => {
    void getLastSuccessfulSync().then(setLastSyncAt).catch(() => undefined);
  }, []);

  const handleSync = async () => {
    if (isVisitor || isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await syncAll();
      setLastSyncAt(await getLastSuccessfulSync());

      if (result.failed > 0) {
        Alert.alert(
          'Sync needs attention',
          `${result.failed} record(s) could not be uploaded. They remain safely stored on this phone.`
        );
      } else {
        Alert.alert(
          'Sync complete',
          `${result.uploaded} record(s) processed successfully.`
        );
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      isVisitor ? 'Exit Visitor Mode' : 'Log Out',
      isVisitor
        ? 'Return to sign-in screen?'
        : 'Are you sure you want to log out of your field session?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isVisitor ? 'Exit' : 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User Card */}
        {isVisitor ? (
          <View style={styles.card}>
            <View style={styles.userRow}>
              <View style={[styles.avatarCircle, { backgroundColor: '#E0F2FE' }]}>
                <Ionicons name="compass" size={30} color="#0284C7" />
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>Park Visitor</Text>
                <Text style={styles.userSub}>Guest Exploration Pass</Text>
              </View>
              <View style={styles.visitorBadge}>
                <Text style={styles.visitorBadgeText}>READ-ONLY</Text>
              </View>
            </View>

            <View style={styles.visitorDescBox}>
              <Ionicons name="information-circle-outline" size={17} color="#0369A1" />
              <Text style={styles.visitorDescText}>
                You are currently exploring Niah National Park without an account. You can scan plaques and browse species records freely.
              </Text>
            </View>
          </View>
        ) : loading ? (
          <View style={[styles.card, styles.centerCard]}>
            <ActivityIndicator size="small" color="#2D6A4F" />
            <Text style={styles.loadingText}>Loading account details...</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.userRow}>
              <View style={[styles.avatarCircle, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="person" size={28} color="#2D6A4F" />
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{profile?.fullName || userName}</Text>
                <Text style={styles.userSub}>{profile?.email}</Text>
              </View>
              <View style={styles.staffBadge}>
                <Text style={styles.staffBadgeText}>STAFF</Text>
              </View>
            </View>

            <View style={styles.metaRow}>
              <View style={styles.metaCol}>
                <Text style={styles.metaLabel}>Designation</Text>
                <Text style={styles.metaVal}>{profile?.role || 'Botanist'}</Text>
              </View>
              <View style={styles.metaDivider} />
              <View style={styles.metaCol}>
                <Text style={styles.metaLabel}>Staff ID</Text>
                <Text style={styles.metaVal}>{profile?.staffId || 'SFC-BOT'}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Database Sync Overview */}
        <View style={styles.card}>
          <View style={styles.cardHeaderBetween}>
            <Text style={styles.cardTitle}>Database Sync</Text>
            <View style={styles.syncStatusPill}>
              <Text style={styles.syncStatusText}>
                {isSyncing
                  ? 'Syncing...'
                  : failedCount > 0
                    ? 'Attention needed'
                    : pendingCount > 0
                      ? `${pendingCount} Queued`
                      : 'All Synced'}
              </Text>
            </View>
          </View>
          <Text style={styles.cardSub}>Local storage and cloud synchronization status.</Text>

          <View style={styles.metricsGrid}>
            <View style={styles.metricBox}>
              <Text style={[styles.metricNumber, { color: '#2D6A4F' }]}>{uploadedCount}</Text>
              <Text style={styles.metricLabel}>Uploaded</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricBox}>
              <Text style={[styles.metricNumber, { color: '#D97706' }]}>{pendingCount}</Text>
              <Text style={styles.metricLabel}>Pending</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricBox}>
              <Text style={[styles.metricNumber, { color: '#DC2626' }]}>{failedCount}</Text>
              <Text style={styles.metricLabel}>Failed</Text>
            </View>
          </View>

          <View style={styles.syncFooterRow}>
            <Ionicons name="time-outline" size={15} color="#8A998E" />
            <Text style={styles.syncFooterText}>
              Last successful sync:{' '}
              <Text style={{ fontWeight: '700' }}>
                {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Not yet'}
              </Text>
            </Text>
          </View>

          {!isVisitor && (
            <TouchableOpacity
              style={[
                styles.syncButton,
                (isSyncing || pendingCount + failedCount === 0) && styles.syncButtonDisabled,
              ]}
              onPress={handleSync}
              disabled={isSyncing || pendingCount + failedCount === 0}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="cloud-upload-outline" size={18} color="#FFFFFF" />
              )}
              <Text style={styles.syncButtonText}>
                {isSyncing
                  ? 'Syncing...'
                  : pendingCount + failedCount > 0
                    ? 'Sync now'
                    : 'Nothing to sync'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Action Button */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>
            {isVisitor ? 'Switch to Staff Sign In' : 'Log out'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E6ECE8',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#213B2A',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E6ECE8',
  },
  centerCard: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: '#68776D',
    fontWeight: '600',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#213B2A',
  },
  userSub: {
    fontSize: 12.5,
    color: '#68776D',
    marginTop: 2,
  },
  staffBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A3D9A5',
  },
  staffBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#2D6A4F',
  },
  visitorBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  visitorBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#0284C7',
  },
  visitorDescBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  visitorDescText: {
    flex: 1,
    fontSize: 12,
    color: '#0369A1',
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: 'row',
    backgroundColor: '#F7F9F7',
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E8EFEA',
  },
  metaCol: {
    flex: 1,
    alignItems: 'center',
  },
  metaDivider: {
    width: 1,
    backgroundColor: '#DDE5E0',
  },
  metaLabel: {
    fontSize: 11,
    color: '#76877B',
    fontWeight: '600',
    marginBottom: 2,
  },
  metaVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#213B2A',
  },
  cardHeaderBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#213B2A',
  },
  cardSub: {
    fontSize: 12,
    color: '#68776D',
    marginBottom: 16,
  },
  syncStatusPill: {
    backgroundColor: '#F0F4F1',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  syncStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#49594D',
  },
  metricsGrid: {
    flexDirection: 'row',
    backgroundColor: '#F9FAF9',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#EAEFEA',
    marginBottom: 12,
  },
  metricBox: {
    flex: 1,
    alignItems: 'center',
  },
  metricNumber: {
    fontSize: 22,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 11,
    color: '#68776D',
    fontWeight: '600',
    marginTop: 2,
  },
  metricDivider: {
    width: 1,
    backgroundColor: '#E2E8E4',
  },
  syncFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginTop: 4,
  },
  syncFooterText: {
    fontSize: 11.5,
    color: '#76877B',
  },
  syncButton: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#2D6A4F',
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  syncButtonDisabled: {
    backgroundColor: '#A8B6AC',
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  logoutBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
  },
});
