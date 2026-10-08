import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, Image, Dimensions, Platform, StatusBar } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useRecordStore } from '../src/store/useRecordStore';

const { width } = Dimensions.get('window');

export default function PlantDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const records = useRecordStore((state) => state.records);
  
  const matched = records.find((r) => r.recordId === id || r.id === id) || {
    scientificName: 'Unknown Specimen',
    commonName: 'N/A',
    family: 'N/A',
    locationName: 'Unknown',
    gpsCoordination: 'Unknown',
    photoUri: '',
    morphology: 'No details provided.',
    recordId: id as string,
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        <View style={styles.heroImageContainer}>
          <TouchableOpacity onPress={() => router.back()} style={styles.floatingBackBtn}><Text style={styles.floatingBackChevron}>‹</Text></TouchableOpacity>
          {matched.photoUri ? <Image source={{ uri: matched.photoUri }} style={styles.heroPhoto} resizeMode="cover" /> : <Text style={{ fontSize: 72 }}>🌿</Text>}
        </View>

        <View style={styles.sheetBody}>
          <Text style={styles.speciesTitle}>{matched.scientificName}</Text>
          <Text style={styles.taxonomy}>{matched.commonName} · {matched.family}</Text>

          <View style={styles.statusPill}><Text style={styles.statusPillText}>• Field Documented</Text></View>

          <Text style={styles.sectionHeader}>MORPHOLOGY & NOTES</Text>
          <Text style={styles.paragraph}>{matched.morphology}</Text>

          <Text style={styles.sectionHeader}>LOCATION</Text>
          <Text style={styles.locationText}>📍 {matched.locationName} · {matched.gpsCoordination}</Text>

          <TouchableOpacity style={styles.viewQrBtn} activeOpacity={0.85} onPress={() => router.push({ pathname: '/plant-qr', params: { scientificName: matched.scientificName, recordId: matched.recordId } } as any)}>
            <Text style={styles.viewQrBtnText}>View QR code</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  heroImageContainer: { width: width, height: 260, backgroundColor: '#213B2A', justifyContent: 'center', alignItems: 'center' },
  heroPhoto: { width: '100%', height: '100%' },
  floatingBackBtn: { position: 'absolute', top: 16, left: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 20 },
  floatingBackChevron: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', marginTop: -2 },
  sheetBody: { paddingHorizontal: 22, paddingVertical: 20 },
  speciesTitle: { fontSize: 23, fontWeight: '700', color: '#1E2B22' },
  taxonomy: { fontSize: 13.5, color: '#68776D', marginTop: 4 },
  statusPill: { alignSelf: 'flex-start', backgroundColor: '#E7F4EB', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 14, marginVertical: 14 },
  statusPillText: { color: '#2A7E46', fontSize: 12.5, fontWeight: '700' },
  sectionHeader: { fontSize: 11.5, fontWeight: '800', color: '#7D8C81', letterSpacing: 0.9, marginTop: 16, marginBottom: 6 },
  paragraph: { fontSize: 13.5, color: '#2B392F', lineHeight: 21 },
  locationText: { fontSize: 13.5, fontWeight: '600', color: '#213B2A', marginTop: 2 },
  viewQrBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', marginTop: 28, marginBottom: 20 },
  viewQrBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});