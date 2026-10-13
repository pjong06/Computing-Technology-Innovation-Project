import React, { useState } from 'react';
import {
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { RecordStatus, useRecordStore } from '../../src/store/useRecordStore';
import { deleteAllStoredPhotos } from '../../src/utils/photoStorage';
import { signOutOnThisPhone } from '../../src/lib/auth';

export default function ProfileScreen() {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const clearAllData = useRecordStore((state) => state.clearAllData);

  const [mobileDataPhotos, setMobileDataPhotos] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Task 3.6 counts are derived from the persisted records. Keeping them out of
  // AsyncStorage prevents a separate sync report from drifting out of date.
  const syncedRecordCount = records.filter((record) => record.status === RecordStatus.SYNCED).length;
  const pendingRecordCount = records.filter((record) => record.status === RecordStatus.PENDING).length;
  const failedRecordCount = records.filter((record) => record.status === RecordStatus.FAILED).length;

  const observations = records.flatMap((record) => record.observations);
  const syncedObservationCount = observations.filter(
    (observation) => observation.status === RecordStatus.SYNCED
  ).length;
  const pendingObservationCount = observations.filter(
    (observation) => observation.status === RecordStatus.PENDING
  ).length;
  const failedObservationCount = observations.filter(
    (observation) => observation.status === RecordStatus.FAILED
  ).length;

  const pendingItemCount = pendingRecordCount + pendingObservationCount;
  const failedItemCount = failedRecordCount + failedObservationCount;

  // Count affected plant records once, even when one record has several
  // observations waiting to upload. This is the number used by the logout warning.
  const unsyncedRecordCount = records.filter(
    (record) =>
      record.status !== RecordStatus.SYNCED ||
      record.observations.some((observation) => observation.status !== RecordStatus.SYNCED)
  ).length;

  let overallStatus = 'No records';
  let overallMessage = 'Create a plant record to start the local sync queue.';
  let overallStatusStyle = styles.statusNeutral;
  let overallStatusTextStyle = styles.statusNeutralText;

  if (failedItemCount > 0) {
    overallStatus = 'Attention needed';
    overallMessage = `${failedItemCount} ${failedItemCount === 1 ? 'item has' : 'items have'} a failed status and can be retried from its record.`;
    overallStatusStyle = styles.statusFailed;
    overallStatusTextStyle = styles.statusFailedText;
  } else if (pendingItemCount > 0) {
    overallStatus = `${pendingItemCount} pending`;
    overallMessage = 'Pending data is saved on this device and waiting for server upload.';
    overallStatusStyle = styles.statusPending;
    overallStatusTextStyle = styles.statusPendingText;
  } else if (records.length > 0) {
    overallStatus = 'Up to date';
    overallMessage = 'All local records and observation visits have a synced status.';
    overallStatusStyle = styles.statusSynced;
    overallStatusTextStyle = styles.statusSyncedText;
  }

  const observationSummary =
    observations.length === 0
      ? 'None recorded'
      : failedObservationCount > 0
        ? `${pendingObservationCount} pending · ${failedObservationCount} failed`
        : pendingObservationCount > 0
          ? `${pendingObservationCount} pending`
          : `${syncedObservationCount} synced`;

  const handleLogoutPress = async () => {
    if (unsyncedRecordCount === 0) {
      await signOutOnThisPhone();
      router.replace('/' as never);
      return;
    }

    setShowLogoutModal(true);
  };

  const handleLogoutAnyway = async () => {
    // Clear records, routes and stored photos together so logout does not leave
    // field data behind on the device.
    clearAllData();
    void deleteAllStoredPhotos();
    setShowLogoutModal(false);
    await signOutOnThisPhone();
    router.replace('/' as never);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Profile</Text>

        {/* No sign-in backend yet, so there is no real account to show. */}
        <View style={styles.userCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>?</Text>
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.userName}>Account details not available yet</Text>
            <Text style={styles.userRole}>Sign-in is not connected to the server yet.</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Database Sync</Text>
            <View style={[styles.statusPill, overallStatusStyle]}>
              <Text style={[styles.statusPillText, overallStatusTextStyle]}>{overallStatus}</Text>
            </View>
          </View>

          <Text style={styles.statusMessage}>{overallMessage}</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Last successful sync</Text>
            <Text style={styles.infoVal}>Not available yet</Text>
          </View>

          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{syncedRecordCount}</Text>
              <Text style={styles.metricLabel}>Synced</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{pendingRecordCount}</Text>
              <Text style={styles.metricLabel}>Pending</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{failedRecordCount}</Text>
              <Text style={styles.metricLabel}>Failed</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Observation visits</Text>
            <Text style={styles.infoVal}>{observationSummary}</Text>
          </View>

          <Text style={styles.syncNote}>
            Counts are calculated from data on this device. Server upload is not implemented yet, so this screen does not change record status.
          </Text>

          <View
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            style={[styles.syncBtn, styles.syncBtnDisabled]}
          >
            <Text style={styles.syncBtnText}>Upload to server not available yet</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Field settings</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={styles.infoLabel}>Use mobile data for photos</Text>
              <Text style={styles.infoSub}>On by default · no Wi-Fi in the field</Text>
            </View>
            <Switch
              value={mobileDataPhotos}
              onValueChange={setMobileDataPhotos}
              trackColor={{ false: '#D0DCD3', true: '#213B2A' }}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogoutPress}>
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
            <Text style={styles.modalTitle}>Log out with unsynced records?</Text>
            <Text style={styles.modalBody}>
              {unsyncedRecordCount} {unsyncedRecordCount === 1 ? 'record has' : 'records have'} not been uploaded to the server. Logging out deletes{' '}
              {unsyncedRecordCount === 1 ? 'it' : 'them'} and all photos from this device. This cannot be undone.
            </Text>
            <TouchableOpacity style={styles.modalPrimary} onPress={() => setShowLogoutModal(false)}>
              <Text style={styles.modalPrimaryText}>Stay logged in</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSecondary} onPress={handleLogoutAnyway}>
              <Text style={styles.modalSecondaryText}>Log out anyway</Text>
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
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22', marginBottom: 16 },
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
  avatarInitials: { fontSize: 16, fontWeight: '800', color: '#213B2A' },
  userDetails: { marginLeft: 16, flex: 1 },
  userName: { fontSize: 16, fontWeight: '700', color: '#1E2B22' },
  userRole: { fontSize: 12, color: '#68776D', marginTop: 2 },
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
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  statusPill: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 6 },
  statusPillText: { fontSize: 11.5, fontWeight: '800' },
  statusNeutral: { backgroundColor: '#EEF1EF' },
  statusNeutralText: { color: '#68776D' },
  statusPending: { backgroundColor: '#FDF4D8' },
  statusPendingText: { color: '#8C5E03' },
  statusFailed: { backgroundColor: '#FDE2E2' },
  statusFailedText: { color: '#9B1C1C' },
  statusSynced: { backgroundColor: '#E4F2E7' },
  statusSyncedText: { color: '#215A36' },
  statusMessage: { fontSize: 12, color: '#68776D', lineHeight: 17, marginBottom: 14 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoLabel: { fontSize: 13, color: '#68776D' },
  infoSub: { fontSize: 11, color: '#88988D', marginTop: 2 },
  infoVal: { fontSize: 13, fontWeight: '700', color: '#1E2B22', textAlign: 'right' },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9F7',
    borderRadius: 18,
    paddingVertical: 14,
    marginBottom: 12,
  },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { fontSize: 22, fontWeight: '800', color: '#213B2A' },
  metricLabel: { fontSize: 11.5, color: '#68776D', marginTop: 2 },
  metricDivider: { width: 1, height: 34, backgroundColor: '#DDE5DF' },
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
  syncBtnDisabled: { backgroundColor: '#9AAA9F' },
  syncBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5, textAlign: 'center' },
  settingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  settingText: { flex: 1, paddingRight: 10 },
  logoutBtn: { paddingVertical: 14, alignItems: 'center' },
  logoutBtnText: { color: '#9B1C1C', fontWeight: '700', fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: { backgroundColor: '#FFFFFF', borderRadius: 26, padding: 24, width: '100%' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1E2B22', marginBottom: 8 },
  modalBody: { fontSize: 13, color: '#68776D', lineHeight: 18, marginBottom: 20 },
  modalPrimary: {
    backgroundColor: '#213B2A',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalPrimaryText: { color: '#FFFFFF', fontWeight: '700' },
  modalSecondary: {
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalSecondaryText: { color: '#9B1C1C', fontWeight: '700' },
});
