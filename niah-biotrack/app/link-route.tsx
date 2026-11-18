import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Platform,
  StatusBar,
  Alert,
  useWindowDimensions,
} from 'react-native';

import { useLocalSearchParams, useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Ionicons } from '@expo/vector-icons';

import { useStaffOnly } from '../src/context/AuthRoleContext';
import { useRecordStore, type RoutePoint } from '../src/store/useRecordStore';
import { formatCoordinates } from '../src/utils/formatCoordinates';

const PREVIEW_HEIGHT = 140;
const PREVIEW_PADDING = 22;

function formatRouteDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatRouteDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs} sec`;
  return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;
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

export default function LinkRouteScreen() {
  const router = useRouter();
  const blocked = useStaffOnly();
  const { routeId } = useLocalSearchParams<{ routeId?: string }>();
  const { width: screenWidth } = useWindowDimensions();
  const canvasWidth = Math.max(240, screenWidth - 40);

  const routes = useRecordStore((state) => state.routes);
  const activeDraftRoute = useRecordStore((state) => state.activeDraftRoute);
  const records = useRecordStore((state) => state.records);
  const linkRouteToPlant = useRecordStore((state) => state.linkRouteToPlant);
  const discardDraftRoute = useRecordStore((state) => state.discardDraftRoute);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const route = useMemo(() => {
    if (routeId) {
      const found = routes.find((r) => r.id === routeId);
      if (found) return found;
    }
    return activeDraftRoute ?? routes[0] ?? null;
  }, [routeId, routes, activeDraftRoute]);

  const trailProjection = useMemo(() => {
    if (!route) return null;

    const rawPoints = route.breadcrumbs ?? [];
    const fallbackPoints: RoutePoint[] =
      rawPoints.length > 0
        ? downsamplePoints(rawPoints, 100)
        : route.endLatitude !== undefined && route.endLongitude !== undefined
        ? [
            {
              latitude: route.endLatitude,
              longitude: route.endLongitude,
              timestamp: Date.now(),
              accuracy: route.endAccuracyM ?? null,
            },
          ]
        : [];

    if (fallbackPoints.length === 0) return null;

    const wps = route.waypoints ?? [];
    const allLats = [
      ...fallbackPoints.map((p) => p.latitude),
      ...wps.map((w) => w.latitude),
    ];
    const allLngs = [
      ...fallbackPoints.map((p) => p.longitude),
      ...wps.map((w) => w.longitude),
    ];

    const minLat = Math.min(...allLats);
    const maxLat = Math.max(...allLats);
    const minLng = Math.min(...allLngs);
    const maxLng = Math.max(...allLngs);

    const rawLatSpan = maxLat - minLat;
    const rawLngSpan = maxLng - minLng;
    const isStationary = rawLatSpan < 0.00005 && rawLngSpan < 0.00005;

    const innerW = canvasWidth - PREVIEW_PADDING * 2;
    const innerH = PREVIEW_HEIGHT - PREVIEW_PADDING * 2;
    const latSpan = Math.max(rawLatSpan, 0.0001);
    const lngSpan = Math.max(rawLngSpan, 0.0001);

    const project = (lat: number, lng: number) => {
      if (isStationary) {
        return { x: canvasWidth / 2, y: PREVIEW_HEIGHT / 2 };
      }
      return {
        x: PREVIEW_PADDING + ((lng - minLng) / lngSpan) * innerW,
        y: PREVIEW_PADDING + (1 - (lat - minLat) / latSpan) * innerH,
      };
    };

    const projectedPoints = fallbackPoints.map((pt) =>
      project(pt.latitude, pt.longitude)
    );
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

    const projectedWaypoints = wps.map((wp) => ({
      ...wp,
      ...project(wp.latitude, wp.longitude),
    }));

    return {
      start: projectedPoints[0],
      end: projectedPoints[projectedPoints.length - 1],
      segments,
      waypoints: projectedWaypoints,
    };
  }, [route, canvasWidth]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.scientificName.toLowerCase().includes(q) ||
        r.commonName.toLowerCase().includes(q) ||
        (r.tagCode ?? '').toLowerCase().includes(q) ||
        r.locationName.toLowerCase().includes(q)
    );
  }, [records, searchQuery]);

  const handleCreateNewPlant = () => {
    if (!route) return;

    router.push({
      pathname: '/new-record',
      params: {
        routeId: route.id,
        latitude:
          route.endLatitude !== undefined ? String(route.endLatitude) : '',
        longitude:
          route.endLongitude !== undefined ? String(route.endLongitude) : '',
        accuracy:
          route.endAccuracyM !== undefined && route.endAccuracyM !== null
            ? String(route.endAccuracyM)
            : '',
        distanceMeters: String(route.distanceMeters),
        durationSeconds: String(route.durationSeconds),
      },
    } as any);
  };

  const handleLinkExisting = async () => {
    if (!route || !selectedPlantId || linking) return;

    setLinking(true);
    try {
      await linkRouteToPlant(route.id, selectedPlantId);
      Toast.show({
        type: 'success',
        text1: 'Route linked',
        text2: 'Transect distance and walking time saved to plant record.',
      });
      router.replace({
        pathname: '/plant-detail',
        params: { id: selectedPlantId },
      } as any);
    } finally {
      setLinking(false);
    }
  };

  const handleDiscard = () => {
    Alert.alert(
      'Discard recorded route?',
      'This transect will be removed and will not be linked to any plant.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            discardDraftRoute();
            router.replace('/(tabs)/home' as any);
          },
        },
      ]
    );
  };

  if (blocked) return null;

  if (!route) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navSide}>
            <Ionicons name="chevron-back-outline" size={28} color="#213B2A" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Link route</Text>
          <View style={styles.navSide} />
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No recorded route found</Text>
          <Text style={styles.emptyBody}>
            Record a forest transect first before linking it to a plant.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/record-route' as any)}
          >
            <Text style={styles.primaryBtnText}>Start route tracing</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Top Navigation */}
      <View style={styles.navRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navSide}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back-outline" size={28} color="#213B2A" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Link route</Text>
        <View style={styles.navSide} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Recorded Route Summary + Trail Preview */}
        <Text style={styles.sectionLabel}>RECORDED TRANSECT</Text>
        <View style={styles.summaryCard}>
          {trailProjection && (
            <View
              style={[
                styles.trailCanvas,
                { width: canvasWidth - 2.4, height: PREVIEW_HEIGHT },
              ]}
            >
              <View style={[styles.gridLineH, { top: PREVIEW_HEIGHT * 0.5 }]} />
              <View style={[styles.gridLineV, { left: canvasWidth * 0.5 }]} />

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

              <View
                style={[
                  styles.startMarker,
                  {
                    left: trailProjection.start.x - 5,
                    top: trailProjection.start.y - 5,
                  },
                ]}
              />

              {trailProjection.waypoints.map((wp) => (
                <View
                  key={wp.id}
                  style={[
                    styles.canvasWpPin,
                    {
                      left: wp.x - 9,
                      top: wp.y - 9,
                    },
                  ]}
                >
                  <Text style={styles.canvasWpText}>{wp.number}</Text>
                </View>
              ))}

              <View
                style={[
                  styles.endMarker,
                  {
                    left: trailProjection.end.x - 7,
                    top: trailProjection.end.y - 7,
                  },
                ]}
              />
            </View>
          )}

          <View style={styles.summaryBody}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total distance</Text>
              <Text style={styles.summaryValue}>
                {formatRouteDistance(route.distanceMeters)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Walking duration</Text>
              <Text style={styles.summaryValue}>
                {formatRouteDuration(route.durationSeconds)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>End GPS</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>
                {route.endGps}
              </Text>
            </View>
            <View style={[styles.summaryRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.summaryLabel}>Pinned waypoints</Text>
              <Text style={styles.summaryValue}>
                {route.waypoints?.length ?? 0}
              </Text>
            </View>
          </View>
        </View>

        {/* Pinned Waypoint Details (if any) */}
        {(route.waypoints?.length ?? 0) > 0 && (
          <>
            <Text style={styles.sectionLabel}>PINNED WAYPOINTS</Text>
            <View style={styles.waypointSummaryCard}>
              {(route.waypoints ?? []).map((wp) => (
                <View key={wp.id} style={styles.waypointRow}>
                  <View style={styles.waypointBadge}>
                    <Text style={styles.waypointBadgeText}>{wp.number}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.waypointTitle}>{wp.label}</Text>
                    <Text style={styles.waypointCoords}>
                      {formatCoordinates(wp.latitude, wp.longitude, null)} ·{' '}
                      {wp.timeString}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Option 1: New Plant Record */}
        <Text style={styles.sectionLabel}>OPTION 1 · NEW SPECIMEN</Text>
        <TouchableOpacity
          style={styles.newPlantCard}
          onPress={handleCreateNewPlant}
          activeOpacity={0.85}
        >
          <View style={styles.newPlantIconCircle}>
            <Ionicons name="add-outline" size={22} color="#FFFFFF" />
          </View>
          <View style={styles.newPlantBody}>
            <Text style={styles.newPlantTitle}>New plant record</Text>
            <Text style={styles.newPlantSub}>
              Pre-fills end GPS coordinates and attaches this transect automatically
            </Text>
          </View>
          <Ionicons name="chevron-forward-outline" size={20} color="#213B2A" />
        </TouchableOpacity>

        {/* Option 2: Existing Plant Record */}
        <Text style={styles.sectionLabel}>OPTION 2 · LINK TO EXISTING PLANT</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by species, tag code, or landmark..."
          placeholderTextColor="#8C9A91"
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />

        {filteredRecords.length === 0 ? (
          <View style={styles.noPlantsBox}>
            <Text style={styles.noPlantsText}>
              {records.length === 0
                ? 'No plant records on this device yet. Create a new plant record above.'
                : 'No matching plant records found.'}
            </Text>
          </View>
        ) : (
          <View style={styles.plantList}>
            {filteredRecords.map((plant) => {
              const selected = selectedPlantId === plant.id;
              return (
                <TouchableOpacity
                  key={plant.id}
                  style={[styles.plantCard, selected && styles.plantCardSelected]}
                  onPress={() => setSelectedPlantId(plant.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.plantInfo}>
                    <Text style={styles.plantName}>
                      {plant.scientificName || 'Identification pending'}
                    </Text>
                    <Text style={styles.plantMeta}>
                      {plant.tagCode ? `Tag ${plant.tagCode} · ` : ''}
                      {plant.locationName || 'No landmark'}
                    </Text>
                  </View>
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={selected ? '#213B2A' : '#9AA89F'}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {selectedPlantId && (
          <TouchableOpacity
            style={[styles.primaryBtn, linking && { opacity: 0.65 }]}
            onPress={() => void handleLinkExisting()}
            disabled={linking}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>
              {linking ? 'Linking...' : 'Link route to selected plant'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.discardBtn}
          onPress={handleDiscard}
          activeOpacity={0.8}
        >
          <Text style={styles.discardBtnText}>Discard route</Text>
        </TouchableOpacity>
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
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#7D8C81',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 8,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    overflow: 'hidden',
    marginBottom: 8,
  },
  trailCanvas: {
    backgroundColor: '#EEF5F0',
    position: 'relative',
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DCE4DF',
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
  trailSegment: {
    position: 'absolute',
    height: 3,
    backgroundColor: '#2D6A4F',
    borderRadius: 1.5,
  },
  startMarker: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#52B788',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  canvasWpPin: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#D97706',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  canvasWpText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
  },
  endMarker: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#213B2A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  summaryBody: {
    paddingHorizontal: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6ECE8',
    gap: 12,
  },
  summaryLabel: {
    fontSize: 13,
    color: '#68776D',
  },
  summaryValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1E2B22',
  },
  waypointSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  waypointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6ECE8',
  },
  waypointBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waypointBadgeText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  waypointTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E2B22',
  },
  waypointCoords: {
    fontSize: 11.5,
    color: '#68776D',
    marginTop: 1,
  },
  newPlantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.4,
    borderColor: '#213B2A',
    padding: 14,
    gap: 12,
    marginBottom: 8,
  },
  newPlantIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#213B2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  newPlantBody: {
    flex: 1,
  },
  newPlantTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#1E2B22',
  },
  newPlantSub: {
    fontSize: 12,
    color: '#68776D',
    marginTop: 2,
    lineHeight: 16,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 13.5,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 10,
  },
  noPlantsBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 16,
    marginBottom: 14,
  },
  noPlantsText: {
    fontSize: 13,
    color: '#68776D',
    textAlign: 'center',
  },
  plantList: {
    gap: 8,
    marginBottom: 16,
  },
  plantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 14,
    gap: 10,
  },
  plantCardSelected: {
    backgroundColor: '#EEF5F0',
    borderColor: '#213B2A',
    borderWidth: 1.8,
  },
  plantInfo: {
    flex: 1,
  },
  plantName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E2B22',
  },
  plantMeta: {
    fontSize: 12,
    color: '#68776D',
    marginTop: 2,
  },
  primaryBtn: {
    backgroundColor: '#213B2A',
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  discardBtn: {
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  discardBtnText: {
    color: '#9B1C1C',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E2B22',
    textAlign: 'center',
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 13.5,
    color: '#68776D',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
});