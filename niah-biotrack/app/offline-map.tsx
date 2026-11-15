import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRecordStore } from '../src/store/useRecordStore';
import PlantNotFound from '../src/components/PlantNotFound';
import { bearingDegrees, compassDirection, distanceMeters, formatDistance } from '../src/utils/geo';

type GpsState =
  | { status: 'locating' }
  | { status: 'denied' }
  | { status: 'error'; message: string }
  | { status: 'ready'; latitude: number; longitude: number; accuracyM: number | null };

// Points the botanist from where they stand to a plant's saved coordinates, using only
// the phone's GPS and compass (works offline; there is no map tile download).
export default function OfflineMapScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const plant = useRecordStore((state) => state.records.find((r) => r.id === id));
  const hasCoordinates = plant?.latitude !== undefined && plant?.longitude !== undefined;

  const [gps, setGps] = useState<GpsState>({ status: 'locating' });
  // Degrees clockwise from north the phone is pointing; null when there's no compass.
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    if (!hasCoordinates) return;

    let active = true; // ignore updates that arrive after leaving the screen
    let positionSub: Location.LocationSubscription | null = null;
    let headingSub: Location.LocationSubscription | null = null;

    // Line 34: Defined and invoked with .catch() to resolve typescript:S9383 unhandled promise
    const initLocationTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!active) return;
        if (status !== 'granted') {
          setGps({ status: 'denied' });
          return;
        }

        positionSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 },
          (loc) => {
            if (!active) return;
            setGps({
              status: 'ready',
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracyM: loc.coords.accuracy != null ? Math.round(loc.coords.accuracy) : null,
            });
          }
        );

        // The compass is optional: without it the screen shows the bearing as text only.
        try {
          headingSub = await Location.watchHeadingAsync((h) => {
            if (!active) return;
            // trueHeading is -1 when the phone can't work it out; magnetic north is close
            // enough around Niah (declination is under 1°).
            const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
            setHeading(Number.isFinite(value) && value >= 0 ? value : null);
          });
        } catch {
          setHeading(null);
        }
      } catch {
        if (active) setGps({ status: 'error', message: 'Could not get a GPS fix. Check that location is turned on.' });
      }

      // A subscription may finish starting after the screen was left.
      if (!active) {
        positionSub?.remove();
        headingSub?.remove();
      }
    };

    initLocationTracking().catch((error) => {
      console.error('Offline map location tracking error:', error);
      if (active) {
        setGps({ status: 'error', message: 'Could not get a GPS fix. Check that location is turned on.' });
      }
    });

    return () => {
      active = false;
      positionSub?.remove();
      headingSub?.remove();
    };
  }, [hasCoordinates]);

  if (!plant) return <PlantNotFound code={id} />;

  // Distance and direction from the phone to the plant, once both positions are known.
  const target =
    hasCoordinates && gps.status === 'ready'
      ? {
          distance: distanceMeters(gps.latitude, gps.longitude, plant.latitude!, plant.longitude!),
          bearing: bearingDegrees(gps.latitude, gps.longitude, plant.latitude!, plant.longitude!),
        }
      : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back-outline" size={28} color="#213B2A" />
          </TouchableOpacity>
          <Text style={styles.headerTag}>Find plant</Text>
        </View>

        <View style={styles.compassCard}>
          {!hasCoordinates ? (
            <Text style={styles.messageText}>
              This plant has no saved GPS coordinates, so there is nothing to navigate to.
            </Text>
          ) : gps.status === 'denied' ? (
            <Text style={styles.messageText}>Location permission is needed to guide you to this plant.</Text>
          ) : gps.status === 'error' ? (
            <Text style={styles.messageText}>{gps.message}</Text>
          ) : !target ? (
            <Text style={styles.messageText}>Getting a GPS fix…</Text>
          ) : (
            <>
              <Text style={styles.directionDistance}>{formatDistance(target.distance)}</Text>
              <Text style={styles.directionInstruction}>
                Head {compassDirection(target.bearing)} ({Math.round(target.bearing)}°)
              </Text>
              {heading !== null ? (
                // The arrow points at the plant relative to where the phone is facing.
                <View style={styles.compassRing}>
                  <Text style={[styles.arrow, { transform: [{ rotate: `${target.bearing - heading}deg` }] }]}>
                    ↑
                  </Text>
                </View>
              ) : (
                <Text style={styles.noCompass}>No compass on this phone: use the bearing above.</Text>
              )}
              <Text style={styles.accuracyWarning}>
                {gps.status === 'ready' && gps.accuracyM !== null
                  ? `±${gps.accuracyM} m GPS accuracy`
                  : 'GPS accuracy unknown'}
                {' · straight-line distance'}
              </Text>
            </>
          )}
        </View>

        <View style={styles.targetInfo}>
          <Text style={styles.targetTitle}>{plant.scientificName || 'Identification pending'}</Text>
          <Text style={styles.targetLoc}>
            {plant.locationName || 'No location landmark'} · {plant.tagCode ?? 'No tag attached'}
          </Text>
        </View>

        <TouchableOpacity style={styles.arriveBtn} onPress={() => router.replace('/(tabs)/scan' as any)}>
          <Text style={styles.arriveBtnText}>Arrived - scan tag</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, padding: 22, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { marginRight: 8, padding: 4 },
  headerTag: { fontSize: 13, color: '#5C7163', fontWeight: '600' },
  compassCard: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 24, alignItems: 'center', borderWidth: 1.2, borderColor: '#E6ECE8' },
  messageText: { fontSize: 14, color: '#4E6254', textAlign: 'center', lineHeight: 20 },
  directionDistance: { fontSize: 32, fontWeight: '800', color: '#1E2B22' },
  directionInstruction: { fontSize: 13, color: '#68776D', marginTop: 4, marginBottom: 20 },
  compassRing: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#EDF5EF', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  arrow: { fontSize: 56, fontWeight: '800', color: '#213B2A' },
  noCompass: { fontSize: 12.5, color: '#68776D', marginBottom: 16, textAlign: 'center' },
  accuracyWarning: { fontSize: 11.5, color: '#447C56', fontWeight: '600' },
  targetInfo: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, borderWidth: 1.2, borderColor: '#E6ECE8' },
  targetTitle: { fontSize: 17, fontWeight: '700', fontStyle: 'italic', color: '#1E2B22' },
  targetLoc: { fontSize: 12.5, color: '#68776D', marginTop: 2 },
  arriveBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  arriveBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },
});