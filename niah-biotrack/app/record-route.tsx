import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { useRecordStore } from '../src/store/useRecordStore';

export default function RecordRouteScreen() {
  const router = useRouter();
  const saveRoute = useRecordStore((state) => state.saveRoute);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    let interval: any = null;
    if (recording) {
      interval = setInterval(() => {
        setSeconds((s) => s + 1);
        setDistance((d) => d + 2); // Simulates GPS distance walked
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [recording]);

  const formatTime = (total: number) => {
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleStopAtPlant = () => {
    setRecording(false);
    saveRoute({
      distanceMeters: distance,
      durationSeconds: seconds,
      endGps: '3.2251° N, 113.7644° E (±6 m)',
    });
    router.replace('/link-route' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()}><Text style={styles.backChevron}>‹</Text></TouchableOpacity>
          <Text style={styles.headerTag}>Offline map · works without signal</Text>
        </View>

        <View style={styles.mockMapContainer}>
          <View style={styles.trailLine} />
          <View style={styles.pinOrigin}><Text style={styles.pinText}>Entrance</Text></View>
          {recording && <View style={styles.pinLive}><Text style={styles.pinLiveText}>📍 You</Text></View>}
        </View>

        {!recording ? (
          <View style={styles.controlPanel}>
            <Text style={styles.panelTitle}>Record a route</Text>
            <Text style={styles.panelSub}>Start recording at the trail entrance, then walk to the plant. Others can follow this route later.</Text>

            <View style={styles.accuracyCard}>
              <Text style={styles.accuracyTitle}>GPS accuracy ±5 m</Text>
              <Text style={styles.accuracyBadge}>Good · ready to record</Text>
            </View>

            <TouchableOpacity style={styles.startBtn} onPress={() => setRecording(true)}>
              <Text style={styles.startBtnText}>Start recording</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.controlPanel}>
            <View style={styles.activeBanner}><Text style={styles.activeBannerText}>● RECORDING</Text></View>
            <Text style={styles.panelSub}>Walk to the plant - the trail draws behind you.</Text>

            <View style={styles.telemetryRow}>
              <View style={styles.telemetryBox}><Text style={styles.telValue}>{distance} m</Text><Text style={styles.telLabel}>walked</Text></View>
              <View style={styles.telemetryBox}><Text style={styles.telValue}>{formatTime(seconds)}</Text><Text style={styles.telLabel}>time</Text></View>
              <View style={styles.telemetryBox}><Text style={styles.telValue}>±6 m</Text><Text style={styles.telLabel}>GPS accuracy</Text></View>
            </View>

            <TouchableOpacity style={styles.stopBtn} onPress={handleStopAtPlant}>
              <Text style={styles.stopBtnText}>Stop at plant</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, padding: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backChevron: { fontSize: 28, color: '#213B2A', marginRight: 10 },
  headerTag: { fontSize: 12.5, color: '#5C7163', fontWeight: '600' },
  mockMapContainer: { flex: 1, backgroundColor: '#E4EDE7', borderRadius: 24, position: 'relative', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  trailLine: { position: 'absolute', width: 4, height: '70%', backgroundColor: '#629672', borderStyle: 'dashed' },
  pinOrigin: { position: 'absolute', top: 40, backgroundColor: '#213B2A', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  pinText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  pinLive: { position: 'absolute', bottom: 60, backgroundColor: '#7B2D26', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  pinLiveText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  controlPanel: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, marginTop: 14, borderWidth: 1.2, borderColor: '#E6ECE8' },
  panelTitle: { fontSize: 19, fontWeight: '800', color: '#1E2B22' },
  panelSub: { fontSize: 13, color: '#68776D', marginVertical: 8, lineHeight: 18 },
  accuracyCard: { backgroundColor: '#F0F6F2', padding: 12, borderRadius: 14, marginVertical: 12 },
  accuracyTitle: { fontSize: 12.5, fontWeight: '700', color: '#213B2A' },
  accuracyBadge: { fontSize: 12, color: '#447C56', marginTop: 2 },
  startBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  startBtnText: { color: '#FFFFFF', fontWeight: '700' },
  activeBanner: { backgroundColor: '#FDE2E2', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, alignSelf: 'flex-start', marginBottom: 6 },
  activeBannerText: { color: '#9B1C1C', fontWeight: '800', fontSize: 11 },
  telemetryRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 16 },
  telemetryBox: { flex: 1, alignItems: 'center' },
  telValue: { fontSize: 18, fontWeight: '800', color: '#1E2B22' },
  telLabel: { fontSize: 11.5, color: '#68776D', marginTop: 2 },
  stopBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  stopBtnText: { color: '#FFFFFF', fontWeight: '700' },
});