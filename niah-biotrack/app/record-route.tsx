import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useAuthRole } from '../src/context/AuthRoleContext';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MAP_WIDTH = SCREEN_WIDTH - 32;
const MAP_HEIGHT = 240;

// Anti-Jitter Threshold Constants
const MAX_ALLOWED_ACCURACY_M = 50;    // Accept fixes up to ±50m under canopy
const MIN_MOVEMENT_THRESHOLD_M = 1.8; // Must move >= 1.8m to eliminate stationary jitter

export interface BreadcrumbPoint {
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
  const { isVisitor } = useAuthRole();

  // Guard against visitor unauthorized access
  useEffect(() => {
    if (isVisitor) {
      Alert.alert(
        'Botanist Access Required',
        'Visitor accounts are read-only. Patrol route recording is restricted to staff.',
        [{ text: 'OK', onPress: () => router.replace('/(tabs)/home') }]
      );
    }
  }, [isVisitor]);

  // Telemetry States
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);
  const [totalDistanceM, setTotalDistanceM] = useState<number>(0);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState<number>(0);

  // GPS Data
  const [currentCoord, setCurrentCoord] = useState<BreadcrumbPoint | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbPoint[]>([]);
  const [waypoints, setWaypoints] = useState<WaypointMarker[]>([]);

  // Tracking and Timer Refs
  const isPausedRef = useRef<boolean>(false);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPointRef = useRef<BreadcrumbPoint | null>(null);
  const totalDistanceRef = useRef<number>(0);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (locationSubscription.current) locationSubscription.current.remove();
      if (timerInterval.current) clearInterval(timerInterval.current);
    };
  }, []);

  // Haversine distance formula
  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371e3;
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

  // Start Hardware GPS Tracking
  const startTracking = async () => {
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        Alert.alert(
          'Location Services Disabled',
          'Please enable GPS / Location in your phone settings to record routes.'
        );
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Denied',
          'Location permissions are required to trace your field transect path.'
        );
        return;
      }

      setIsTracking(true);
      setIsPaused(false);
      isPausedRef.current = false;
      lastPointRef.current = null;
      totalDistanceRef.current = 0;
      setTotalDistanceM(0);

      const initialFix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const firstPoint: BreadcrumbPoint = {
        latitude: Number(initialFix.coords.latitude.toFixed(6)),
        longitude: Number(initialFix.coords.longitude.toFixed(6)),
        timestamp: initialFix.timestamp,
        accuracy: initialFix.coords.accuracy ? Math.round(initialFix.coords.accuracy) : null,
      };

      setCurrentCoord(firstPoint);
      setAccuracyM(firstPoint.accuracy);
      lastPointRef.current = firstPoint;
      setBreadcrumbs([firstPoint]);

      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 1500,
          distanceInterval: 1,
        },
        (loc) => {
          if (isPausedRef.current) return;

          const acc = loc.coords.accuracy ? Math.round(loc.coords.accuracy) : null;
          setAccuracyM(acc);

          if (acc !== null && acc > MAX_ALLOWED_ACCURACY_M) {
            return;
          }

          const newPoint: BreadcrumbPoint = {
            latitude: Number(loc.coords.latitude.toFixed(6)),
            longitude: Number(loc.coords.longitude.toFixed(6)),
            timestamp: loc.timestamp,
            accuracy: acc,
          };

          setCurrentCoord(newPoint);

          if (lastPointRef.current) {
            const delta = calculateDistance(
              lastPointRef.current.latitude,
              lastPointRef.current.longitude,
              newPoint.latitude,
              newPoint.longitude
            );

            const timeDeltaSec = Math.max(1, (newPoint.timestamp - lastPointRef.current.timestamp) / 1000);
            const maxAllowedJump = Math.max(30, 15 * timeDeltaSec);

            if (delta >= MIN_MOVEMENT_THRESHOLD_M && delta <= maxAllowedJump) {
              totalDistanceRef.current += delta;
              setTotalDistanceM(Math.round(totalDistanceRef.current));
              setBreadcrumbs((prevTrail) => [...prevTrail, newPoint]);
              lastPointRef.current = newPoint;

              const calculatedKmh = (delta / timeDeltaSec) * 3.6;
              const rawSpeed =
                loc.coords.speed !== null && loc.coords.speed !== undefined && loc.coords.speed > 0
                  ? loc.coords.speed * 3.6
                  : calculatedKmh;
              setCurrentSpeedKmh(Number(rawSpeed.toFixed(1)));
            } else if (delta < MIN_MOVEMENT_THRESHOLD_M) {
              setCurrentSpeedKmh(0);
            }
          } else {
            lastPointRef.current = newPoint;
            setBreadcrumbs([newPoint]);
          }
        }
      );

      Toast.show({
        type: 'success',
        text1: 'GPS Route Active',
        text2: 'Live path tracking initialized.',
      });
    } catch (err: any) {
      Alert.alert('GPS Error', err.message || 'Could not initialize GPS listener.');
      setIsTracking(false);
    }
  };

  const togglePauseResume = () => {
    isPausedRef.current = !isPaused;
    setIsPaused(!isPaused);
  };

  const handleTagPlantWaypoint = () => {
    if (!currentCoord) {
      Toast.show({
        type: 'error',
        text1: 'No GPS Fix',
        text2: 'Wait for GPS coordinates before pinning a waypoint.',
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
      text2: `Coordinates tagged at (${currentCoord.latitude}, ${currentCoord.longitude})`,
    });
  };

  // Log tree: transfers the current GPS location AND entire breadcrumb trail to the register form
  const handleLogTree = () => {
    if (!currentCoord) {
      Alert.alert('GPS Pending', 'Acquiring GPS fix before registering plant...');
      return;
    }

    router.push({
      pathname: '/new-record',
      params: {
        latitude: currentCoord.latitude.toString(),
        longitude: currentCoord.longitude.toString(),
        accuracy: accuracyM ? accuracyM.toString() : '10',
        route: JSON.stringify(breadcrumbs),
      },
    } as any);
  };

  const handleFinishRoute = () => {
    Alert.alert(
      'Finish Route',
      `Save this ${formatDistance(totalDistanceM)} route with ${waypoints.length} pinned waypoints?`,
      [
        { text: 'Keep Recording', style: 'cancel' },
        {
          text: 'Save & Exit',
          style: 'default',
          onPress: () => {
            if (locationSubscription.current) locationSubscription.current.remove();
            setIsTracking(false);
            Toast.show({
              type: 'success',
              text1: 'Route Saved',
              text2: 'Transect route stored to device.',
            });
            router.replace('/(tabs)/home');
          },
        },
      ]
    );
  };

  const formatTime = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDistance = (meters: number) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    return `${meters} m`;
  };

  const getGpsQuality = () => {
    if (accuracyM === null) {
      return { label: 'Searching...', color: '#68776D', bg: '#F0F4F1' };
    }
    if (accuracyM <= 10) {
      return { label: `Strong Canopy Fix (±${accuracyM}m)`, color: '#2D6A4F', bg: '#E8F5E9' };
    }
    if (accuracyM <= 35) {
      return { label: `Moderate Canopy Fix (±${accuracyM}m)`, color: '#D97706', bg: '#FEF3C7' };
    }
    return { label: `Weak Canopy Fix (±${accuracyM}m)`, color: '#DC2626', bg: '#FEE2E2' };
  };

  const gpsBadge = getGpsQuality();

  const mapData = useMemo(() => {
    if (breadcrumbs.length === 0) return null;

    const lats = breadcrumbs.map((b) => b.latitude);
    const lngs = breadcrumbs.map((b) => b.longitude);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latSpan = Math.max(maxLat - minLat, 0.00015);
    const lngSpan = Math.max(maxLng - minLng, 0.00015);

    const pad = 28;
    const drawW = MAP_WIDTH - pad * 2;
    const drawH = MAP_HEIGHT - pad * 2;

    const scale = Math.min(drawW / lngSpan, drawH / latSpan);

    const project = (lat: number, lng: number) => {
      const x = pad + (lng - minLng) * scale + (drawW - lngSpan * scale) / 2;
      const y = MAP_HEIGHT - (pad + (lat - minLat) * scale + (drawH - latSpan * scale) / 2);
      return { x, y };
    };

    const projectedPoints = breadcrumbs.map((pt) => project(pt.latitude, pt.longitude));

    const segments = [];
    for (let i = 0; i < projectedPoints.length - 1; i++) {
      const p1 = projectedPoints[i];
      const p2 = projectedPoints[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      segments.push({
        id: `seg-${i}`,
        left: midX - length / 2,
        top: midY - 1.5,
        width: length,
        angle,
      });
    }

    const projectedWaypoints = waypoints.map((wp) => ({
      ...wp,
      ...project(wp.latitude, wp.longitude),
    }));

    return {
      points: projectedPoints,
      segments,
      waypoints: projectedWaypoints,
      start: projectedPoints[0],
      current: projectedPoints[projectedPoints.length - 1],
    };
  }, [breadcrumbs, waypoints]);

  if (isVisitor) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back-outline" size={22} color="#213B2A" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Route Tracing</Text>
          <Text style={styles.headerSub}>Real-Time GPS Transect</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* GPS Accuracy Pill */}
        <View style={[styles.gpsStatusPill, { backgroundColor: gpsBadge.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: gpsBadge.color }]} />
          <Text style={[styles.gpsStatusText, { color: gpsBadge.color }]}>
            Signal: {gpsBadge.label}
          </Text>
        </View>

        {/* Vector Visualizer Canvas */}
        <View style={styles.mapCanvasCard}>
          <View style={styles.mapHeader}>
            <View style={styles.mapHeaderLeft}>
              <Ionicons name="map-outline" size={17} color="#52B788" />
              <Text style={styles.mapHeaderTitle}>TRANSECT VISUALIZER</Text>
            </View>
            <View style={styles.compassBadge}>
              <Ionicons name="compass-outline" size={14} color="#74C69D" />
              <Text style={styles.compassText}>N ↑</Text>
            </View>
          </View>

          <View style={styles.canvasContainer}>
            <View style={styles.gridOverlay}>
              <View style={[styles.gridLineH, { top: '25%' }]} />
              <View style={[styles.gridLineH, { top: '50%' }]} />
              <View style={[styles.gridLineH, { top: '75%' }]} />
              <View style={[styles.gridLineV, { left: '25%' }]} />
              <View style={[styles.gridLineV, { left: '50%' }]} />
              <View style={[styles.gridLineV, { left: '75%' }]} />
            </View>

            {!mapData || mapData.points.length === 0 ? (
              <View style={styles.emptyMapNotice}>
                <Ionicons name="navigate-outline" size={32} color="#40634E" />
                <Text style={styles.emptyMapTitle}>Awaiting Movement</Text>
                <Text style={styles.emptyMapSub}>
                  Start recording and walk forward to render your live trail path.
                </Text>
              </View>
            ) : (
              <>
                {mapData.segments.map((seg) => (
                  <View
                    key={seg.id}
                    style={[
                      styles.pathSegment,
                      {
                        left: seg.left,
                        top: seg.top,
                        width: seg.width,
                        transform: [{ rotate: `${seg.angle}deg` }],
                      },
                    ]}
                  />
                ))}

                {mapData.start && (
                  <View style={[styles.markerPin, { left: mapData.start.x - 10, top: mapData.start.y - 10 }]}>
                    <View style={styles.startBeacon}>
                      <Text style={styles.startBeaconText}>S</Text>
                    </View>
                  </View>
                )}

                {mapData.waypoints.map((wp, idx) => (
                  <View key={wp.id} style={[styles.markerPin, { left: wp.x - 9, top: wp.y - 9 }]}>
                    <View style={styles.waypointBeacon}>
                      <Text style={styles.waypointBeaconText}>{idx + 1}</Text>
                    </View>
                  </View>
                ))}

                {mapData.current && (
                  <View
                    style={[
                      styles.markerPin,
                      { left: mapData.current.x - 12, top: mapData.current.y - 12 },
                    ]}
                  >
                    <View style={styles.currentPulseOuter}>
                      <View style={styles.currentPulseInner} />
                    </View>
                  </View>
                )}
              </>
            )}
          </View>

          <View style={styles.mapFooterStrip}>
            <Text style={styles.mapCoordText}>
              {currentCoord ? `${currentCoord.latitude}°, ${currentCoord.longitude}°` : '0.000000°, 0.000000°'}
            </Text>
            <Text style={styles.mapBreadcrumbsCount}>{breadcrumbs.length} Pings Logged</Text>
          </View>
        </View>

        {/* Telemetry Metrics HUD Card */}
        <View style={styles.hudCard}>
          <View style={styles.hudMainRow}>
            <View style={styles.hudMetricCol}>
              <Text style={styles.hudMetricLabel}>DURATION</Text>
              <Text style={styles.hudMetricValBig}>{formatTime(secondsElapsed)}</Text>
            </View>

            <View style={styles.hudDivider} />

            <View style={styles.hudMetricCol}>
              <Text style={styles.hudMetricLabel}>DISTANCE</Text>
              <Text style={styles.hudMetricValBig}>{formatDistance(totalDistanceM)}</Text>
            </View>
          </View>

          <View style={styles.hudSubStrip}>
            <View style={styles.hudSubMetric}>
              <Ionicons name="speedometer-outline" size={16} color="#74C69D" />
              <Text style={styles.hudSubMetricText}>
                Speed: <Text style={styles.boldText}>{currentSpeedKmh} km/h</Text>
              </Text>
            </View>

            <View style={styles.hudSubMetric}>
              <Ionicons name="git-commit-outline" size={16} color="#74C69D" />
              <Text style={styles.hudSubMetricText}>
                Waypoints: <Text style={styles.boldText}>{waypoints.length}</Text>
              </Text>
            </View>
          </View>
        </View>

        {/* Pinned Plant Waypoints Section */}
        <View style={styles.card}>
          <View style={styles.cardHeaderBetween}>
            <View style={styles.cardHeader}>
              <Ionicons name="pricetag-outline" size={19} color="#213B2A" />
              <Text style={styles.cardTitle}>Pinned Waypoints ({waypoints.length})</Text>
            </View>
            {isTracking && (
              <TouchableOpacity
                style={styles.addWaypointBtn}
                onPress={handleTagPlantWaypoint}
                accessibilityRole="button"
                accessibilityLabel="Pin Specimen Waypoint"
              >
                <Ionicons name="add-outline" size={15} color="#2D6A4F" />
                <Text style={styles.addWaypointBtnText}>Pin Specimen</Text>
              </TouchableOpacity>
            )}
          </View>

          {waypoints.length === 0 ? (
            <View style={styles.emptyWaypointBox}>
              <Ionicons name="location-outline" size={26} color="#A3B2A8" />
              <Text style={styles.emptyWaypointText}>No plant waypoints pinned along this path yet.</Text>
            </View>
          ) : (
            <View style={styles.waypointList}>
              {waypoints.map((wp, idx) => (
                <View key={wp.id} style={styles.waypointItem}>
                  <View style={styles.waypointIndexBox}>
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

      {/* Action Controls */}
      <View style={styles.actionDock}>
        {!isTracking ? (
          <TouchableOpacity
            style={styles.startTrackingBtn}
            onPress={() => {
              startTracking().catch((err) => {
                console.error('Failed to start tracking:', err);
              });
            }}
            accessibilityRole="button"
            accessibilityLabel="Start Live GPS Recording"
          >
            <Ionicons name="play" size={20} color="#FFFFFF" />
            <Text style={styles.actionBtnText}>Start Live GPS Recording</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.activeControlsRow}>
            <TouchableOpacity
              style={[styles.pauseBtn, isPaused ? styles.resumeBtnStyle : styles.pauseBtnStyle]}
              onPress={togglePauseResume}
              accessibilityRole="button"
              accessibilityLabel={isPaused ? 'Resume tracking' : 'Pause tracking'}
            >
              <Ionicons
                name={isPaused ? 'play' : 'pause'}
                size={18}
                color={isPaused ? '#FFFFFF' : '#213B2A'}
              />
              <Text style={[styles.controlBtnText, { color: isPaused ? '#FFFFFF' : '#213B2A' }]}>
                {isPaused ? 'Resume' : 'Pause'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.observeAtPinBtn}
              onPress={handleLogTree}
              accessibilityRole="button"
              accessibilityLabel="Log Tree and attach current route"
            >
              <Ionicons name="leaf-outline" size={17} color="#FFFFFF" />
              <Text style={styles.actionBtnTextSmall}>Log Tree</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.finishBtn}
              onPress={handleFinishRoute}
              accessibilityRole="button"
              accessibilityLabel="Finish and save route"
            >
              <Ionicons name="stop" size={17} color="#FFFFFF" />
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
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 12,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gpsStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  mapCanvasCard: {
    backgroundColor: '#112217',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#1D3B29',
    marginBottom: 14,
  },
  mapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  mapHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapHeaderTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#52B788',
    letterSpacing: 0.8,
  },
  compassBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  compassText: {
    color: '#74C69D',
    fontSize: 11,
    fontWeight: '800',
  },
  canvasContainer: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    position: 'relative',
    backgroundColor: '#0F2115',
  },
  gridOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(82, 183, 136, 0.1)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(82, 183, 136, 0.1)',
  },
  emptyMapNotice: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 6,
  },
  emptyMapTitle: {
    color: '#74C69D',
    fontSize: 14,
    fontWeight: '800',
  },
  emptyMapSub: {
    color: '#52796F',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  pathSegment: {
    position: 'absolute',
    height: 3.5,
    backgroundColor: '#52B788',
    borderRadius: 2,
    shadowColor: '#52B788',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 2,
  },
  markerPin: {
    position: 'absolute',
    zIndex: 10,
  },
  startBeacon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1E3827',
    borderWidth: 2,
    borderColor: '#74C69D',
    justifyContent: 'center',
    alignItems: 'center',
  },
  startBeaconText: {
    color: '#D8F3DC',
    fontSize: 10,
    fontWeight: '900',
  },
  waypointBeacon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#D97706',
    borderWidth: 2,
    borderColor: '#FDE68A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waypointBeaconText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  currentPulseOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(82, 183, 136, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  currentPulseInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#52B788',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  mapFooterStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  mapCoordText: {
    color: '#95D5B2',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  mapBreadcrumbsCount: {
    color: '#52796F',
    fontSize: 11,
    fontWeight: '600',
  },
  hudCard: {
    backgroundColor: '#1B3B26',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  hudMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
  },
  hudMetricCol: {
    flex: 1,
    alignItems: 'center',
  },
  hudMetricLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#95D5B2',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  hudMetricValBig: {
    fontSize: 26,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  hudDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  hudSubStrip: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 12,
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
    color: '#D8F3DC',
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
    marginBottom: 14,
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
    fontSize: 14.5,
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
    paddingVertical: 20,
    gap: 6,
  },
  emptyWaypointText: {
    fontSize: 12.5,
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
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8EFEA',
  },
  waypointIndexBox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#2D6A4F',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  waypointIndexText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  waypointMeta: {
    flex: 1,
  },
  waypointLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#213B2A',
  },
  waypointCoords: {
    fontSize: 11,
    color: '#68776D',
    marginTop: 2,
  },
  waypointTime: {
    fontSize: 11.5,
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
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E6ECE8',
  },
  startTrackingBtn: {
    flexDirection: 'row',
    backgroundColor: '#2D6A4F',
    height: 50,
    borderRadius: 25,
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
    fontSize: 13,
    fontWeight: '800',
  },
  activeControlsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pauseBtn: {
    flex: 1.2,
    height: 48,
    borderRadius: 24,
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
    fontSize: 13,
    fontWeight: '800',
  },
  observeAtPinBtn: {
    flex: 1.2,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1E3827',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  finishBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});