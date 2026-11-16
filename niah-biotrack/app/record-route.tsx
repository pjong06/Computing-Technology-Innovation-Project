import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  useWindowDimensions,
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

const INITIAL_FIX_TIMEOUT_MS = 8_000;
const MAX_CANOPY_ACCURACY_M = 50;
const MIN_STEP_DISTANCE_M = 2;
const CANVAS_HEIGHT = 170;
const CANVAS_PADDING = 24;

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
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function formatDistanceDisplay(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function downsamplePoints(points: RoutePoint[], maxPoints: number): RoutePoint[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: RoutePoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(points[Math.round(i * step)]);
  }
  return sampled;
}

export default function RecordRouteScreen() {
  const router = useRouter();
  const blocked = useStaffOnly();
  const saveRoute = useRecordStore((state) => state.saveRoute);
  const { width: screenWidth } = useWindowDimensions();
  const canvasWidth = Math.max(240, screenWidth - 40);

  const [isTracking, setIsTracking] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [acquiringFix, setAcquiringFix] = useState(true);
  const [gpsWarning, setGpsWarning] = useState('');

  const [distanceMeters, setDistanceMeters] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentPoint, setCurrentPoint] = useState<RoutePoint | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<RoutePoint[]>([]);
  const [waypoints, setWaypoints] = useState<RouteWaypoint[]>([]);
  const [waypointNote, setWaypointNote] = useState('');

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const lastAcceptedPointRef = useRef<RoutePoint | null>(null);

  const appendLocationFix = (
    coords: Location.LocationObjectCoords,
    timestamp: number
  ) => {
    const accuracy = coords.accuracy ?? null;
    const point: RoutePoint = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      timestamp,
      accuracy,
    };

    setCurrentPoint(point);
    setAcquiringFix(false);

    if (accuracy !== null && accuracy > MAX_CANOPY_ACCURACY_M) {
      setGpsWarning(
        `Weak canopy signal (±${Math.round(accuracy)} m). Waiting for a sharper fix.`
      );
      return;
    }

    setGpsWarning('');

    if (isPausedRef.current) {
      return;
    }

    const prev = lastAcceptedPointRef.current;
    if (!prev) {
      lastAcceptedPointRef.current = point;
      setBreadcrumbs([point]);
      return;
    }

    const stepMeters = haversineMeters(
      prev.latitude,
      prev.longitude,
      point.latitude,
      point.longitude
    );

    if (stepMeters >= MIN_STEP_DISTANCE_M) {
      lastAcceptedPointRef.current = point;
      setDistanceMeters((d) => d + stepMeters);
      setBreadcrumbs((list) => [...list, point]);
    }
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
            appendLocationFix(liveFix.coords, liveFix.timestamp);
          }
        } catch {
          const cached = await Location.getLastKnownPositionAsync({
            maxAge: 60_000,
            requiredAccuracy: 100,
          });
          if (active && cached) {
            appendLocationFix(cached.coords, cached.timestamp);
            setGpsWarning(
              'Using recent cached GPS fix while canopy lock stabilizes.'
            );
          } else if (active) {
            setAcquiringFix(false);
            setGpsWarning(
              'Acquiring canopy GPS fix — keep moving slowly along the trail.'
            );
          }
        }

        if (!active) return;

        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2_000,
            distanceInterval: 2,
          },
          (location) => {
            if (!active) return;
            appendLocationFix(location.coords, location.timestamp);
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

  const trailProjection = useMemo(() => {
    const sourcePoints =
      breadcrumbs.length > 0
        ? downsamplePoints(breadcrumbs, 120)
        : currentPoint
        ? [currentPoint]
        : [];

    if (sourcePoints.length === 0) {
      return null;
    }

    const allLats = [
      ...sourcePoints.map((p) => p.latitude),
      ...waypoints.map((w) => w.latitude),
    ];
    const allLngs = [
      ...sourcePoints.map((p) => p.longitude),
      ...waypoints.map((w) => w.longitude),
    ];

    const minLat = Math.min(...allLats);
    const maxLat = Math.max(...allLats);
    const minLng = Math.min(...allLngs);
    const maxLng = Math.max(...allLngs);

    const rawLatSpan = maxLat - minLat;
    const rawLngSpan = maxLng - minLng;
    const isStationary = rawLatSpan < 0.00005 && rawLngSpan < 0.00005;

    const innerW = canvasWidth - CANVAS_PADDING * 2;
    const innerH = CANVAS_HEIGHT - CANVAS_PADDING * 2;
    const latSpan = Math.max(rawLatSpan, 0.0001);
    const lngSpan = Math.max(rawLngSpan, 0.0001);

    const project = (lat: number, lng: number) => {
      if (isStationary) {
        return { x: canvasWidth / 2, y: CANVAS_HEIGHT / 2 };
      }
      return {
        x: CANVAS_PADDING + ((lng - minLng) / lngSpan) * innerW,
        y: CANVAS_PADDING + (1 - (lat - minLat) / latSpan) * innerH,
      };
    };

    const projectedPoints = sourcePoints.map((pt) => project(pt.latitude, pt.longitude));
    const segments: {
      key: string;
      cx: number;
      cy: number;
      length: number;
      angleRad: number;
    }[] = [];

    for (let i = 0; i < projectedPoints.length - 1; i++) {
      const p1 = projectedPoints[i];
      const p2 = projectedPoints[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.5) continue;
      segments.push({
        key: `seg-${i}`,
        cx: (p1.x + p2.x) / 2,
        cy: (p1.y + p2.y) / 2,
        length,
        angleRad: Math.atan2(dy, dx),
      });
    }

    const projectedWaypoints = waypoints.map((wp) => ({
      ...wp,
      ...project(wp.latitude, wp.longitude),
    }));

    return {
      start: projectedPoints[0],
      end: projectedPoints[projectedPoints.length - 1],
      segments,
      waypoints: projectedWaypoints,
    };
  }, [breadcrumbs, currentPoint, waypoints, canvasWidth]);

  const handlePinWaypoint = () => {
    if (!currentPoint) {
      Toast.show({
        type: 'info',
        text1: 'Waiting for GPS',
        text2: 'Cannot pin a waypoint until a GPS coordinate is available.',
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
      const trimmedLabel = waypointNote.trim();
      const newWaypoint: RouteWaypoint = {
        id: `wp-${Date.now()}-${nextNumber}`,
        number: nextNumber,
        label: trimmedLabel || `Specimen Waypoint #${nextNumber}`,
        latitude: currentPoint.latitude,
        longitude: currentPoint.longitude,
        timeString,
      };
      return [...prev, newWaypoint];
    });

    setWaypointNote('');
    Toast.show({
      type: 'success',
      text1: 'Waypoint pinned',
      text2: 'Saved coordinate along the current transect.',
    });
  };

  const handleRemoveWaypoint = (waypointId: string) => {
    setWaypoints((prev) =>
      prev
        .filter((wp) => wp.id !== waypointId)
        .map((wp, idx) => ({
          ...wp,
          number: idx + 1,
        }))
    );
  };

  const handleLogTree = () => {
    if (!currentPoint) {
      Toast.show({
        type: 'info',
        text1: 'Waiting for GPS',
        text2: 'Hold briefly until a GPS coordinate locks before logging a tree.',
      });
      return;
    }

    router.push({
      pathname: '/new-record',
      params: {
        latitude: String(currentPoint.latitude),
        longitude: String(currentPoint.longitude),
        accuracy:
          currentPoint.accuracy !== null && currentPoint.accuracy !== undefined
            ? String(currentPoint.accuracy)
            : '',
        distanceMeters: String(Math.round(distanceMeters)),
        durationSeconds: String(durationSeconds),
      },
    } as any);
  };

  const finalizeAndLinkRoute = () => {
    const endPoint =
      currentPoint ?? breadcrumbs[breadcrumbs.length - 1] ?? null;

    if (!endPoint) {
      Toast.show({
        type: 'error',
        text1: 'No GPS coordinates recorded',
        text2: 'Wait for a GPS fix before finishing this transect.',
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
      distanceMeters: Math.round(distanceMeters),
      durationSeconds,
      endGps,
      endLatitude: endPoint.latitude,
      endLongitude: endPoint.longitude,
      endAccuracyM: endPoint.accuracy,
      breadcrumbs: breadcrumbs.length > 0 ? breadcrumbs : [endPoint],
      waypoints,
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

        {/* Live Transect Breadcrumb Canvas */}
        <View style={styles.trailCard}>
          <View style={styles.trailHeader}>
            <Text style={styles.trailTitle}>TRANSECT PATH PREVIEW</Text>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#52B788' }]} />
                <Text style={styles.legendText}>Start</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#213B2A' }]} />
                <Text style={styles.legendText}>Current</Text>
              </View>
            </View>
          </View>

          <View style={[styles.trailCanvas, { width: canvasWidth, height: CANVAS_HEIGHT }]}>
            {/* Subtle Topo Grid Lines */}
            <View style={[styles.gridLineH, { top: CANVAS_HEIGHT * 0.33 }]} />
            <View style={[styles.gridLineH, { top: CANVAS_HEIGHT * 0.66 }]} />
            <View style={[styles.gridLineV, { left: canvasWidth * 0.33 }]} />
            <View style={[styles.gridLineV, { left: canvasWidth * 0.66 }]} />

            {!trailProjection ? (
              <View style={styles.trailEmptyOverlay}>
                <ActivityIndicator size="small" color="#213B2A" />
                <Text style={styles.trailEmptyText}>Waiting for first GPS breadcrumb...</Text>
              </View>
            ) : (
              <>
                {trailProjection.segments.map((seg) => (
                  <View
                    key={seg.key}
                    style={[
                      styles.trailSegment,
                      {
                        width: seg.length,
                        left: seg.cx - seg.length / 2,
                        top: seg.cy - 1.5,
                        transform: [{ rotate: `${seg.angleRad}rad` }],
                      },
                    ]}
                  />
                ))}

                {/* Start Marker */}
                <View
                  style={[
                    styles.startMarker,
                    {
                      left: trailProjection.start.x - 6,
                      top: trailProjection.start.y - 6,
                    },
                  ]}
                />

                {/* Pinned Waypoint Pins */}
                {trailProjection.waypoints.map((wp) => (
                  <View
                    key={wp.id}
                    style={[
                      styles.canvasWpPin,
                      {
                        left: wp.x - 10,
                        top: wp.y - 10,
                      },
                    ]}
                  >
                    <Text style={styles.canvasWpText}>{wp.number}</Text>
                  </View>
                ))}

                {/* Current Position Marker */}
                <View
                  style={[
                    styles.currentMarkerOuter,
                    {
                      left: trailProjection.end.x - 11,
                      top: trailProjection.end.y - 11,
                    },
                  ]}
                >
                  <View style={styles.currentMarkerInner} />
                </View>
              </>
            )}
          </View>
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
            <Text style={styles.gpsSubText}>No GPS fix yet.</Text>
          )}

          {gpsWarning !== '' && (
            <Text style={styles.warningText}>{gpsWarning}</Text>
          )}
        </View>

        {/* Pin Specimen Waypoint */}
        <Text style={styles.sectionLabel}>SPECIMEN WAYPOINTS</Text>
        <View style={styles.waypointInputCard}>
          <TextInput
            style={styles.input}
            placeholder="Optional note (e.g. Nepenthes cluster by stream)"
            placeholderTextColor="#8C9A91"
            value={waypointNote}
            onChangeText={setWaypointNote}
            returnKeyType="done"
          />
          <TouchableOpacity
            style={styles.pinBtn}
            onPress={handlePinWaypoint}
            activeOpacity={0.85}
          >
            <Ionicons name="pin-outline" size={18} color="#213B2A" />
            <Text style={styles.pinBtnText}>Pin waypoint at current GPS</Text>
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
    gap: 12,
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
  trailCanvas: {
    backgroundColor: '#EEF5F0',
    position: 'relative',
    overflow: 'hidden',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(33, 59, 42, 0.06)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(33, 59, 42, 0.06)',
  },
  trailEmptyOverlay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  trailEmptyText: {
    fontSize: 12.5,
    color: '#526659',
    fontWeight: '600',
  },
  trailSegment: {
    position: 'absolute',
    height: 3,
    backgroundColor: '#2D6A4F',
    borderRadius: 1.5,
  },
  startMarker: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#52B788',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  canvasWpPin: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#D97706',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  canvasWpText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  currentMarkerOuter: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(33, 59, 42, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  currentMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#213B2A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
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
    backgroundColor: '#213B2A',
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
  waypointMeta: {
    fontSize: 11.5,
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