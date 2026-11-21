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
} from 'react-native';

import { useLocalSearchParams, useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Ionicons } from '@expo/vector-icons';

import { useStaffOnly } from '../src/context/AuthRoleContext';
import { useRecordStore } from '../src/store/useRecordStore';
import { formatCoordinates } from '../src/utils/formatCoordinates';
import TransectMapView from '../src/components/TransectMapView';

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

export default function LinkRouteScreen() {
  const router = useRouter();
  const blocked = useStaffOnly();
  const { routeId } = useLocalSearchParams<{ routeId?: string }>();

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

  const endPoint =
    route.endLatitude !== undefined && route.endLongitude !== undefined
      ? {
          latitude: route.endLatitude,
          longitude: route.endLongitude,
          timestamp: Date.now(),
          accuracy: route.endAccuracyM ?? null,
        }
      : null;

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
        {/* Recorded Route Summary + Interactive Map */}
        <Text style={styles.sectionLabel}>RECORDED TRANSECT</Text>
        <View style={styles.summaryCard}>
          <TransectMapView
            breadcrumbs={route.breadcrumbs ?? []}
            currentPoint={endPoint}
            waypoints={route.waypoints ?? []}
            startDescription={route.startDescription}
            endDescription={route.endDescription}
            isFinished
            height={230}
          />
          <Text style={styles.mapHint}>
            Tap S, E, or numbered pins on the map to read point notes.
          </Text>

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
            {route.startDescription ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Start note</Text>
                <Text style={styles.summaryValue} numberOfLines={2}>
                  {route.startDescription}
                </Text>
              </View>
            ) : null}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>End GPS</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>
                {route.endGps}
              </Text>
            </View>
            {route.endDescription ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>End note</Text>
                <Text style={styles.summaryValue} numberOfLines={2}>
                  {route.endDescription}
                </Text>
              </View>
            ) : null}
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
              {(route.waypoints ?? []).map((wp, idx, arr) => (
                <View
                  key={wp.id}
                  style={[
                    styles.waypointRow,
                    idx === arr.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <View style={styles.waypointBadge}>
                    <Text style={styles.waypointBadgeText}>{wp.number}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.waypointTitle}>{wp.label}</Text>
                    {wp.description ? (
                      <Text style={styles.waypointDesc}>{wp.description}</Text>
                    ) : null}
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
  mapHint: {
    fontSize: 11,
    color: '#68776D',
    textAlign: 'center',
    paddingVertical: 7,
    backgroundColor: '#F9FBF9',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E6ECE8',
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
  waypointDesc: {
    fontSize: 12.5,
    color: '#374151',
    marginTop: 2,
  },
  waypointCoords: {
    fontSize: 11.5,
    color: '#68776D',
    marginTop: 2,
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