import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  StatusBar,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';

interface BreadcrumbPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number | null;
}

interface WaypointMarker {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  timeString: string;
}

export default function RecordRouteScreen() {
  const router = useRouter();

  // Telemetry & Session State
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);
  const [totalDistanceM, setTotalDistanceM] = useState<number>(0);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState<number>(0);

  // GPS Coordinates & Quality
  const [currentCoord, setCurrentCoord] = useState<BreadcrumbPoint | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbPoint[]>([]);
  const [waypoints, setWaypoints] = useState<WaypointMarker[]>([]);

  // Refs for background-safe tracking & timer intervals
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer runner
  useEffect(() => {
    if (isTracking && !isPaused) {
      timerInterval.current = setInterval(() => {
        setSecondsElapsed((prev) => prev + 1);
      }, 1000);
    } else if (timerInterval.current) {
      clearInterval(timerInterval.current);
    }

    return () => {
      if (timerInterval.current) clearInterval(timerInterval.current);
    };
  }, [isTracking, isPaused]);

  // Clean up location watcher on unmount
  useEffect(() => {
    return () => {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  // Haversine distance calculator between two GPS coordinates
  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371e3; // Earth radius in meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Start GPS Tracking
  const startTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'GPS Permission Required',
        'Enable location permissions to map botanical transects in Niah National Park.'
      );
      return;
    }

    setIsTracking(true);
    setIsPaused(false);

    try {
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 3,
        },
        (loc) => {
          const newPoint: BreadcrumbPoint = {
            latitude: Number(loc.coords.latitude.toFixed(6)),
            longitude: Number(loc.coords.longitude.toFixed(6)),
            timestamp: loc.timestamp,
            accuracy: loc.coords.accuracy ? Math.round(loc.coords.accuracy) : null,
          };

          setAccuracyM(newPoint.accuracy);
          const rawSpeed = loc.coords.speed || 0;
          setCurrentSpeedKmh(Math.max(0, Number((rawSpeed * 3.6).toFixed(1))));

          setCurrentCoord((prevPoint) => {
            if (prevPoint) {
              const delta = calculateDistance(
                prevPoint.latitude,
                prevPoint.longitude,
                newPoint.latitude,
                newPoint.longitude
              );
              // Filter out GPS drift noise under 1.5 meters
              if (delta >= 1.5) {
                setTotalDistanceM((prevDist) => Math.round(prevDist + delta));
                setBreadcrumbs((prevTrail) => [newPoint, ...prevTrail.slice(0, 199)]);
              }
            } else {
              setBreadcrumbs([newPoint]);
            }
            return newPoint;
          });
        }
      );

      Toast.show({
        type: 'success',
        text1: 'Route Recording Active',
        text2: 'Logging GPS path coordinates.',
      });
    } catch (err: any) {
      Alert.alert('GPS Error', err.message || 'Unable to initialize GPS listener.');
      setIsTracking(false);
    }
  };

  const togglePauseResume = () => {
    setIsPaused((prev) => !prev);
  };

  // Record a botanical waypoint at current GPS fix
  const handleTagPlantWaypoint = () => {
    if (!currentCoord) {
      Toast.show({
        type: 'error',
        text1: 'No GPS Fix',
        text2: 'Wait for GPS coordinates before attaching a waypoint.',
      });
      return;
    }

    const newMarker: WaypointMarker = {
      id: `WP-${waypoints.length + 1}`,
      label: `Plant Waypoint #${waypoints.length + 1}`,
      latitude: currentCoord.latitude,
      longitude: currentCoord.longitude,
      timeString: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setWaypoints((prev) => [newMarker, ...prev]);

    Toast.show({
      type: 'success',
      text1: 'Waypoint Pinned',
      text2: `Coordinates tagged at point (${currentCoord.latitude}, ${currentCoord.longitude})`,
    });
  };

  // Finish and save route
  const handleFinishRoute = () => {
    Alert.alert(
      'Finish Transect Route',
      `Save this ${formatDistance(totalDistanceM)} route with ${waypoints.length} pinned waypoints?`,
      [
        { text: 'Keep Recording', style: 'cancel' },
        {
          text: 'Save & Exit',
          style: 'default',
          onPress: () => {
            if (locationSubscription.current) {
              locationSubscription.current.remove();
            }
            setIsTracking(false);
            Toast.show({
              type: 'success',
              text1: 'Route Stored',
              text2: 'Transect route logged to local field memory.',
            });
            router.replace('/(tabs)/home');
          },
        },
      ]
    );
  };

  // Formatter utilities
  const formatTime = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters} m`;
  };

  // Accuracy quality classification
  const getGpsQuality = () => {
    if (accuracyM === null) {
      return { label: 'Searching...', color: '#68776D', bg: '#F0F4F1' };
    }
    if (accuracyM <= 5) {
      return { label: `High Precision (±${accuracyM}m)`, color: '#2D6A4F', bg: '#E8F5E9' };
    }
    if (accuracyM <= 15) {
      return { label: `Acceptable (±${accuracyM}m)`, color: '#D97706', bg: '#FEF3C7' };
    }
    return { label: `Weak Canopy Fix (±${accuracyM}m)`, color: '#DC2626', bg: '#FEE2E2' };
  };

  const gpsBadge = getGpsQuality();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Top App Bar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBackBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#213B2A" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Route Tracing</Text>
          <Text style={styles.headerSub}>Rainforest Transect Log</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* GPS Accuracy HUD Pill */}
        <View style={[styles.gpsStatusPill, { backgroundColor: gpsBadge.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: gpsBadge.color }]} />
          <Text style={[styles.gpsStatusText, { color: gpsBadge.color }]}>
            GPS Signal: {gpsBadge.label}
          </Text>
        </View>

        {/* Primary Telemetry Dashboard HUD */}
        <View style={styles.hudCard}>
          <View style={styles.hudMainRow}>
            {/* Elapsed Time */}
            <View style={styles.hudMetricCol}>
              <Text style={styles.hudMetricLabel}>DURATION</Text>
              <Text style={styles.hudMetricValBig}>{formatTime(secondsElapsed)}</Text>
            </View>

            <View style={styles.hudDivider} />

            {/* Total Distance */}
            <View style={styles.hudMetricCol}>
              <Text style={styles.hudMetricLabel}>DISTANCE</Text>
              <Text style={styles.hudMetricValBig}>{formatDistance(totalDistanceM)}</Text>
            </View>
          </View>

          {/* Secondary Telemetry Strip */}
          <View style={styles.hudSubStrip}>
            <View style={styles.hudSubMetric}>
              <Ionicons name="speedometer-outline" size={16} color="#526A5A" />
              <Text style={styles.hudSubMetricText}>
                Speed: <Text style={styles.boldText}>{currentSpeedKmh} km/h</Text>
              </Text>
            </View>

            <View style={styles.hudSubMetric}>
              <Ionicons name="trail-sign-outline" size={16} color="#526A5A" />
              <Text style={styles.hudSubMetricText}>
                Waypoints: <Text style={styles.boldText}>{waypoints.length}</Text>
              </Text>
            </View>

            <View style={styles.hudSubMetric}>
              <Ionicons name="footsteps-outline" size={16} color="#526A5A" />
              <Text style={styles.hudSubMetricText}>
                Pings: <Text style={styles.boldText}>{breadcrumbs.length}</Text>
              </Text>
            </View>
          </View>
        </View>

        {/* Live Coordinate Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="navigate-circle-outline" size={20} color="#213B2A" />
            <Text style={styles.cardTitle}>Live Coordinates</Text>
            {isTracking && (
              <View style={styles.recordingLiveBadge}>
                <View style={styles.pulsingRedDot} />
                <Text style={styles.recordingLiveText}>
                  {isPaused ? 'PAUSED' : 'LOGGING'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.coordBox}>
            <View style={styles.coordRow}>
              <Text style={styles.coordKey}>Latitude</Text>
              <Text style={styles.coordValue}>
                {currentCoord ? `${currentCoord.latitude}° N` : 'Waiting for GPS...'}
              </Text>
            </View>
            <View style={styles.coordDivider} />
            <View style={styles.coordRow}>
              <Text style={styles.coordKey}>Longitude</Text>
              <Text style={styles.coordValue}>
                {currentCoord ? `${currentCoord.longitude}° E` : 'Waiting for GPS...'}
              </Text>
            </View>
          </View>
        </View>

        {/* Pinned Waypoints & Plant Inspections */}
        <View style={styles.card}>
          <View style={styles.cardHeaderBetween}>
            <View style={styles.cardHeader}>
              <Ionicons name="pricetag-outline" size={20} color="#213B2A" />
              <Text style={styles.cardTitle}>Pinned Waypoints ({waypoints.length})</Text>
            </View>
            {isTracking && (
              <TouchableOpacity
                style={styles.addWaypointBtn}
                onPress={handleTagPlantWaypoint}
              >
                <Ionicons name="add" size={16} color="#2D6A4F" />
                <Text style={styles.addWaypointBtnText}>Pin Plant</Text>
              </TouchableOpacity>
            )}
          </View>

          {waypoints.length === 0 ? (
            <View style={styles.emptyWaypointBox}>
              <Ionicons name="location-outline" size={28} color="#A3B2A8" />
              <Text style={styles.emptyWaypointText}>
                No specimen waypoints pinned along this transect yet.
              </Text>
            </View>
          ) : (
            <View style={styles.waypointList}>
              {waypoints.map((wp, idx) => (
                <View key={wp.id} style={styles.waypointItem}>
                  <View style={styles.waypointIconBox}>
                    <Text style={styles.waypointIndexText}>{waypoints.length - idx}</Text>
                  </View>
                  <View style={styles.waypointMeta}>
                    <Text style={styles.waypointLabel}>{wp.label}</Text>
                    <Text style={styles.waypointCoords}>
                      {wp.latitude.toFixed(5)}, {wp.longitude.toFixed(5)}
                    </Text>
                  </View>
                  <Text style={styles.waypointTime}>{wp.timeString}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* High-Visibility Outdoor Floating Action Dock */}
      <View style={styles.actionDock}>
        {!isTracking ? (
          <TouchableOpacity style={styles.startTrackingBtn} onPress={startTracking}>
            <Ionicons name="play" size={22} color="#FFFFFF" />
            <Text style={styles.actionBtnText}>Start Route Recording</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.activeControlsRow}>
            {/* Pause / Resume */}
            <TouchableOpacity
              style={[
                styles.pauseBtn,
                isPaused ? styles.resumeBtnStyle : styles.pauseBtnStyle,
              ]}
              onPress={togglePauseResume}
            >
              <Ionicons
                name={isPaused ? 'play' : 'pause'}
                size={20}
                color={isPaused ? '#FFFFFF' : '#213B2A'}
              />
              <Text
                style={[
                  styles.controlBtnText,
                  { color: isPaused ? '#FFFFFF' : '#213B2A' },
                ]}
              >
                {isPaused ? 'Resume' : 'Pause'}
              </Text>
            </TouchableOpacity>

            {/* Log Observation at Current Position */}
            <TouchableOpacity
              style={styles.observeAtPinBtn}
              onPress={() => {
                if (!currentCoord) {
                  Alert.alert('GPS Pending', 'Acquiring location coordinates...');
                  return;
                }
                router.push({
                  pathname: '/add-observation',
                  params: {
                    latitude: currentCoord.latitude.toString(),
                    longitude: currentCoord.longitude.toString(),
                  },
                });
              }}
            >
              <Ionicons name="leaf-outline" size={18} color="#FFFFFF" />
              <Text style={styles.actionBtnTextSmall}>Log Tree</Text>
            </TouchableOpacity>

            {/* Finish Route */}
            <TouchableOpacity style={styles.finishBtn} onPress={handleFinishRoute}>
              <Ionicons name="stop" size={18} color="#FFFFFF" />
              <Text style={styles.actionBtnTextSmall}>Finish</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E6ECE8',
  },
  headerBackBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#F0F4F1',
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#213B2A',
  },
  headerSub: {
    fontSize: 12,
    color: '#68776D',
    marginTop: 2,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 110,
  },
  gpsStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 14,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gpsStatusText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  hudCard: {
    backgroundColor: '#1E3827',
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#1E3827',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 3,
  },
  hudMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  hudMetricCol: {
    flex: 1,
    alignItems: 'center',
  },
  hudMetricLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A3CBB1',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  hudMetricValBig: {
    fontSize: 27,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  hudDivider: {
    width: 1,
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  hudSubStrip: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  hudSubMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  hudSubMetricText: {
    fontSize: 12,
    color: '#CDE5D5',
  },
  boldText: {
    fontWeight: '800',
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E6ECE8',
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#213B2A',
  },
  recordingLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 5,
  },
  pulsingRedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2626',
  },
  recordingLiveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DC2626',
  },
  coordBox: {
    backgroundColor: '#F7F9F7',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E2EAE4',
  },
  coordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  coordDivider: {
    height: 1,
    backgroundColor: '#E6EEE8',
    marginVertical: 6,
  },
  coordKey: {
    fontSize: 13,
    color: '#68776D',
    fontWeight: '600',
  },
  coordValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#213B2A',
  },
  addWaypointBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  addWaypointBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2D6A4F',
  },
  emptyWaypointBox: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyWaypointText: {
    fontSize: 13,
    color: '#8A998E',
    textAlign: 'center',
  },
  waypointList: {
    gap: 10,
  },
  waypointItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAF9',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8EFEA',
  },
  waypointIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2D6A4F',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  waypointIndexText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  waypointMeta: {
    flex: 1,
  },
  waypointLabel: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#213B2A',
  },
  waypointCoords: {
    fontSize: 11.5,
    color: '#68776D',
    marginTop: 2,
  },
  waypointTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A998E',
  },
  actionDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#E6ECE8',
  },
  startTrackingBtn: {
    flexDirection: 'row',
    backgroundColor: '#2D6A4F',
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  actionBtnTextSmall: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  activeControlsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pauseBtn: {
    flex: 1.2,
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pauseBtnStyle: {
    backgroundColor: '#EAF1EC',
    borderWidth: 1.2,
    borderColor: '#CCD8D0',
  },
  resumeBtnStyle: {
    backgroundColor: '#2D6A4F',
  },
  controlBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
  },
  observeAtPinBtn: {
    flex: 1.2,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#1E3827',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  finishBtn: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});