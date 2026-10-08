import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useRecordStore } from '../../src/store/useRecordStore';

export default function ProfileScreen() {
  const router = useRouter();
  const records = useRecordStore((state) => state.records);
  const syncPending = useRecordStore((state) => state.syncPending);
  const [lastSync, setLastSync] = useState('Never');

  const handleSync = () => {
    syncPending();
    setLastSync('Just now');
    Toast.show({
      type: 'success',
      text1: 'Sync Complete',
      text2: 'Records successfully uploaded to the cloud.',
      position: 'bottom',
      bottomOffset: 100,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.userCard}>
          <Text style={styles.userName}>Brendan Noel</Text>
          <Text style={styles.userRole}>Botanist</Text>
        </View>

        <View style={styles.syncCard}>
          <Text style={styles.syncCardTitle}>Database Sync</Text>
          <Text style={{ marginVertical: 10, color: '#68776D' }}>Last Sync: {lastSync}</Text>
          <Text style={styles.counterNumber}>{records.length} records</Text>
          <TouchableOpacity style={styles.syncBtn} onPress={handleSync}>
            <Text style={styles.syncBtnText}>Sync to Cloud</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={() => router.replace('/' as any)}>
          <Text style={styles.logoutBtnText}>Log out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1E2B22', marginBottom: 18 },
  userCard: { alignItems: 'center', backgroundColor: '#FFFFFF', paddingVertical: 24, borderRadius: 24, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 18 },
  userName: { fontSize: 19, fontWeight: '700', color: '#1E2B22' },
  userRole: { fontSize: 13.5, color: '#68776D', marginTop: 3 },
  syncCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 18 },
  syncCardTitle: { fontSize: 18, fontWeight: '700', color: '#1E2B22' },
  counterNumber: { fontSize: 22, fontWeight: '700', color: '#213B2A', marginBottom: 18 },
  syncBtn: { backgroundColor: '#213B2A', height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  syncBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  logoutBtn: { paddingVertical: 14, alignItems: 'center' },
  logoutBtnText: { color: '#E02424', fontSize: 15, fontWeight: '700' },
});