import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useRecordStore } from '../../src/store/useRecordStore';

export default function ProfileScreen() {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const syncPending = useRecordStore((state) => state.syncPending);
  
  const totalRecords = records.length;
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState('Never');

  const handleSync = () => {
    if (totalRecords === 0) return Alert.alert('Notice', 'No records stored on this device to sync.');
    setSyncing(true);
    setTimeout(() => {
      syncPending();
      setSyncing(false);
      setLastSync('Just now');
      Alert.alert('Synchronized', `Device records successfully uploaded to the central repository.`);
    }, 1200);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.userCard}>
          <View style={styles.avatar}><Text style={{ fontSize: 36 }}>👨‍💼</Text></View>
          <Text style={styles.userName}>Brendan Noel</Text>
          <Text style={styles.userRole}>Botanist</Text>
        </View>

        <View style={styles.syncCard}>
          <View style={styles.syncRow}>
            <Text style={styles.syncCardTitle}>Database Sync</Text>
            <Text style={styles.lastSyncLabel}>Last Sync: {lastSync}</Text>
          </View>

          <Text style={styles.counterLabel}>Records stored locally on device</Text>
          <Text style={styles.counterNumber}>{totalRecords} total</Text>

          <TouchableOpacity style={styles.syncBtn} activeOpacity={0.85} onPress={handleSync} disabled={syncing}>
            {syncing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.syncBtnText}>Sync to Cloud</Text>}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} activeOpacity={0.7} onPress={() => router.replace('/' as any)}>
          <Text style={styles.logoutBtnText}>Log out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6' },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1E2B22', marginBottom: 18 },
  userCard: { alignItems: 'center', backgroundColor: '#FFFFFF', paddingVertical: 24, borderRadius: 24, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 18, elevation: 1 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#E4ECE6', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  userName: { fontSize: 19, fontWeight: '700', color: '#1E2B22' },
  userRole: { fontSize: 13.5, color: '#68776D', marginTop: 3 },
  syncCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 18, elevation: 1 },
  syncRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  syncCardTitle: { fontSize: 18, fontWeight: '700', color: '#1E2B22' },
  lastSyncLabel: { fontSize: 12, color: '#7D8C81' },
  counterLabel: { fontSize: 13, color: '#68776D' },
  counterNumber: { fontSize: 22, fontWeight: '700', color: '#213B2A', marginTop: 4, marginBottom: 18 },
  syncBtn: { backgroundColor: '#213B2A', height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  syncBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  logoutBtn: { paddingVertical: 14, alignItems: 'center' },
  logoutBtnText: { color: '#E02424', fontSize: 15, fontWeight: '700' },
});