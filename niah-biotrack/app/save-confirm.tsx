import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useRecordStore } from '../src/store/useRecordStore';

export default function SaveConfirmScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const records = useRecordStore((state) => state.records);

  const matched = records.find((r) => r.recordId === id || r.id === id) || records[0];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.topStatusPill}>
          <Text style={styles.topStatusText}>Offline - working from this device</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.checkIconCircle}><Text style={{ color: '#FFF', fontSize: 24 }}>✓</Text></View>
          <Text style={styles.title}>Record saved</Text>
          <Text style={styles.subtitle}>Saved on device - will sync when online</Text>

          <View style={styles.infoBox}>
            <Text style={styles.plantTitle}>{matched?.scientificName}</Text>
            <Text style={styles.plantTaxa}>{matched?.commonName} · {matched?.family}</Text>
            <Text style={styles.plantLoc}>📍 {matched?.locationName}</Text>
            <Text style={styles.plantGps}>{matched?.gpsCoordination}</Text>
            <Text style={styles.metaRow}>🕒 {matched?.createdAt} · {matched?.photoUris?.length || 0} photos</Text>
            <Text style={styles.recordIdTag}># Record ID: {matched?.recordId} (reserved offline)</Text>
          </View>

          <Text style={styles.helperNotice}>You can print the QR tag now - it stays valid after syncing.</Text>
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push({ pathname: '/plant-tag', params: { id: matched?.recordId } } as any)}>
          <Text style={styles.primaryBtnText}>Generate QR tag</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/new-record' as any)}>
          <Text style={styles.secondaryBtnText}>Add another</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkBtn} onPress={() => router.replace('/(tabs)/home' as any)}>
          <Text style={styles.linkBtnText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, padding: 22, justifyContent: 'center' },
  topStatusPill: { alignSelf: 'center', backgroundColor: '#EDF5EF', paddingVertical: 4, paddingHorizontal: 14, borderRadius: 14, marginBottom: 20 },
  topStatusText: { fontSize: 11.5, color: '#213B2A', fontWeight: '700' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 24, alignItems: 'center', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 20 },
  checkIconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#213B2A', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#1E2B22' },
  subtitle: { fontSize: 12.5, color: '#68776D', marginTop: 4, marginBottom: 16 },
  infoBox: { width: '100%', backgroundColor: '#F6F8F6', borderRadius: 18, padding: 16, marginBottom: 14 },
  plantTitle: { fontSize: 16, fontWeight: '800', color: '#213B2A' },
  plantTaxa: { fontSize: 12.5, color: '#68776D', marginTop: 2 },
  plantLoc: { fontSize: 13, fontWeight: '700', color: '#1E2B22', marginTop: 8 },
  plantGps: { fontSize: 11.5, color: '#7E8F83', marginTop: 2 },
  metaRow: { fontSize: 11.5, color: '#7E8F83', marginTop: 8 },
  recordIdTag: { fontSize: 12, fontWeight: '800', color: '#213B2A', marginTop: 10 },
  helperNotice: { fontSize: 11.5, color: '#7E8F83', textAlign: 'center', lineHeight: 16 },
  primaryBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  primaryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },
  secondaryBtn: { height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', borderWidth: 1.2, borderColor: '#213B2A', backgroundColor: '#FFF', marginBottom: 10 },
  secondaryBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 14.5 },
  linkBtn: { paddingVertical: 8, alignItems: 'center' },
  linkBtnText: { color: '#68776D', fontWeight: '700', fontSize: 13.5 },
});