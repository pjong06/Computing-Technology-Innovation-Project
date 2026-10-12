import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useRecordStore } from '../src/store/useRecordStore';

export default function PlantTagScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const records = useRecordStore((state) => state.records);

  const matched = records.find((r) => r.recordId === id || r.id === id) || records[0];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
          <Text style={styles.backChevron}>‹ Back</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <View style={styles.qrMockBox}>
            <Text style={{ fontSize: 90 }}>🏁</Text>
          </View>
          <Text style={styles.tagCode}>{matched.recordId}</Text>
          <Text style={styles.speciesName}>{matched.scientificName}</Text>
          <Text style={styles.location}>{matched.locationName}</Text>
          <Text style={styles.notice}>Attach a printed tag near the plant. Staff see the full record; visitors see a public summary only.</Text>
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => Alert.alert('Printing', 'Tag sent to mobile Bluetooth printer.')}>
          <Text style={styles.primaryBtnText}>Print tag</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => Alert.alert('Share', 'Tag QR code exported to gallery.')}>
          <Text style={styles.secondaryBtnText}>Share</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, padding: 22, justifyContent: 'center' },
  backChevron: { fontSize: 18, color: '#213B2A', fontWeight: '700' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 24, alignItems: 'center', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 20 },
  qrMockBox: { width: 170, height: 170, backgroundColor: '#EDF2EE', justifyContent: 'center', alignItems: 'center', borderRadius: 20, marginBottom: 16 },
  tagCode: { fontSize: 19, fontWeight: '800', color: '#1E2B22' },
  speciesName: { fontSize: 16, fontWeight: '700', color: '#213B2A', marginTop: 4 },
  location: { fontSize: 13, color: '#68776D', marginTop: 2 },
  notice: { fontSize: 11.5, color: '#7D8E82', textAlign: 'center', marginTop: 16, lineHeight: 17 },
  primaryBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  primaryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  secondaryBtn: { height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#DCE4DF' },
  secondaryBtnText: { color: '#1E2B22', fontWeight: '700', fontSize: 14 },
});