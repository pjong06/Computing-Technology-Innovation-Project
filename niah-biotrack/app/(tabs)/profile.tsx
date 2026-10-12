import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar, Switch, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useRecordStore, RecordStatus } from '../../src/store/useRecordStore';
import { deleteAllStoredPhotos } from '../../src/utils/photoStorage';

export default function ProfileScreen() {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const clearAllData = useRecordStore((state) => state.clearAllData);

  const [mobileDataPhotos, setMobileDataPhotos] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const pendingCount = records.filter((r) => r.status === RecordStatus.PENDING).length;
  const failedCount = records.filter((r) => r.status === RecordStatus.FAILED).length;

  // A record still needs uploading if it isn't Synced, or if any of its visits aren't.
  const unsyncedCount = records.filter(
    (r) => r.status !== RecordStatus.SYNCED || r.observations.some((o) => o.status !== RecordStatus.SYNCED)
  ).length;

  const handleLogoutPress = () => {
    if (unsyncedCount === 0) {
      router.replace('/' as any);
      return;
    }
    setShowLogoutModal(true);
  };

  const handleLogoutAnyway = () => {
    // Really remove everything this device holds: records, routes and stored photos.
    clearAllData();
    deleteAllStoredPhotos();
    setShowLogoutModal(false);
    router.replace('/' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Profile</Text>

        {/* No sign-in backend yet, so there is no real account to show. */}
        <View style={styles.userCard}>
          <View style={styles.avatarCircle}><Text style={styles.avatarInitials}>?</Text></View>
          <View style={{ marginLeft: 16, flex: 1 }}>
            <Text style={styles.userName}>Account details not available yet</Text>
            <Text style={styles.userRole}>Sign-in is not connected to the server yet.</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sync</Text>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>Last sync</Text><Text style={styles.infoVal}>Not available yet</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>Records on device</Text><Text style={styles.infoVal}>{records.length}</Text></View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Waiting to sync</Text>
            <Text style={[styles.infoVal, { color: '#8C5E03' }]}>{pendingCount} pending {failedCount > 0 ? `· ${failedCount} failed` : ''}</Text>
          </View>
          <View style={[styles.syncBtn, styles.syncBtnDisabled]}>
            <Text style={styles.syncBtnText}>Upload to server not available yet</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Field settings</Text>
          <View style={[styles.infoRow, { alignItems: 'center' }]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.infoLabel}>Use mobile data for photos</Text>
              <Text style={styles.infoSub}>On by default · no Wi-Fi in the field</Text>
            </View>
            <Switch value={mobileDataPhotos} onValueChange={setMobileDataPhotos} trackColor={{ false: '#D0DCD3', true: '#213B2A' }} />
          </View>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogoutPress}>
          <Text style={styles.logoutBtnText}>Log out</Text>
        </TouchableOpacity>
      </View>

      {/* Shown only when there are unsynced records (see handleLogoutPress). */}
      <Modal visible={showLogoutModal} transparent animationType="fade" onRequestClose={() => setShowLogoutModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Log out with unsynced records?</Text>
            <Text style={styles.modalBody}>
              {unsyncedCount} {unsyncedCount === 1 ? 'record has' : 'records have'} not been uploaded to the server.
              Logging out deletes {unsyncedCount === 1 ? 'it' : 'them'} and all photos from this device. This cannot be undone.
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
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22', marginBottom: 16 },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 18, borderRadius: 24, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 14 },
  avatarCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#DDEAE2', justifyContent: 'center', alignItems: 'center' },
  avatarInitials: { fontSize: 16, fontWeight: '800', color: '#213B2A' },
  userName: { fontSize: 16, fontWeight: '700', color: '#1E2B22' },
  userRole: { fontSize: 12, color: '#68776D', marginTop: 2 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B22', marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  infoLabel: { fontSize: 13, color: '#68776D' },
  infoSub: { fontSize: 11, color: '#88988D', marginTop: 2 },
  infoVal: { fontSize: 13, fontWeight: '700', color: '#1E2B22' },
  syncBtn: { backgroundColor: '#213B2A', height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  syncBtnDisabled: { backgroundColor: '#9AAA9F' },
  syncBtnText: { color: '#FFF', fontWeight: '700', fontSize: 13.5 },
  logoutBtn: { paddingVertical: 14, alignItems: 'center' },
  logoutBtnText: { color: '#9B1C1C', fontWeight: '700', fontSize: 14 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#FFF', borderRadius: 26, padding: 24, width: '100%' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1E2B22', marginBottom: 8 },
  modalBody: { fontSize: 13, color: '#68776D', lineHeight: 18, marginBottom: 20 },
  modalPrimary: { backgroundColor: '#213B2A', height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  modalPrimaryText: { color: '#FFF', fontWeight: '700' },
  modalSecondary: { height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  modalSecondaryText: { color: '#9B1C1C', fontWeight: '700' },
});