import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Platform,
  StatusBar,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';

import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import Toast from 'react-native-toast-message';
import { Ionicons } from '@expo/vector-icons';

import { useStaffOnly } from '../src/context/AuthRoleContext';
import {
  useRecordStore,
  type RoutePoint,
  type RouteWaypoint,
} from '../src/store/useRecordStore';
import {
  formatCoordinates,
  describeAccuracy,
} from '../src/utils/formatCoordinates';
import TransectMapView from '../src/components/TransectMapView';

const INITIAL_FIX_TIMEOUT_MS = 8_000;
const MAX_TRACKING_ACCURACY_M = 30;
const MAX_INITIAL_ACCURACY_M = 50;
const BASE_MIN_STEP_M = 4;
const MAX_WALKING_SPEED_MPS = 8;

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
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
}

function formatDurationClock(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

function formatDistanceDisplay(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

export default function RecordRouteScreen() {
  const router = useRouter();
  const blocked = useStaffOnly();
  const saveRoute = useRecordStore((state) => state.saveRoute);

  const [isTracking, setIsTracking] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [acquiringFix, setAcquiringFix] = useState(true);
  const [gpsWarning, setGpsWarning] = useState('');

  const [distanceMeters, setDistanceMeters] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentPoint, setCurrentPoint] = useState<RoutePoint | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<RoutePoint[]>([]);
  const [waypoints, setWaypoints] = useState<RouteWaypoint[]>([]);

  const [startDescription, setStartDescription] = useState('');
  const [endDescription, setEndDescription] = useState('');
  const [waypointTitle, setWaypointTitle] = useState('');
  const [waypointDesc, setWaypointDesc] = useState('');

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const lastAcceptedPointRef = useRef<RoutePoint | null>(null);
  const lastVerifiedPointRef = useRef<RoutePoint | null>(null);
  const breadcrumbsRef = useRef<RoutePoint[]>([]);
  const waypointsRef = useRef<RouteWaypoint[]>([]);
  const distanceMetersRef = useRef(0);
  const durationSecondsRef = useRef(0);

  breadcrumbsRef.current = breadcrumbs;
  waypointsRef.current = waypoints;
  distanceMetersRef.current = distanceMeters;
  durationSecondsRef.current = durationSeconds;

  const appendLocationFix = (
    coords: Location.LocationObjectCoords,
    timestamp: number,
    allowCoarseInitial = false
  ) => {
    const accuracy = coords.accuracy ?? null;
    const maxAllowedAccuracy = allowCoarseInitial
      ? MAX_INITIAL_ACCURACY_M
      : MAX_TRACKING_ACCURACY_M;

    if (accuracy === null || accuracy > maxAllowedAccuracy) {
      setAcquiringFix(false);
      setGpsWarning(
        accuracy !== null
          ? `Weak canopy signal (±${Math.round(accuracy)} m). Holding position until GPS locks under ${MAX_TRACKING_ACCURACY_M} m.`
          : 'Waiting for GPS accuracy reading...'
      );
      return;
    }

    const rawPoint: RoutePoint = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      timestamp,
      accuracy,
    };

    setAcquiringFix(false);
    setGpsWarning('');

    if (isPausedRef.current) {
      lastVerifiedPointRef.current = rawPoint;
      setCurrentPoint(rawPoint);
      return;
    }

    const prev = lastAcceptedPointRef.current;
    if (!prev) {
      lastAcceptedPointRef.current = rawPoint;
      lastVerifiedPointRef.current = rawPoint;
      setCurrentPoint(rawPoint);
      breadcrumbsRef.current = [rawPoint];
      setBreadcrumbs([rawPoint]);
      return;
    }

    const dtSeconds = (timestamp - prev.timestamp) / 1000;
    if (dtSeconds <= 0) {
      return;
    }

    const rawStepMeters = haversineMeters(
      prev.latitude,
      prev.longitude,
      rawPoint.latitude,
      rawPoint.longitude
    );

    if (rawStepMeters / dtSeconds > MAX_WALKING_SPEED_MPS) {
      setGpsWarning('Filtered sudden canopy GPS jump.');
      return;
    }

    const requiredStepMeters = Math.max(
      BASE_MIN_STEP_M,
      Math.min(accuracy * 0.6, 15)
    );

    if (rawStepMeters < requiredStepMeters) {
      const updatedCurrent: RoutePoint = {
        ...prev,
        timestamp,
        accuracy,
      };
      lastVerifiedPointRef.current = updatedCurrent;
      setCurrentPoint(updatedCurrent);
      return;
    }

    const alpha = Math.max(0.4, Math.min(0.85, 6 / Math.max(accuracy, 6)));
    const smoothedPoint: RoutePoint = {
      latitude: prev.latitude + alpha * (rawPoint.latitude - prev.latitude),
      longitude: prev.longitude + alpha * (rawPoint.longitude - prev.longitude),
      timestamp,
      accuracy,
    };

    const acceptedStepMeters = haversineMeters(
      prev.latitude,
      prev.longitude,
      smoothedPoint.latitude,
      smoothedPoint.longitude
    );

    lastAcceptedPointRef.current = smoothedPoint;
    lastVerifiedPointRef.current = smoothedPoint;
    setCurrentPoint(smoothedPoint);

    distanceMetersRef.current += acceptedStepMeters;
    setDistanceMeters(distanceMetersRef.current);

    const nextBreadcrumbs = [...breadcrumbsRef.current, smoothedPoint];
    breadcrumbsRef.current = nextBreadcrumbs;
    setBreadcrumbs(nextBreadcrumbs);
  };

  useEffect(() => {
    let active = true;

    const startTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!active) return;

        if (status !== 'granted') {
          setAcquiringFix(false);
          setGpsWarning('Location permission is required to trace a route.');
          return;
        }

        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!active) return;

        if (!servicesEnabled) {
          setAcquiringFix(false);
          setGpsWarning('Device location services are turned off.');
          return;
        }

        try {
          const liveFix = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('INITIAL_GPS_TIMEOUT')),
                INITIAL_FIX_TIMEOUT_MS
              )
            ),
          ]);
          if (active) {
            appendLocationFix(liveFix.coords, liveFix.timestamp, true);
          }
        } catch {
          const cached = await Location.getLastKnownPositionAsync({
            maxAge: 30_000,
            requiredAccuracy: MAX_INITIAL_ACCURACY_M,
          });
          if (active && cached) {
            appendLocationFix(cached.coords, cached.timestamp, true);
            setGpsWarning(
              'Using recent cached GPS fix while canopy lock stabilizes.'
            );
          } else if (active) {
            setAcquiringFix(false);
            setGpsWarning(
              'Acquiring canopy GPS fix — move into a clear spot briefly.'
            );
          }
        }

        if (!active) return;

        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2_000,
            distanceInterval: 3,
          },
          (location) => {
            if (!active) return;
            appendLocationFix(location.coords, location.timestamp, false);
          }
        );

        if (!active) {
          sub.remove();
          return;
        }

        subscriptionRef.current = sub;
      } catch {
        if (active) {
          setAcquiringFix(false);
          setGpsWarning('Could not start GPS route watcher.');
        }
      }
    };

    void startTracking();

    return () => {
      active = false;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isTracking || isPaused) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setDurationSeconds((s) => s + 1);
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isTracking, isPaused]);

  const handlePinWaypoint = () => {
    const verifiedPoint = lastVerifiedPointRef.current ?? currentPoint;
    if (!verifiedPoint) {
      Toast.show({
        type: 'info',
        text1: 'Waiting for accurate GPS',
        text2: 'Cannot pin a waypoint until a sharp GPS coordinate locks.',
      });
      return;
    }

    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    setWaypoints((prev) => {
      const nextNumber = prev.length + 1;
      const trimmedTitle = waypointTitle.trim();
      const trimmedDesc = waypointDesc.trim();
      const newWaypoint: RouteWaypoint = {
        id: `wp-${Date.now()}-${nextNumber}`,
        number: nextNumber,
        label: trimmedTitle || `Waypoint #${nextNumber}`,
        description: trimmedDesc || undefined,
        latitude: verifiedPoint.latitude,
        longitude: verifiedPoint.longitude,
        timeString,
      };
      const updated = [...prev, newWaypoint];
      waypointsRef.current = updated;
      return updated;
    });

    setWaypointTitle('');
    setWaypointDesc('');
    Toast.show({
      type: 'success',
      text1: 'Waypoint pinned',
      text2: 'Tap its marker on the map anytime to view its description.',
    });
  };

  const handleRemoveWaypoint = (waypointId: string) => {
    setWaypoints((prev) => {
      const updated = prev
        .filter((wp) => wp.id !== waypointId)
        .map((wp, idx) => ({
          ...wp,
          number: idx + 1,
        }));
      waypointsRef.current = updated;
      return updated;
    });
  };

  const handleLogTree = () => {
    const verifiedPoint = lastVerifiedPointRef.current ?? currentPoint;
    if (!verifiedPoint) {
      Toast.show({
        type: 'info',
        text1: 'Waiting for accurate GPS',
        text2: 'Hold briefly until a sharp GPS coordinate locks before logging a tree.',
      });
      return;
    }

    router.push({
      pathname: '/new-record',
      params: {
        latitude: String(verifiedPoint.latitude),
        longitude: String(verifiedPoint.longitude),
        accuracy:
          verifiedPoint.accuracy !== null && verifiedPoint.accuracy !== undefined
            ? String(verifiedPoint.accuracy)
            : '',
        distanceMeters: String(Math.round(distanceMetersRef.current)),
        durationSeconds: String(durationSecondsRef.current),
      },
    } as any);
  };

  const finalizeAndLinkRoute = () => {
    const latestBreadcrumbs = breadcrumbsRef.current;
    const endPoint =
      lastVerifiedPointRef.current ??
      latestBreadcrumbs[latestBreadcrumbs.length - 1] ??
      currentPoint;

    if (!endPoint) {
      Toast.show({
        type: 'error',
        text1: 'No GPS coordinates recorded',
        text2: 'Wait for an accurate GPS fix before finishing this transect.',
      });
      return;
    }

    setIsTracking(false);
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;

    const endGps = formatCoordinates(
      endPoint.latitude,
      endPoint.longitude,
      endPoint.accuracy
    );

    const saved = saveRoute({
      distanceMeters: Math.round(distanceMetersRef.current),
      durationSeconds: durationSecondsRef.current,
      startDescription: startDescription.trim() || undefined,
      endDescription: endDescription.trim() || undefined,
      endGps,
      endLatitude: endPoint.latitude,
      endLongitude: endPoint.longitude,
      endAccuracyM: endPoint.accuracy,
      breadcrumbs: latestBreadcrumbs.length > 0 ? latestBreadcrumbs : [endPoint],
      waypoints: waypointsRef.current,
    });

    router.replace({
      pathname: '/link-route',
      params: { routeId: saved.id },
    } as any);
  };

  const handleFinishPress = () => {
    Alert.alert(
      'Finish route tracing?',
      'Save this transect and link it to a new or existing plant record.',
      [
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            subscriptionRef.current?.remove();
            subscriptionRef.current = null;
            router.back();
          },
        },
        {
          text: 'Keep Recording',
          style: 'cancel',
        },
        {
          text: 'Finish & Link',
          onPress: finalizeAndLinkRoute,
        },
      ]
    );
  };

  const handleBackPress = () => {
    if (distanceMeters < 5 && waypoints.length === 0 && durationSeconds < 10) {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      router.back();
      return;
    }

    Alert.alert(
      'Leave route tracing?',
      'Your active transect has not been linked yet.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Discard & Exit',
          style: 'destructive',
          onPress: () => {
            subscriptionRef.current?.remove();
            subscriptionRef.current = null;
            router.back();
          },
        },
      ]
    );
  };

  if (blocked) return null;

  const startPoint = breadcrumbs[0] ?? currentPoint;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Top Navigation */}
      <View style={styles.navRow}>
        <TouchableOpacity
          onPress={handleBackPress}
          style={styles.navSide}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back-outline" size={28} color="#213B2A" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Route tracing</Text>
        <View style={styles.navSide} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Status Banner */}
        <View style={styles.statusBanner}>
          <View style={styles.statusLeft}>
            <View
              style={[
                styles.liveDot,
                { backgroundColor: isPaused ? '#D97706' : '#2D6A4F' },
              ]}
            />
            <Text style={styles.statusLabel}>
              {isPaused ? 'Transect paused' : 'Recording forest transect'}
            </Text>
          </View>
          <Text style={styles.pointsBadge}>{breadcrumbs.length} pts</Text>
        </View>

        {/* Interactive Map View (Map / Satellite + Markers) */}
        <View style={styles.trailCard}>
          <View style={styles.trailHeader}>
            <Text style={styles.trailTitle}>LIVE TRANSECT MAP</Text>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#16A34A' }]} />
                <Text style={styles.legendText}>Start</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#D97706' }]} />
                <Text style={styles.legendText}>Point</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#2563EB' }]} />
                <Text style={styles.legendText}>Now</Text>
              </View>
            </View>
          </View>

          <TransectMapView
            breadcrumbs={breadcrumbs}
            currentPoint={currentPoint}
            waypoints={waypoints}
            startDescription={startDescription}
            endDescription={endDescription}
            height={250}
          />
          <Text style={styles.mapHint}>
            Tap any marker on the map to read its description.
          </Text>
        </View>

        {/* Primary Telemetry Card */}
        <View style={styles.metricsCard}>
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>DISTANCE</Text>
            <Text style={styles.metricValue}>
              {formatDistanceDisplay(distanceMeters)}
            </Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>DURATION</Text>
            <Text style={styles.metricValue}>
              {formatDurationClock(durationSeconds)}
            </Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>WAYPOINTS</Text>
            <Text style={styles.metricValue}>{waypoints.length}</Text>
          </View>
        </View>

        {/* Live GPS Readout Card */}
        <View style={styles.gpsCard}>
          <View style={styles.gpsTopRow}>
            <Ionicons name="navigate-outline" size={18} color="#213B2A" />
            <Text style={styles.gpsHeading}>LIVE GPS POSITION</Text>
            {currentPoint && (
              <Text style={styles.accuracyPill}>
                {describeAccuracy(currentPoint.accuracy)}
              </Text>
            )}
          </View>

          {acquiringFix && !currentPoint ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#213B2A" />
              <Text style={styles.gpsSubText}>
                Acquiring initial canopy fix...
              </Text>
            </View>
          ) : currentPoint ? (
            <>
              <Text style={styles.gpsCoordText}>
                {formatCoordinates(
                  currentPoint.latitude,
                  currentPoint.longitude,
                  null
                )}
              </Text>
              <Text style={styles.gpsSubText}>
                {currentPoint.accuracy !== null
                  ? `Accuracy ±${Math.round(currentPoint.accuracy)} m`
                  : 'Accuracy not reported'}
              </Text>
            </>
          ) : (
            <Text style={styles.gpsSubText}>No accurate GPS fix yet.</Text>
          )}

          {gpsWarning !== '' && (
            <Text style={styles.warningText}>{gpsWarning}</Text>
          )}
        </View>

        {/* Start & End Point Descriptions */}
        <Text style={styles.sectionLabel}>START & END POINT NOTES</Text>
        <View style={styles.pointCard}>
          <View style={styles.pointHeaderRow}>
            <View style={[styles.endpointBadge, { backgroundColor: '#16A34A' }]}>
              <Text style={styles.endpointBadgeText}>S</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointTitle}>Starting point</Text>
              <Text style={styles.pointCoords}>
                {startPoint
                  ? formatCoordinates(startPoint.latitude, startPoint.longitude, null)
                  : 'Waiting for first GPS fix...'}
              </Text>
            </View>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Add start point description (e.g. Plankwalk Trailhead Gate A)"
            placeholderTextColor="#8C9A91"
            value={startDescription}
            onChangeText={setStartDescription}
            returnKeyType="done"
          />

          <View style={[styles.pointHeaderRow, { marginTop: 6 }]}>
            <View style={[styles.endpointBadge, { backgroundColor: '#DC2626' }]}>
              <Text style={styles.endpointBadgeText}>E</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointTitle}>Ending point (updates as you walk)</Text>
              <Text style={styles.pointCoords}>
                {currentPoint
                  ? formatCoordinates(currentPoint.latitude, currentPoint.longitude, null)
                  : 'Waiting for GPS fix...'}
              </Text>
            </View>
          </View>
          <TextInput
            style={[styles.input, { marginBottom: 0 }]}
            placeholder="Add end point description (e.g. Limestone cliff base / target tree)"
            placeholderTextColor="#8C9A91"
            value={endDescription}
            onChangeText={setEndDescription}
            returnKeyType="done"
          />
        </View>

        {/* Pin Specimen Waypoint */}
        <Text style={styles.sectionLabel}>PIN POINT ALONG ROUTE</Text>
        <View style={styles.waypointInputCard}>
          <TextInput
            style={styles.input}
            placeholder="Point name (e.g. Stream Crossing / Orchid Cluster)"
            placeholderTextColor="#8C9A91"
            value={waypointTitle}
            onChangeText={setWaypointTitle}
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            placeholder="Description (e.g. 3 mature specimens on mossy boulder)"
            placeholderTextColor="#8C9A91"
            value={waypointDesc}
            onChangeText={setWaypointDesc}
            returnKeyType="done"
          />
          <TouchableOpacity
            style={styles.pinBtn}
            onPress={handlePinWaypoint}
            activeOpacity={0.85}
          >
            <Ionicons name="pin-outline" size={18} color="#213B2A" />
            <Text style={styles.pinBtnText}>Pin point at current GPS</Text>
          </TouchableOpacity>
        </View>

        {waypoints.length > 0 && (
          <View style={styles.waypointList}>
            {waypoints.map((wp) => (
              <View key={wp.id} style={styles.waypointRow}>
                <View style={styles.waypointNumberBadge}>
                  <Text style={styles.waypointNumberText}>{wp.number}</Text>
                </View>
                <View style={styles.waypointBody}>
                  <Text style={styles.waypointTitle}>{wp.label}</Text>
                  {wp.description ? (
                    <Text style={styles.waypointDesc}>{wp.description}</Text>
                  ) : null}
                  <Text style={styles.waypointMeta}>
                    {formatCoordinates(wp.latitude, wp.longitude, null)} ·{' '}
                    {wp.timeString}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleRemoveWaypoint(wp.id)}
                  hitSlop={8}
                  accessibilityLabel={`Remove waypoint ${wp.number}`}
                >
                  <Ionicons name="trash-outline" size={18} color="#9B1C1C" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Field Quick Action: Log Tree at Current Spot */}
        <TouchableOpacity
          style={styles.logTreeBtn}
          onPress={handleLogTree}
          activeOpacity={0.85}
        >
          <Ionicons name="leaf-outline" size={18} color="#213B2A" />
          <Text style={styles.logTreeBtnText}>Log tree at current location</Text>
        </TouchableOpacity>

        {/* Bottom Controls: Pause/Resume & Finish */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.controlBtn, styles.pauseBtn]}
            onPress={() => setIsPaused((p) => !p)}
            activeOpacity={0.85}
          >
            <Ionicons
              name={isPaused ? 'play-outline' : 'pause-outline'}
              size={18}
              color="#213B2A"
            />
            <Text style={styles.pauseBtnText}>
              {isPaused ? 'Resume' : 'Pause'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlBtn, styles.finishBtn]}
            onPress={handleFinishPress}
            activeOpacity={0.85}
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={18}
              color="#FFFFFF"
            />
            <Text style={styles.finishBtnText}>Finish</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E2B22',
  },
  navSide: {
    width: 40,
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F5E9',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
    marginBottom: 14,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E2B22',
  },
  pointsBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D6A4F',
  },
  trailCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    overflow: 'hidden',
    marginBottom: 14,
  },
  trailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6ECE8',
  },
  trailTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6A7D71',
    letterSpacing: 0.7,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: '#68776D',
    fontWeight: '600',
  },
  mapHint: {
    fontSize: 11,
    color: '#68776D',
    textAlign: 'center',
    paddingVertical: 7,
    backgroundColor: '#F9FBF9',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E6ECE8',
  },
  metricsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    paddingVertical: 18,
    marginBottom: 14,
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#E6ECE8',
  },
  metricLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#7D8C81',
    letterSpacing: 0.7,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E2B22',
  },
  gpsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 16,
    marginBottom: 16,
  },
  gpsTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  gpsHeading: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: '800',
    color: '#6A7D71',
    letterSpacing: 0.7,
  },
  accuracyPill: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#215A36',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  gpsCoordText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E2B22',
    marginBottom: 3,
  },
  gpsSubText: {
    fontSize: 12,
    color: '#68776D',
  },
  warningText: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 8,
    lineHeight: 17,
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#7D8C81',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  pointCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 14,
    marginBottom: 14,
  },
  pointHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  endpointBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endpointBadgeText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  pointTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E2B22',
  },
  pointCoords: {
    fontSize: 11,
    color: '#68776D',
  },
  waypointInputCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 14,
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#F6F8F6',
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 13.5,
    color: '#1E2B22',
    borderWidth: 1,
    borderColor: '#E0E7E2',
    marginBottom: 10,
  },
  pinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EDF5EF',
  },
  pinBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#213B2A',
  },
  waypointList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  waypointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6ECE8',
    gap: 10,
  },
  waypointNumberBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waypointNumberText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  waypointBody: {
    flex: 1,
  },
  waypointTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1E2B22',
  },
  waypointDesc: {
    fontSize: 12.5,
    color: '#374151',
    marginTop: 2,
  },
  waypointMeta: {
    fontSize: 11,
    color: '#68776D',
    marginTop: 2,
  },
  logTreeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.4,
    borderColor: '#213B2A',
    backgroundColor: '#FFFFFF',
    marginTop: 4,
    marginBottom: 14,
  },
  logTreeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#213B2A',
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  controlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    borderRadius: 26,
  },
  pauseBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#213B2A',
  },
  pauseBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#213B2A',
  },
  finishBtn: {
    backgroundColor: '#213B2A',
  },
  finishBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});