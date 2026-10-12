import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useRecordStore, RecordStatus } from '../src/store/useRecordStore';
import PlantNotFound from '../src/components/PlantNotFound';

export default function PlantDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const records = useRecordStore((state) => state.records);

  const matched = records.find((r) => r.recordId === id || r.id === id);

  if (!matched) {
    return <PlantNotFound code={id} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        <View style={styles.heroBox}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backCircle}>
            <Text style={{ color: '#FFF', fontSize: 24 }}>‹</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 72 }}>🌺</Text>
          <View style={styles.photoCountBadge}><Text style={styles.photoCountText}>1 / 4 photos</Text></View>
        </View>

        <View style={styles.sheet}>
          <Text style={styles.title}>{matched.scientificName}</Text>
          <Text style={styles.sub}>{matched.commonName} · {matched.family}</Text>

          <View style={styles.statusRow}>
            <View style={styles.endangeredPill}><Text style={styles.endangeredText}>• Endangered</Text></View>
          </View>

          <Text style={styles.heading}>DESCRIPTION</Text>
          <Text style={styles.body}>{matched.description || 'A parasitic flowering plant known for producing one of the largest individual flowers in the world.'}</Text>

          <Text style={styles.heading}>MORPHOLOGICAL CHARACTERISTICS</Text>
          <Text style={styles.body}>{matched.morphology || 'Large five-lobed flower, reddish-brown with white speckles.'}</Text>

          <Text style={styles.heading}>LOCATION</Text>
          <Text style={styles.locText}>📍 {matched.locationName}</Text>
          <Text style={styles.gpsSub}>{matched.gpsCoordination}</Text>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/offline-map' as any)}>
              <Text style={styles.actionBtnText}>🧭 Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => router.push({ pathname: '/plant-tag', params: { id: matched.recordId } } as any)}>
              <Text style={styles.actionBtnText}>🏷️ QR tag</Text>
            </TouchableOpacity>
          </View>

          {/* Observation Visits Timeline */}
          <View style={styles.obsHeaderRow}>
            <Text style={styles.heading}>OBSERVATION HISTORY</Text>
            <Text style={styles.obsCount}>{matched.observations.length} visits</Text>
          </View>

          {matched.observations.map((obs) => (
            <View key={obs.id} style={styles.timelineItem}>
              <View style={styles.timelineLine} />
              <View style={styles.timelineDot} />
              <View style={styles.obsCard}>
                <View style={styles.obsCardTop}>
                  <Text style={styles.obsDate}>{obs.date}</Text>
                  <Text style={[styles.obsStatus, obs.status === RecordStatus.PENDING && { color: '#8C5E03' }]}>
                    • {obs.status}
                  </Text>
                </View>
                <Text style={styles.obsAuthor}>{obs.recordedBy}</Text>
                <View style={styles.pillGroup}>
                  <View style={styles.tagPill}><Text style={styles.tagPillText}>{obs.health}</Text></View>
                  <View style={styles.tagPill}><Text style={styles.tagPillText}>{obs.stage}</Text></View>
                  <View style={styles.tagPill}><Text style={styles.tagPillText}>{obs.measurement}</Text></View>
                </View>
                <Text style={styles.obsNotes}>{obs.notes}</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={styles.addObsBtn}
            onPress={() => router.push({ pathname: '/add-observation', params: { id: matched.recordId } } as any)}
          >
            <Text style={styles.addObsBtnText}>+ Add observation</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6' },
  heroBox: { height: 260, backgroundColor: '#3A261D', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  backCircle: { position: 'absolute', top: 30, left: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  photoCountBadge: { position: 'absolute', bottom: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 14 },
  photoCountText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  sheet: { padding: 22, backgroundColor: '#F6F8F6' },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22' },
  sub: { fontSize: 13.5, color: '#68776D', marginTop: 4 },
  statusRow: { marginVertical: 12 },
  endangeredPill: { backgroundColor: '#FDE2E2', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, alignSelf: 'flex-start' },
  endangeredText: { color: '#9B1C1C', fontSize: 11.5, fontWeight: '700' },
  heading: { fontSize: 12, fontWeight: '800', color: '#6A7D71', letterSpacing: 0.8, marginTop: 16, marginBottom: 6 },
  body: { fontSize: 13.5, color: '#2B392F', lineHeight: 20 },
  locText: { fontSize: 14, fontWeight: '700', color: '#1E2B22', marginTop: 2 },
  gpsSub: { fontSize: 12, color: '#68776D', marginTop: 2 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 18 },
  actionBtn: { flex: 1, backgroundColor: '#FFFFFF', height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 1.2, borderColor: '#DCE4DF', marginHorizontal: 4 },
  actionBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 13.5 },
  obsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 12 },
  obsCount: { fontSize: 12, color: '#68776D', fontWeight: '600' },
  timelineItem: { position: 'relative', paddingLeft: 24, marginBottom: 16 },
  timelineLine: { position: 'absolute', left: 6, top: 12, bottom: -12, width: 2, backgroundColor: '#D6E2DA' },
  timelineDot: { position: 'absolute', left: 2, top: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: '#213B2A' },
  obsCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, borderWidth: 1.2, borderColor: '#E6ECE8' },
  obsCardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  obsDate: { fontSize: 13, fontWeight: '700', color: '#1E2B22' },
  obsStatus: { fontSize: 11, fontWeight: '700', color: '#215A36' },
  obsAuthor: { fontSize: 11.5, color: '#7E8F83', marginTop: 2 },
  pillGroup: { flexDirection: 'row', marginVertical: 8 },
  tagPill: { backgroundColor: '#EDF5EF', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, marginRight: 6 },
  tagPillText: { fontSize: 11, fontWeight: '700', color: '#213B2A' },
  obsNotes: { fontSize: 12.5, color: '#3A483E', lineHeight: 18 },
  addObsBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', marginTop: 16, marginBottom: 30 },
  addObsBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },
});