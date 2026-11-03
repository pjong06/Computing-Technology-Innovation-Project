import React, { useCallback, useState } from 'react';
import {
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { SyncStatus, useRecordStore } from '../../src/store/useRecordStore';
import { buildSyncSummary } from '../../src/services/syncSummary';
import { deleteAllStoredPhotos } from '../../src/utils/photoStorage';
import { useProposalStore } from '../../src/store/useProposalStore';
import { signOutOnThisPhone } from '../../src/lib/auth';
import { useProfileStore } from '../../src/store/useProfileStore';

export default function ProfileScreen() {
  const router = useRouter();

  const records = useRecordStore((state) => state.records);
  const clearAllData = useRecordStore((state) => state.clearAllData);
  const proposals = useProposalStore((state) => state.proposals);
  const clearProposals = useProposalStore((state) => state.clearProposals);
  // Species proposals still on the phone only; logging out would lose them too.
  const unsentProposalCount = proposals.filter((p) => p.syncStatus !== SyncStatus.UPLOADED).length;

  const me = useProfileStore((state) => state.me);
  const profileError = useProfileStore((state) => state.error);
  const loadMe = useProfileStore((state) => state.loadMe);

  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadMe();
    }, [loadMe])
  );

  const displayName = me?.full_name || me?.email || null;
  const initials = displayName
    ? displayName.trim().charAt(0).toUpperCase()
    : '?';

  const roleLabel = me
    ? me.role.charAt(0).toUpperCase() + me.role.slice(1)
    : null;

  /*
   * Task 3.6:
   * Counts are derived from the records currently saved on the device.
   * They are not stored as separate values, which prevents the summary
   * from becoming inconsistent with the actual records.
   *
   * isSyncing remains false until the real SQLite Sync Engine is connected.
   */
  const syncSummary = buildSyncSummary(records, false);

  const statusPillStyle =
    syncSummary.overallTone === 'failed'
      ? styles.statusFailed
      : syncSummary.overallTone === 'pending'
        ? styles.statusPending
        : syncSummary.overallTone === 'synced'
          ? styles.statusSynced
          : styles.statusNeutral;

  const statusTextStyle =
    syncSummary.overallTone === 'failed'
      ? styles.statusFailedText
      : syncSummary.overallTone === 'pending'
        ? styles.statusPendingText
        : syncSummary.overallTone === 'synced'
          ? styles.statusSyncedText
          : styles.statusNeutralText;

  /*
   * Every logout clears records, routes and stored photos, also when everything
   * is uploaded. Otherwise the next person to log in on this phone would see the
   * previous user's records (and could upload them under their own account).
   */
  const logOutAndClearDevice = async () => {
    clearAllData();
    clearProposals();
    deleteAllStoredPhotos();

    setShowLogoutModal(false);

    await signOutOnThisPhone();
    router.replace('/' as never);
  };

  const handleLogoutPress = async () => {
    if (syncSummary.unsyncedRecordCount === 0 && unsentProposalCount === 0) {
      // Nothing would be lost (it's all on the server), so no warning needed.
      await logOutAndClearDevice();
      return;
    }

    // Unsynced records would be lost for good, so ask first.
    setShowLogoutModal(true);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Profile</Text>

        <View style={styles.userCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>

          <View style={styles.userDetails}>
            {me ? (
              <>
                <Text style={styles.userName}>{displayName}</Text>

                <Text style={styles.userRole}>
                  {roleLabel}
                  {me.staff_id ? ` · ${me.staff_id}` : ''}
                </Text>

                {me.full_name ? (
                  <Text style={styles.userRole}>{me.email}</Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.userName}>
                  Account details not loaded
                </Text>

                <Text style={styles.userRole}>
                  {profileError ?? 'Loading…'}
                </Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Database Sync</Text>

            <View style={[styles.statusPill, statusPillStyle]}>
              <Text style={[styles.statusPillText, statusTextStyle]}>
                {syncSummary.overallStatus}
              </Text>
            </View>
          </View>

          <Text style={styles.statusMessage}>
            {syncSummary.overallMessage}
          </Text>

          <View style={styles.infoRow}>
            <View>
              <Text style={styles.infoLabel}>
                Last successful sync
              </Text>

              <Text style={styles.infoSub}>
                Server synchronization is not connected yet
              </Text>
            </View>

            <Text style={styles.infoVal}>Not available yet</Text>
          </View>

          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {syncSummary.uploadedRecordCount}
              </Text>

              <Text style={styles.metricLabel}>Uploaded</Text>
            </View>

            <View style={styles.metricDivider} />

            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {syncSummary.pendingRecordCount}
              </Text>

              <Text style={styles.metricLabel}>Pending</Text>
            </View>

            <View style={styles.metricDivider} />

            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {syncSummary.failedRecordCount}
              </Text>

              <Text style={styles.metricLabel}>Failed</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Observation visits</Text>

            <Text style={styles.infoVal}>
              {syncSummary.observationSummary}
            </Text>
          </View>

          {syncSummary.localDraftCount > 0 && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Local identification drafts</Text>
              <Text style={styles.infoVal}>{syncSummary.localDraftCount}</Text>
            </View>
          )}

          <Text style={styles.syncNote}>
            Counts are calculated from records currently saved on this
            device. The SQLite offline-sync engine will later provide real
            upload results and the last successful sync time.
          </Text>

          <TouchableOpacity
            style={[styles.syncBtn, styles.syncBtnDisabled]}
            disabled
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
          >
            <Text style={styles.syncBtnText}>
              Sync service not connected yet
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogoutPress}
        >
          <Text style={styles.logoutBtnText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={showLogoutModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Log out with unsynced data?
            </Text>

            <Text style={styles.modalBody}>
              {[
                syncSummary.unsyncedRecordCount > 0
                  ? `${syncSummary.unsyncedRecordCount} ${syncSummary.unsyncedRecordCount === 1 ? 'record' : 'records'}`
                  : null,
                unsentProposalCount > 0
                  ? `${unsentProposalCount} species ${unsentProposalCount === 1 ? 'proposal' : 'proposals'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' and ')}{' '}
              not uploaded to the server yet. Logging out deletes them and all photos from this
              device. This cannot be undone.
            </Text>

            <TouchableOpacity
              style={styles.modalPrimary}
              onPress={() => setShowLogoutModal(false)}
            >
              <Text style={styles.modalPrimaryText}>
                Stay logged in
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalSecondary}
              onPress={logOutAndClearDevice}
            >
              <Text style={styles.modalSecondaryText}>
                Log out anyway
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop:
      Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },

  container: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
  },

  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1E2B22',
    marginBottom: 16,
  },

  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 24,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 14,
  },

  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#DDEAE2',
    justifyContent: 'center',
    alignItems: 'center',
  },

  avatarInitials: {
    fontSize: 16,
    fontWeight: '800',
    color: '#213B2A',
  },

  userDetails: {
    marginLeft: 16,
    flex: 1,
  },

  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B22',
  },

  userRole: {
    fontSize: 12,
    color: '#68776D',
    marginTop: 2,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 14,
  },

  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },

  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B22',
  },

  statusPill: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: '55%',
  },

  statusPillText: {
    fontSize: 11.5,
    fontWeight: '800',
    textAlign: 'center',
  },

  statusNeutral: {
    backgroundColor: '#EEF1EF',
  },

  statusNeutralText: {
    color: '#68776D',
  },

  statusPending: {
    backgroundColor: '#FDF4D8',
  },

  statusPendingText: {
    color: '#8C5E03',
  },

  statusFailed: {
    backgroundColor: '#FDE2E2',
  },

  statusFailedText: {
    color: '#9B1C1C',
  },

  statusSynced: {
    backgroundColor: '#E4F2E7',
  },

  statusSyncedText: {
    color: '#215A36',
  },

  statusMessage: {
    fontSize: 12,
    color: '#68776D',
    lineHeight: 17,
    marginBottom: 14,
  },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },

  infoLabel: {
    fontSize: 13,
    color: '#68776D',
  },

  infoSub: {
    fontSize: 11,
    color: '#88988D',
    marginTop: 2,
  },

  infoVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E2B22',
    textAlign: 'right',
    flexShrink: 1,
  },

  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9F7',
    borderRadius: 18,
    paddingVertical: 14,
    marginBottom: 12,
  },

  metric: {
    flex: 1,
    alignItems: 'center',
  },

  metricValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#213B2A',
  },

  metricLabel: {
    fontSize: 11.5,
    color: '#68776D',
    marginTop: 2,
  },

  metricDivider: {
    width: 1,
    height: 34,
    backgroundColor: '#DDE5DF',
  },

  syncNote: {
    fontSize: 11,
    lineHeight: 16,
    color: '#7A887F',
    backgroundColor: '#F7F9F7',
    borderRadius: 12,
    padding: 10,
    marginTop: 2,
  },

  syncBtn: {
    backgroundColor: '#213B2A',
    minHeight: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 18,
  },

  syncBtnDisabled: {
    backgroundColor: '#9AAA9F',
  },

  syncBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13.5,
    textAlign: 'center',
  },

  logoutBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },

  logoutBtnText: {
    color: '#9B1C1C',
    fontWeight: '700',
    fontSize: 14,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },

  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    padding: 24,
    width: '100%',
  },

  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1E2B22',
    marginBottom: 8,
  },

  modalBody: {
    fontSize: 13,
    color: '#68776D',
    lineHeight: 18,
    marginBottom: 20,
  },

  modalPrimary: {
    backgroundColor: '#213B2A',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },

  modalPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  modalSecondary: {
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },

  modalSecondaryText: {
    color: '#9B1C1C',
    fontWeight: '700',
  },
});
