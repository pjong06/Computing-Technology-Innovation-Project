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
  TextInput,
  Linking,
} from 'react-native';

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';

import { useStaffOnly } from '../src/context/AuthRoleContext';
import {
  useRecordStore,
  type PlantRecord,
  type RecordedRoute,
  type RoutePoint,
} from '../src/store/useRecordStore';
import {
  formatCoordinates,
  describeAccuracy,
} from '../src/utils/formatCoordinates';
import { isPhysicalTag } from '../src/utils/myTags';
import { navigableCoordinates } from '../src/utils/plantDetails';
import { navigablePlantRows } from '../src/utils/recordsList';
import TransectMapView, {
  type MapTargetPoint,
} from '../src/components/TransectMapView';
import OfflinePlantMap from '../src/components/OfflinePlantMap';
import { usePlantListStore } from '../src/store/usePlantListStore';
import { useSpeciesStore } from '../src/store/useSpeciesStore';

const INITIAL_FIX_TIMEOUT_MS = 8_000;
const MAX_TRACKING_ACCURACY_M = 30;
const MAX_INITIAL_ACCURACY_M = 50;
const ARRIVAL_THRESHOLD_M = 10;

// What the screen needs of a plant: a record on the phone, or (offline too) a plant someone
// else registered whose coordinates were saved when the plant list loaded.
type NavigableInfo = Pick<PlantRecord, 'id' | 'serverId' | 'scientificName' | 'commonName' | 'tagCode' | 'locationName'>;

interface NavigablePlant {
  // Unique, stable row key: "plant:" + server id, else phone id, else tag (recordsList.ts).
  key: string;
  plant: NavigableInfo;
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
}

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

function computeBearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function formatDistanceDisplay(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function resolvePlantCoordinates(
  plant: PlantRecord,
  routes: RecordedRoute[]
): { latitude: number; longitude: number } | null {
  // The plant's own location on the phone, or (approved plants) the server's.
  const known = navigableCoordinates(plant);
  if (known) return known;

  const linkedRoute = routes.find(
    (r) =>
      r.linkedPlantId === plant.id ||
      (plant.serverId && r.linkedPlantId === plant.serverId)
  );

  if (
    linkedRoute &&
    typeof linkedRoute.endLatitude === 'number' &&
    typeof linkedRoute.endLongitude === 'number'
  ) {
    return {
      latitude: linkedRoute.endLatitude,
      longitude: linkedRoute.endLongitude,
    };
  }

  return null;
}

export default function NavigatePlantScreen() {
  const router = useRouter();
  const blocked = useStaffOnly();
  const params = useLocalSearchParams<{ plantId?: string; id?: string }>();
  const initialId = params.plantId ?? params.id ?? null;

  const records = useRecordStore((state) => state.records);
  const routes = useRecordStore((state) => state.routes);
  // Other botanists' listed plants, with coordinates saved on the phone (works offline).
  const savedPositions = usePlantListStore((state) => state.savedPositions);
  const speciesList = useSpeciesStore((state) => state.species);

  // No internet: the map shows the phone-drawn offline view (TransectMapView also switches
  // to it by itself when the map tiles fail to load).
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    void usePlantListStore.getState().loadSavedPositions();
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    return unsubscribe;
  }, []);

  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(initialId);
  const [showPicker, setShowPicker] = useState(!initialId);
  const [searchQuery, setSearchQuery] = useState('');

  const [acquiringFix, setAcquiringFix] = useState(true);
  const [gpsWarning, setGpsWarning] = useState('');
  const [currentPoint, setCurrentPoint] = useState<RoutePoint | null>(null);
  const [headingDegrees, setHeadingDegrees] = useState<number | null>(null);

  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const headingSubRef = useRef<Location.LocationSubscription | null>(null);
  const hasInitialFixRef = useRef(false);

  const requestedRecord = useMemo(() => {
    if (!selectedPlantId) return null;
    return (
      records.find(
        (r) => r.id === selectedPlantId || r.serverId === selectedPlantId
      ) ?? null
    );
  }, [records, selectedPlantId]);

  const navigablePlants = useMemo<NavigablePlant[]>(() => {
    // One row per plant: the plants on the phone and the server positions saved on the phone
    // can be the same plant, so they are merged (phone copy first; it takes the server's
    // coordinates when it has none). Plants without an identity or coordinates are left out.
    const rows = navigablePlantRows<NavigableInfo, NavigableInfo>(
      records.map((plant) => ({
        plant,
        identity: { serverId: plant.serverId, localId: plant.id, tagCode: plant.tagCode },
        coordinates: resolvePlantCoordinates(plant, routes),
      })),
      savedPositions.map((saved) => {
        const species = saved.speciesId
          ? speciesList.find((item) => item.id === saved.speciesId)
          : undefined;
        return {
          plant: {
            id: saved.serverId,
            serverId: saved.serverId,
            scientificName: species?.scientific_name ?? '',
            commonName: species?.common_name ?? '',
            tagCode: saved.tagCode,
            locationName: saved.locationNote ?? '',
          },
          identity: { serverId: saved.serverId, tagCode: saved.tagCode },
          coordinates: { latitude: saved.latitude, longitude: saved.longitude },
        };
      })
    );

    const list: NavigablePlant[] = rows.map((row) => ({
      key: row.key,
      plant: row.plant,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceMeters: currentPoint
        ? haversineMeters(currentPoint.latitude, currentPoint.longitude, row.latitude, row.longitude)
        : null,
    }));

    if (currentPoint) {
      list.sort(
        (a, b) =>
          (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) -
          (b.distanceMeters ?? Number.MAX_SAFE_INTEGER)
      );
    }

    return list;
  }, [records, routes, currentPoint, savedPositions, speciesList]);

  const selectedTarget = useMemo<NavigablePlant | null>(() => {
    if (!selectedPlantId) return null;
    return (
      navigablePlants.find(
        (item) =>
          item.plant.id === selectedPlantId ||
          item.plant.serverId === selectedPlantId
      ) ?? null
    );
  }, [navigablePlants, selectedPlantId]);

  const filteredPlants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return navigablePlants;
    return navigablePlants.filter(
      ({ plant }) =>
        plant.scientificName.toLowerCase().includes(q) ||
        plant.commonName.toLowerCase().includes(q) ||
        (plant.tagCode ?? '').toLowerCase().includes(q) ||
        plant.locationName.toLowerCase().includes(q)
    );
  }, [navigablePlants, searchQuery]);

  useEffect(() => {
    let active = true;

    const startSensors = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!active) return;

        if (status !== 'granted') {
          setAcquiringFix(false);
          setGpsWarning('Location permission is required to locate your phone.');
          return;
        }

        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!active) return;

        if (!servicesEnabled) {
          setAcquiringFix(false);
          setGpsWarning('Device location services are turned off.');
          return;
        }

        const handleFix = (
          coords: Location.LocationObjectCoords,
          timestamp: number,
          allowCoarse = false
        ) => {
          const accuracy = coords.accuracy ?? null;
          const limit =
            allowCoarse || !hasInitialFixRef.current
              ? MAX_INITIAL_ACCURACY_M
              : MAX_TRACKING_ACCURACY_M;

          if (accuracy === null || accuracy > limit) {
            setAcquiringFix(false);
            setGpsWarning(
              accuracy !== null
                ? `Weak canopy signal (±${Math.round(accuracy)} m). Holding steady until GPS locks under ${MAX_TRACKING_ACCURACY_M} m.`
                : 'Waiting for GPS accuracy reading...'
            );
            return;
          }

          hasInitialFixRef.current = true;
          setAcquiringFix(false);
          setGpsWarning('');
          setCurrentPoint({
            latitude: coords.latitude,
            longitude: coords.longitude,
            timestamp,
            accuracy,
          });
        };

        try {
          const initialFix = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('INITIAL_GPS_TIMEOUT')),
                INITIAL_FIX_TIMEOUT_MS
              )
            ),
          ]);
          if (active) {
            handleFix(initialFix.coords, initialFix.timestamp, true);
          }
        } catch {
          const cached = await Location.getLastKnownPositionAsync({
            maxAge: 30_000,
            requiredAccuracy: MAX_INITIAL_ACCURACY_M,
          });
          if (active && cached) {
            handleFix(cached.coords, cached.timestamp, true);
            setGpsWarning('Using recent cached GPS fix while canopy lock stabilizes.');
          } else if (active) {
            setAcquiringFix(false);
            setGpsWarning('Acquiring phone GPS fix — move into a clear spot briefly.');
          }
        }

        if (!active) return;

        const locSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2_000,
            distanceInterval: 2,
          },
          (loc) => {
            if (!active) return;
            handleFix(loc.coords, loc.timestamp, false);
          }
        );

        if (!active) {
          locSub.remove();
          return;
        }
        locationSubRef.current = locSub;

        try {
          const headSub = await Location.watchHeadingAsync((heading) => {
            if (!active) return;
            const deg =
              heading.trueHeading >= 0 ? heading.trueHeading : heading.magHeading;
            if (typeof deg === 'number' && !Number.isNaN(deg)) {
              setHeadingDegrees(deg);
            }
          });
          if (!active) {
            headSub.remove();
          } else {
            headingSubRef.current = headSub;
          }
        } catch {
          // Magnetometer unavailable on device
        }
      } catch {
        if (active) {
          setAcquiringFix(false);
          setGpsWarning('Could not start phone GPS sensors.');
        }
      }
    };

    void startSensors();

    return () => {
      active = false;
      locationSubRef.current?.remove();
      locationSubRef.current = null;
      headingSubRef.current?.remove();
      headingSubRef.current = null;
    };
  }, []);

  if (blocked) return null;

  const missingCoordsForRequested =
    requestedRecord !== null && selectedTarget === null;

  const mapTarget: MapTargetPoint | null = selectedTarget
    ? {
        latitude: selectedTarget.latitude,
        longitude: selectedTarget.longitude,
        title: selectedTarget.plant.scientificName || 'Target Plant',
        subtitle:
          [
            isPhysicalTag(selectedTarget.plant.tagCode)
              ? `Tag ${selectedTarget.plant.tagCode}`
              : null,
            selectedTarget.plant.locationName || null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Saved plant coordinates',
      }
    : null;

  const distanceToPlant =
    currentPoint && selectedTarget
      ? haversineMeters(
          currentPoint.latitude,
          currentPoint.longitude,
          selectedTarget.latitude,
          selectedTarget.longitude
        )
      : null;

  const bearingToPlant =
    currentPoint && selectedTarget
      ? computeBearingDegrees(
          currentPoint.latitude,
          currentPoint.longitude,
          selectedTarget.latitude,
          selectedTarget.longitude
        )
      : null;

  const arrowRotationDeg =
    bearingToPlant !== null
      ? headingDegrees !== null
        ? (bearingToPlant - headingDegrees + 360) % 360
        : bearingToPlant
      : 0;

  const hasArrived =
    distanceToPlant !== null && distanceToPlant <= ARRIVAL_THRESHOLD_M;

  const handleOpenGoogleMaps = () => {
    if (!selectedTarget) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${selectedTarget.latitude},${selectedTarget.longitude}&travelmode=walking`;
    void Linking.openURL(url);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Top Bar */}
      <View style={styles.navRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navSide}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back-outline" size={28} color="#213B2A" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Find plant</Text>
        <View style={styles.navSide} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Warning if the chosen plant has no saved GPS coordinates */}
        {missingCoordsForRequested && (
          <View style={styles.noCoordsBanner}>
            <View style={styles.noCoordsHeader}>
              <Ionicons name="alert-circle-outline" size={20} color="#B45309" />
              <Text style={styles.noCoordsTitle}>
                No GPS coordinates recorded for{' '}
                {requestedRecord.scientificName || 'this plant'}
              </Text>
            </View>
            <Text style={styles.noCoordsBody}>
              Saved landmark:{' '}
              <Text style={{ fontWeight: '700' }}>
                {requestedRecord.locationName || 'Not recorded'}
              </Text>
              . Choose a plant with GPS coordinates below to navigate on the map.
            </Text>
          </View>
        )}

        {/* Target Plant Card or Switcher */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>TARGET PLANT</Text>
          {selectedTarget && !showPicker && (
            <TouchableOpacity onPress={() => setShowPicker(true)}>
              <Text style={styles.changeLink}>Change plant</Text>
            </TouchableOpacity>
          )}
        </View>

        {selectedTarget && !showPicker ? (
          <View style={styles.targetCard}>
            <View style={styles.plantBadge}>
              <Ionicons name="leaf" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.targetTitle}>
                {selectedTarget.plant.scientificName || 'Identification pending'}
              </Text>
              <Text style={styles.targetSub}>
                {isPhysicalTag(selectedTarget.plant.tagCode)
                  ? `Tag ${selectedTarget.plant.tagCode} · `
                  : ''}
                {selectedTarget.plant.locationName || 'Saved plant location'}
              </Text>
              <Text style={styles.targetCoords}>
                {formatCoordinates(
                  selectedTarget.latitude,
                  selectedTarget.longitude,
                  null
                )}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.pickerCard}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search plant by species, tag code, or landmark..."
              placeholderTextColor="#8C9A91"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />

            {filteredPlants.length === 0 ? (
              <Text style={styles.emptyText}>
                No plants with saved GPS coordinates found yet.
              </Text>
            ) : (
              <View style={styles.plantList}>
                {filteredPlants.map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={styles.plantOptionRow}
                    onPress={() => {
                      setSelectedPlantId(item.plant.id);
                      setShowPicker(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.plantOptionName}>
                        {item.plant.scientificName || 'Identification pending'}
                      </Text>
                      <Text style={styles.plantOptionMeta}>
                        {isPhysicalTag(item.plant.tagCode) ? `Tag ${item.plant.tagCode} · ` : ''}
                        {item.plant.locationName ||
                          formatCoordinates(item.latitude, item.longitude, null)}
                      </Text>
                    </View>
                    {item.distanceMeters !== null && (
                      <View style={styles.distBadge}>
                        <Text style={styles.distBadgeText}>
                          {formatDistanceDisplay(item.distanceMeters)}
                        </Text>
                      </View>
                    )}
                    <Ionicons
                      name="navigate-circle-outline"
                      size={22}
                      color="#213B2A"
                    />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Interactive Phone-to-Plant Map */}
        {selectedTarget && (
          <>
            <Text style={styles.sectionLabel}>LIVE NAVIGATION MAP</Text>
            <View style={styles.mapCard}>
              <View style={styles.mapHeader}>
                <Text style={styles.mapTitle}>YOUR PHONE TO PLANT</Text>
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#2563EB' }]} />
                    <Text style={styles.legendText}>You</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} />
                    <Text style={styles.legendText}>Plant</Text>
                  </View>
                </View>
              </View>

              <TransectMapView
                currentPoint={currentPoint}
                targetPoint={mapTarget}
                height={280}
                offline={offline}
                offlineView={
                  <OfflinePlantMap
                    here={currentPoint}
                    headingDegrees={headingDegrees}
                    target={{
                      key: selectedTarget.key,
                      latitude: selectedTarget.latitude,
                      longitude: selectedTarget.longitude,
                      title: selectedTarget.plant.scientificName || 'Target plant',
                    }}
                    others={navigablePlants.map((item) => ({
                      key: item.key,
                      latitude: item.latitude,
                      longitude: item.longitude,
                      title: item.plant.scientificName || 'Plant',
                    }))}
                    onSelect={(key) => {
                      const chosen = navigablePlants.find((item) => item.key === key);
                      if (!chosen) return;
                      setSelectedPlantId(chosen.plant.id);
                      setShowPicker(false);
                    }}
                  />
                }
              />
              <Text style={styles.mapHint}>
                Blue dot = your phone · Red P = target plant · Dashed line = path
              </Text>
            </View>
          </>
        )}

        {/* Arrival Banner */}
        {selectedTarget && hasArrived && (
          <View style={styles.arrivalBanner}>
            <View style={styles.arrivalTop}>
              <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
              <Text style={styles.arrivalTitle}>
                You have arrived near this plant!
              </Text>
            </View>
            <Text style={styles.arrivalSub}>
              Within {Math.round(distanceToPlant ?? 0)} m of{' '}
              {selectedTarget.plant.scientificName || 'target specimen'}.
            </Text>
          </View>
        )}

        {/* Distance & Live Compass Arrow */}
        {selectedTarget && (
          <View style={styles.telemetryCard}>
            <View style={styles.telemetryCol}>
              <Text style={styles.telemetryLabel}>DISTANCE TO PLANT</Text>
              <Text style={styles.telemetryValue}>
                {distanceToPlant !== null
                  ? formatDistanceDisplay(distanceToPlant)
                  : '--'}
              </Text>
            </View>

            <View style={styles.telemetryDivider} />

            <View style={styles.telemetryCol}>
              <Text style={styles.telemetryLabel}>
                {headingDegrees !== null ? 'FOLLOW ARROW' : 'BEARING'}
              </Text>
              {bearingToPlant !== null ? (
                <View style={styles.compassRow}>
                  <View
                    style={[
                      styles.arrowCircle,
                      { transform: [{ rotate: `${arrowRotationDeg}deg` }] },
                    ]}
                  >
                    <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
                  </View>
                  <Text style={styles.telemetryValue}>
                    {bearingToCardinal(bearingToPlant)} ·{' '}
                    {Math.round(bearingToPlant)}°
                  </Text>
                </View>
              ) : (
                <Text style={styles.telemetryValue}>--</Text>
              )}
            </View>
          </View>
        )}

        {/* Phone GPS Status */}
        <View style={styles.gpsCard}>
          <View style={styles.gpsTopRow}>
            <Ionicons name="phone-portrait-outline" size={17} color="#213B2A" />
            <Text style={styles.gpsHeading}>YOUR PHONE GPS</Text>
            {currentPoint && (
              <Text style={styles.accuracyPill}>
                {describeAccuracy(currentPoint.accuracy)}
              </Text>
            )}
          </View>

          {acquiringFix && !currentPoint ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#213B2A" />
              <Text style={styles.gpsSubText}>Locating your phone...</Text>
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
                  ? `GPS accuracy ±${Math.round(currentPoint.accuracy)} m`
                  : 'Accuracy not reported'}
              </Text>
            </>
          ) : (
            <Text style={styles.gpsSubText}>Waiting for phone GPS fix...</Text>
          )}

          {gpsWarning !== '' && (
            <Text style={styles.warningText}>{gpsWarning}</Text>
          )}
        </View>

        {/* External Google Maps Option */}
        {selectedTarget && (
          <TouchableOpacity
            style={styles.externalMapsBtn}
            onPress={handleOpenGoogleMaps}
            activeOpacity={0.85}
          >
            <Ionicons name="map-outline" size={18} color="#213B2A" />
            <Text style={styles.externalMapsBtnText}>
              Open walking directions in Google Maps
            </Text>
          </TouchableOpacity>
        )}
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
  noCoordsBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F59E0B',
    padding: 14,
    marginBottom: 14,
  },
  noCoordsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  noCoordsTitle: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '800',
    color: '#92400E',
  },
  noCoordsBody: {
    fontSize: 12.5,
    color: '#78350F',
    lineHeight: 18,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#7D8C81',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  changeLink: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#2D6A4F',
    marginBottom: 8,
  },
  targetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.4,
    borderColor: '#213B2A',
    padding: 14,
    marginBottom: 16,
  },
  plantBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  targetTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E2B22',
  },
  targetSub: {
    fontSize: 12.5,
    color: '#526659',
    marginTop: 2,
  },
  targetCoords: {
    fontSize: 11.5,
    color: '#68776D',
    marginTop: 2,
  },
  pickerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 14,
    marginBottom: 16,
  },
  searchInput: {
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
  emptyText: {
    fontSize: 13,
    color: '#68776D',
    textAlign: 'center',
    paddingVertical: 14,
  },
  plantList: {
    gap: 8,
  },
  plantOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F9FBF9',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E6ECE8',
    padding: 12,
  },
  plantOptionName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E2B22',
  },
  plantOptionMeta: {
    fontSize: 12,
    color: '#68776D',
    marginTop: 2,
  },
  distBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  distBadgeText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#215A36',
  },
  mapCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    overflow: 'hidden',
    marginBottom: 14,
  },
  mapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6ECE8',
  },
  mapTitle: {
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
  arrivalBanner: {
    backgroundColor: '#E8F5E9',
    borderRadius: 16,
    borderWidth: 1.4,
    borderColor: '#16A34A',
    padding: 14,
    marginBottom: 14,
  },
  arrivalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  arrivalTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#14532D',
  },
  arrivalSub: {
    fontSize: 12.5,
    color: '#166534',
    marginTop: 4,
  },
  telemetryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    paddingVertical: 16,
    marginBottom: 14,
  },
  telemetryCol: {
    flex: 1,
    alignItems: 'center',
  },
  telemetryDivider: {
    width: 1,
    height: 38,
    backgroundColor: '#E6ECE8',
  },
  telemetryLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#7D8C81',
    letterSpacing: 0.7,
    marginBottom: 6,
  },
  telemetryValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E2B22',
  },
  compassRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  arrowCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gpsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 16,
    marginBottom: 14,
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
  externalMapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.4,
    borderColor: '#213B2A',
    backgroundColor: '#FFFFFF',
  },
  externalMapsBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#213B2A',
  },
});