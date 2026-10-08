import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Image, Platform, StatusBar} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useRecordStore } from '../src/store/useRecordStore';

export default function SaveConfirmScreen() {
  const router = useRouter();
  const { recordId } = useLocalSearchParams();
  const records = useRecordStore((state) => state.records);
  const matched = records.find(r => r.recordId === recordId) || records[0];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.headline}>Record Saved</Text>
        <View style={styles.card}>
          <Text style={styles.cardSpecies}>{matched?.scientificName}</Text>
          <Text style={styles.metaText}>ID: {matched?.recordId}</Text>
          <Text style={styles.metaText}>📍 {matched?.gpsCoordination}</Text>
        </View>

        <TouchableOpacity style={styles.generateBtn} onPress={() => router.push({ pathname: '/plant-qr', params: { id: matched?.recordId } } as any)}>
          <Text style={styles.generateBtnText}>Generate QR code</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.pillAction} onPress={() => router.replace('/(tabs)/home' as any)}>
          <Text style={styles.pillActionText}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  headline: { fontSize: 24, fontWeight: '700', color: '#1E2B22', textAlign: 'center', marginBottom: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 24 },
  cardSpecies: { fontSize: 17, fontWeight: '700', color: '#1E2B22', marginBottom: 10 },
  metaText: { fontSize: 13, color: '#3A483E', marginBottom: 6 },
  generateBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  generateBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  pillAction: { backgroundColor: '#FFFFFF', height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 1.2, borderColor: '#DEE4DF' },
  pillActionText: { color: '#1E2B22', fontSize: 13, fontWeight: '700' },
});