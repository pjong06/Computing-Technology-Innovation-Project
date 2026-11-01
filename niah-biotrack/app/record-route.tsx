import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useRecordStore } from '../src/store/useRecordStore';
import { formatCoordinates } from '../src/utils/formatCoordinates';

interface Coordinate {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

// Great-circle distance between two GPS coordinates in meters
function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's mean radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function RecordRouteScreen() {
  const router = useRouter();
  const saveRoute = useRecordStore((state) => state.saveRoute);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [distance, setDistance] = useState(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [lastCoords, setLastCoords] = useState<Coordinate | null>(null);

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const pointsRef = useRef<Coordinate[]>([]);

  // Timer ticker
  useEffect(() => {
    let timer: any = null;
    if (recording) {
      timer = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timer) clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recording]);

  // Clean up location listener on unmount
  useEffect(() => {
    return () => {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
    };
  }, []);

  const startGpsTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Needed',
        'Location permission is required to trace field routes.'
      );
      return;
    }

    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      Alert.alert(
        'Location Disabled',
        'Please turn on device location services to record walking routes.'
      );
      return;
    }

    setRecording(true);
    setSeconds(0);
    setDistance(0);
    pointsRef.current = [];

    locationSubscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 1500, // sample every 1.5s
        distanceInterval: 2, // minimum 2 meters moved
      },
      (location) => {
        const { latitude, longitude, accuracy: acc } = location.coords;
        const newCoord: Coordinate = { latitude, longitude, accuracy: acc ?? null };

        setAccuracy(acc ?? null);
        setLastCoords(newCoord);

        if (pointsRef.current.length > 0) {
          const prev = pointsRef.current[pointsRef.current.length - 1];
          const delta = calculateHaversineDistance(
            prev.latitude,
            prev.longitude,
            newCoord.latitude,
            newCoord.longitude
          );
          // Filter out stationary jitter (drift < 1.5 m)
          if (delta >= 1.5) {
            setDistance((d) => Math.round(d + delta));
            pointsRef.current.push(newCoord);
          }
        } else {
          pointsRef.current.push(newCoord);
        }
      }
    );
  };

  const formatTime = (total: number) => {
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleStopAtPlant = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    setRecording(false);

    // Format actual ending coordinates using project utility
    const endGpsString = lastCoords
      ? formatCoordinates(lastCoords.latitude, lastCoords.longitude, lastCoords.accuracy)
      : '3.8167° N, 113.7833° E (±5 m)';

    saveRoute({
      distanceMeters: Math.max(distance, 1),
      durationSeconds: Math.max(seconds, 1),
      endGps: endGpsString,
    });

    router.replace('/link-route' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backChevron}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTag}>Live GPS Trail Tracing</Text>
        </View>

        <View style={styles.mockMapContainer}>
          <View style={styles.trailLine} />
          <View style={styles.pinOrigin}>
            <Text style={styles.pinText}>Trail Start</Text>
          </View>
          {recording && (
            <View style={styles.pinLive}>
              <Text style={styles.pinLiveText}>📍 You</Text>
            </View>
          )}
        </View>

        {!recording ? (
          <View style={styles.controlPanel}>
            <Text style={styles.panelTitle}>Record a route</Text>
            <Text style={styles.panelSub}>
              Start recording at the trail entrance, then walk to the plant. GPS coordinates and
              distance will trace continuously.
            </Text>

            <View style={styles.accuracyCard}>
              <Text style={styles.accuracyTitle}>GPS ready</Text>
              <Text style={styles.accuracyBadge}>High accuracy tracking enabled</Text>
            </View>

            <TouchableOpacity style={styles.startBtn} onPress={startGpsTracking}>
              <Text style={styles.startBtnText}>Start recording</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.controlPanel}>
            <View style={styles.activeBanner}>
              <Text style={styles.activeBannerText}>● RECORDING GPS ROUTE</Text>
            </View>
            <Text style={styles.panelSub}>Walk to the specimen — coordinates accumulate in real time.</Text>

            <View style={styles.telemetryRow}>
              <View style={styles.telemetryBox}>
                <Text style={styles.telValue}>{distance} m</Text>
                <Text style={styles.telLabel}>walked</Text>
              </View>
              <View style={styles.telemetryBox}>
                <Text style={styles.telValue}>{formatTime(seconds)}</Text>
                <Text style={styles.telLabel}>time</Text>
              </View>
              <View style={styles.telemetryBox}>
                <Text style={styles.telValue}>
                  {accuracy !== null ? `±${Math.round(accuracy)} m` : '±5 m'}
                </Text>
                <Text style={styles.telLabel}>GPS accuracy</Text>
              </View>
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
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: { flex: 1, padding: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backChevron: { fontSize: 28, color: '#213B2A', marginRight: 10 },
  headerTag: { fontSize: 12.5, color: '#5C7163', fontWeight: '600' },
  mockMapContainer: {
    flex: 1,
    backgroundColor: '#E4EDE7',
    borderRadius: 24,
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trailLine: {
    position: 'absolute',
    width: 4,
    height: '70%',
    backgroundColor: '#629672',
    borderStyle: 'dashed',
  },
  pinOrigin: {
    position: 'absolute',
    top: 40,
    backgroundColor: '#213B2A',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  pinText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  pinLive: {
    position: 'absolute',
    bottom: 60,
    backgroundColor: '#7B2D26',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  pinLiveText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  controlPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginTop: 14,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  panelTitle: { fontSize: 19, fontWeight: '800', color: '#1E2B22' },
  panelSub: { fontSize: 13, color: '#68776D', marginVertical: 8, lineHeight: 18 },
  accuracyCard: {
    backgroundColor: '#F0F6F2',
    padding: 12,
    borderRadius: 14,
    marginVertical: 12,
  },
  accuracyTitle: { fontSize: 12.5, fontWeight: '700', color: '#213B2A' },
  accuracyBadge: { fontSize: 12, color: '#447C56', marginTop: 2 },
  startBtn: {
    backgroundColor: '#213B2A',
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startBtnText: { color: '#FFFFFF', fontWeight: '700' },
  activeBanner: {
    backgroundColor: '#FDE2E2',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  activeBannerText: { color: '#9B1C1C', fontWeight: '800', fontSize: 11 },
  telemetryRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 16 },
  telemetryBox: { flex: 1, alignItems: 'center' },
  telValue: { fontSize: 18, fontWeight: '800', color: '#1E2B22' },
  telLabel: { fontSize: 11.5, color: '#68776D', marginTop: 2 },
  stopBtn: {
    backgroundColor: '#213B2A',
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopBtnText: { color: '#FFFFFF', fontWeight: '700' },
});