import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';

import { useStaffOnly } from '../src/context/AuthRoleContext';
import { useProfileStore } from '../src/store/useProfileStore';
import {
  pickImageFromLibrary,
  takePhotoWithCamera,
  type PickImageResult,
} from '../src/utils/imagePicker';
import {
  savePhotoPermanently,
  deleteStoredPhoto,
} from '../src/utils/photoStorage';
import {
  IdentificationStatus,
  RecordStatus,
  ReviewStatus,
  SyncStatus,
  useRecordStore,
  type HealthStatus,
  type LifeStage,
  type ObservationVisit,
  type PlantPhotoType,
  type PlantRecord,
  type PhotoUpload,
} from '../src/store/useRecordStore';
import { useSpeciesStore } from '../src/store/useSpeciesStore';
import {
  identifyPlant,
  IdentifyNetworkError,
  type SpeciesSuggestion,
} from '../src/services/identifyPlant';
import {
  formatCoordinates,
  describeAccuracy,
} from '../src/utils/formatCoordinates';

import FormScrollView from '../src/components/FormScrollView';
import KeyboardDoneBar from '../src/components/KeyboardDoneBar';
import SpeciesPicker, { type SpeciesChoice } from '../src/components/SpeciesPicker';
import { checkDiameterCm, checkHeightMetres, metresToCm } from '../src/utils/units';

const DONE_BAR_ID = 'new-record-done';
const GPS_TIMEOUT_MS = 20_000;
const DEFAULT_PHOTO_TYPES: PlantPhotoType[] = ['whole_plant', 'leaf', 'flower', 'bark'];

const LIFE_STAGES: LifeStage[] = ['Seedling', 'Sapling', 'Pole', 'Mature', 'Senescent'];
const HEALTH_STATUSES: { label: HealthStatus; color: string; bg: string; border: string }[] = [
  { label: 'Healthy', color: '#2D6A4F', bg: '#E8F5E9', border: '#A3D9A5' },
  { label: 'Stressed', color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
  { label: 'Diseased', color: '#DC2626', bg: '#FEE2E2', border: '#FCA5A5' },
  { label: 'Damaged', color: '#7C3AED', bg: '#F3E8FF', border: '#D8B4FE' },
  { label: 'Dead', color: '#4B5563', bg: '#F3F4F6', border: '#D1D5DB' },
];

interface OfflinePlantPhotoEntry {
  id: string;
  uri: string;
  photoType: PlantPhotoType;
  syncStatus: SyncStatus;
  serverId?: string;
  lastError?: string;
}

type PlantRecordWithOfflinePhotos = PlantRecord & {
  photoEntries?: OfflinePlantPhotoEntry[];
  diameter?: string;
};

function initialPhotos(record: PlantRecord | undefined): ImagePicker.ImagePickerAsset[] {
  if (!record) return [];
  const toAsset = (uri: string) => ({ uri, width: 0, height: 0 } as ImagePicker.ImagePickerAsset);
  const offline = record as PlantRecordWithOfflinePhotos;
  if (offline.photoEntries?.length) return offline.photoEntries.map((p) => toAsset(p.uri));
  if (record.photoUris?.length) return record.photoUris.map(toAsset);
  return [];
}

function formatRouteDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatRouteDuration(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

interface GpsFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}

type GpsStatus = 'acquiring' | 'ready' | 'unavailable' | 'timeout';
type FieldErrors = Partial<Record<'photos' | 'scientificName' | 'locationName' | 'gps' | 'height' | 'diameter', string>>;

export default function NewRecordScreen() {
  const router = useRouter();
  const blocked = useStaffOnly();
  const me = useProfileStore((state) => state.me);
  const {
    editId,
    speciesId: preselectedSpeciesId,
    latitude: paramLatitude,
    longitude: paramLongitude,
    accuracy: paramAccuracy,
    routeId: paramRouteId,
    distanceMeters: paramDistanceMeters,
    durationSeconds: paramDurationSeconds,
  } = useLocalSearchParams<{
    editId?: string;
    speciesId?: string;
    latitude?: string;
    longitude?: string;
    accuracy?: string;
    routeId?: string;
    distanceMeters?: string;
    durationSeconds?: string;
  }>();

  const parsedLat = paramLatitude !== undefined ? Number(paramLatitude) : NaN;
  const parsedLng = paramLongitude !== undefined ? Number(paramLongitude) : NaN;
  const parsedAcc =
    paramAccuracy !== undefined && paramAccuracy !== ''
      ? Number(paramAccuracy)
      : null;
  const hasParamGps = Number.isFinite(parsedLat) && Number.isFinite(parsedLng);

  const parsedDistanceM =
    paramDistanceMeters !== undefined && paramDistanceMeters !== ''
      ? Number(paramDistanceMeters)
      : NaN;
  const parsedDurationSec =
    paramDurationSeconds !== undefined && paramDurationSeconds !== ''
      ? Number(paramDurationSeconds)
      : NaN;
  const hasAttachedRoute = Boolean(paramRouteId) || Number.isFinite(parsedDistanceM);

  const existingRecord = useRecordStore((state) =>
    editId ? state.records.find((r) => r.id === editId) : undefined
  );
  const addRecord = useRecordStore((state) => state.addRecord);
  const updateRecord = useRecordStore((state) => state.updateRecord);
  const syncRecord = useRecordStore((state) => state.syncRecord);
  const linkRouteToPlant = useRecordStore((state) => state.linkRouteToPlant);
  const allSpecies = useSpeciesStore((state) => state.species);

  const isEditing = Boolean(existingRecord);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>(() => initialPhotos(existingRecord));
  const [speciesChoice, setSpeciesChoice] = useState<SpeciesChoice>(null);
  const [speciesQuery, setSpeciesQuery] = useState(existingRecord?.scientificName ?? '');
  const [speciesNotice, setSpeciesNotice] = useState('');
  const [height, setHeight] = useState(existingRecord?.height ?? '');
  const [diameter, setDiameter] = useState((existingRecord as PlantRecordWithOfflinePhotos)?.diameter ?? '');
  const [lifeStage, setLifeStage] = useState<LifeStage>(existingRecord?.observations?.[0]?.stage ?? 'Mature');
  const [healthStatus, setHealthStatus] = useState<HealthStatus>(existingRecord?.observations?.[0]?.health ?? 'Healthy');
  const [morphology, setMorphology] = useState(existingRecord?.morphology ?? '');
  const [locationName, setLocationName] = useState(existingRecord?.locationName ?? '');

  const initialGpsFix: GpsFix | null =
    existingRecord?.latitude !== undefined && existingRecord?.longitude !== undefined
      ? {
          latitude: existingRecord.latitude,
          longitude: existingRecord.longitude,
          accuracyM: existingRecord.gpsAccuracyM ?? null,
        }
      : hasParamGps
      ? {
          latitude: parsedLat,
          longitude: parsedLng,
          accuracyM: parsedAcc !== null && Number.isFinite(parsedAcc) ? parsedAcc : null,
        }
      : null;

  const [gpsFix, setGpsFix] = useState<GpsFix | null>(initialGpsFix);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>(initialGpsFix ? 'ready' : 'acquiring');
  const [gpsError, setGpsError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const screenActive = useRef(true);
  const gpsRequestId = useRef(0);
  const identifyRequest = useRef<AbortController | null>(null);
  const speciesSelectionInitialized = useRef(false);
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([]);
  const [selectedSpecies, setSelectedSpecies] = useState<SpeciesSuggestion | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identifyMessage, setIdentifyMessage] = useState('');

  const identifyPhoto = photos[0] ?? null;
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const recordSaved = useRef(false);
  const originalPhotoUris = useRef(new Set(existingRecord?.photoUris ?? []));

  const approvedSpecies = speciesChoice?.kind === 'species' ? speciesChoice.species : null;

  const clearError = (field: keyof FieldErrors) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  useEffect(() => {
    screenActive.current = true;
    if (!gpsFix) void fetchLocation();

    return () => {
      screenActive.current = false;
      identifyRequest.current?.abort();
      identifyRequest.current = null;
      if (!recordSaved.current) {
        photosRef.current.forEach((asset) => {
          if (asset?.uri && !originalPhotoUris.current.has(asset.uri)) {
            void deleteStoredPhoto(asset.uri);
          }
        });
      }
    };
  }, []);

  useEffect(() => {
    if (speciesSelectionInitialized.current) return;

    if (existingRecord) {
      if (allSpecies.length === 0) return;

      const match = allSpecies.find(
        (species) =>
          species.id === existingRecord.speciesId ||
          species.scientific_name.trim().toLowerCase() === existingRecord.scientificName.trim().toLowerCase()
      );

      if (match) {
        setSpeciesChoice({ kind: 'species', species: match });
        setSpeciesQuery(match.scientific_name);
      }

      speciesSelectionInitialized.current = true;
      return;
    }

    if (!preselectedSpeciesId) {
      speciesSelectionInitialized.current = true;
      return;
    }
    if (allSpecies.length === 0) return;

    const match = allSpecies.find((species) => species.id === preselectedSpeciesId);
    if (match) {
      setSpeciesChoice({ kind: 'species', species: match });
      setSpeciesQuery(match.scientific_name);
    }

    speciesSelectionInitialized.current = true;
  }, [allSpecies, existingRecord, preselectedSpeciesId]);

  const fetchLocation = async () => {
    const requestId = ++gpsRequestId.current;
    const isCurrent = () => screenActive.current && requestId === gpsRequestId.current;

    const setUnavailable = (reason: string) => {
      if (!isCurrent()) return;
      setGpsFix(null);
      setGpsError(reason);
      setGpsStatus('unavailable');
    };

    setGpsStatus('acquiring');
    setGpsError('');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setUnavailable('Location permission is off for this app.');

      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) return setUnavailable('Location services are turned off on this device.');

      const locationPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('GPS_TIMEOUT')), GPS_TIMEOUT_MS)
      );

      const location = await Promise.race([locationPromise, timeoutPromise]);
      if (!isCurrent()) return;

      setGpsFix({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracyM: location.coords.accuracy ?? null,
      });
      setGpsStatus('ready');
      clearError('gps');
    } catch (err: any) {
      if (!isCurrent()) return;
      if (err?.message === 'GPS_TIMEOUT') {
        setGpsFix(null);
        setGpsStatus('timeout');
      } else {
        setUnavailable('Could not get a GPS fix.');
      }
    }
  };

  const handlePickResult = async (result: PickImageResult) => {
    if (result.status === 'picked') {
      try {
        const permanentUri = await savePhotoPermanently(result.asset.uri);
        if (!screenActive.current) return void deleteStoredPhoto(permanentUri);

        setPhotos((prev) => (prev.length >= 4 ? prev : [...prev, { ...result.asset, uri: permanentUri }]));
        clearError('photos');
      } catch {
        Toast.show({ type: 'error', text1: 'Photo not saved', text2: 'Could not store image locally.' });
      }
    } else if (result.status === 'permission-denied') {
      Toast.show({ type: 'error', text1: 'Permission needed', text2: 'Allow camera/photo access in Settings.' });
    }
  };

  const handleAddPhoto = () => {
    if (photos.length >= 4) {
      Toast.show({ type: 'info', text1: 'Limit reached', text2: 'Maximum 4 photos allowed.' });
      return;
    }
    Alert.alert('Attach Plant Photo', 'Select image source', [
      { text: 'Take Photo', onPress: async () => handlePickResult(await takePhotoWithCamera()) },
      { text: 'Choose from Gallery', onPress: async () => handlePickResult(await pickImageFromLibrary()) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const removePhoto = (index: number) => {
    const p = photos[index];
    if (p && !originalPhotoUris.current.has(p.uri)) void deleteStoredPhoto(p.uri);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleIdentify = async () => {
    if (!identifyPhoto || identifying) return;
    const req = new AbortController();
    identifyRequest.current = req;
    setIdentifying(true);
    setIdentifyMessage('');
    setSuggestions([]);
    setSelectedSpecies(null);

    try {
      const next = await identifyPlant(identifyPhoto, req.signal);
      if (req.signal.aborted) return;
      setSuggestions(next);
      if (next.length === 0) {
        setIdentifyMessage('No species match found. Search the offline catalogue or save the record for later.');
      }
    } catch (err) {
      if (req.signal.aborted) return;
      setIdentifyMessage(
        err instanceof IdentifyNetworkError
          ? "Can't reach the AI server. Search the offline catalogue or save the record for later."
          : 'Identification failed. Search the offline catalogue or save the record for later.'
      );
    } finally {
      if (identifyRequest.current === req) {
        identifyRequest.current = null;
        setIdentifying(false);
      }
    }
  };

  const selectSuggestion = (s: SpeciesSuggestion) => {
    setSelectedSpecies(s);
    const catalogueMatch = allSpecies.find(
      (species) =>
        species.scientific_name.trim().toLowerCase() === s.scientificName.trim().toLowerCase()
    );

    setSpeciesQuery(s.scientificName);

    if (catalogueMatch) {
      setSpeciesChoice({ kind: 'species', species: catalogueMatch });
      setSpeciesNotice('AI suggestion matched an approved species in the offline catalogue.');
    } else {
      setSpeciesChoice(null);
      setSpeciesNotice(
        'This AI suggestion is not in the approved catalogue. Save for later, then confirm the species before submitting.'
      );
    }

    clearError('scientificName');
  };

  const handleSpeciesChange = (choice: SpeciesChoice) => {
    setSpeciesChoice(choice);
    setSelectedSpecies(null);
    setSpeciesNotice('');
    clearError('scientificName');

    if (choice?.kind === 'species') {
      setSpeciesQuery(choice.species.scientific_name);
    } else {
      setSpeciesQuery('');
    }
  };

  const handleSave = async (submitForReview: boolean) => {
    const offlineRecord = existingRecord as PlantRecordWithOfflinePhotos | undefined;
    const photoMeta: Record<string, PhotoUpload> = {};
    const photoEntries: OfflinePlantPhotoEntry[] = [];

    photos.forEach((asset, idx) => {
      const uri = asset.uri;
      const photoType = DEFAULT_PHOTO_TYPES[idx] || 'whole_plant';
      const prev = offlineRecord?.photoEntries?.find((p) => p.uri === uri);
      const prevMeta = existingRecord?.photoMeta?.[uri];
      const photoId = prev?.id ?? prevMeta?.id ?? randomUUID();

      let status = prev?.syncStatus ?? (
        prevMeta?.uploaded
          ? SyncStatus.UPLOADED
          : submitForReview
          ? SyncStatus.NOT_UPLOADED
          : SyncStatus.LOCAL_ONLY
      );
      if (submitForReview && status === SyncStatus.LOCAL_ONLY) status = SyncStatus.NOT_UPLOADED;

      photoEntries.push({ id: photoId, uri, photoType, syncStatus: status, serverId: prev?.serverId, lastError: prev?.lastError });
      photoMeta[uri] = { ...(prevMeta?.type === photoType ? prevMeta : {}), id: photoId, type: photoType, uploaded: status === SyncStatus.UPLOADED };
    });

    const photoList = photoEntries.map((p) => p.uri);
    const nextErrors: FieldErrors = {};
    if (!photoList.length) nextErrors.photos = 'Add at least one photo (min. 1, max. 4).';
    if (submitForReview && !approvedSpecies) {
      nextErrors.scientificName = 'Select an approved species before submitting. You can save for later without one.';
    }
    if (!locationName.trim()) nextErrors.locationName = 'Enter a location landmark.';
    if (!gpsFix) nextErrors.gps = 'A GPS fix is required. Wait for it, or tap Retry.';
    // Measurements are optional here, but when typed they must pass the same checks as
    // Add Observation: height 0.01-100 m, diameter 0.1-500 cm.
    const heightCheck = height.trim() ? checkHeightMetres(height) : null;
    const diameterCheck = diameter.trim() ? checkDiameterCm(diameter) : null;
    if (heightCheck && !heightCheck.ok) nextErrors.height = heightCheck.message;
    if (diameterCheck && !diameterCheck.ok) nextErrors.diameter = diameterCheck.message;

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !gpsFix) return;

    // Typed: height in metres, diameter in cm. Stored: both in cm (observations.height_cm).
    const heightMetres = heightCheck?.ok ? heightCheck.value : undefined;
    const diameterCm = diameterCheck?.ok ? diameterCheck.value : undefined;

    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const formattedTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const previousInitialVisit = existingRecord?.observations?.[0];
    const initialVisit: ObservationVisit = {
      ...previousInitialVisit,
      id: previousInitialVisit?.id || randomUUID(),
      date: previousInitialVisit?.date || `${formattedDate} · ${formattedTime}`,
      observedAt: previousInitialVisit?.observedAt || now.toISOString(),
      recordedBy: me?.full_name || me?.email || 'Field Staff',
      health: healthStatus,
      stage: lifeStage,
      heightCm: heightMetres === undefined ? undefined : metresToCm(heightMetres),
      diameterCm,
      measurement: `Height ${heightMetres ?? '-'} m · Diameter ${diameterCm ?? '-'} cm`,
      notes: morphology.trim() || 'Initial registration record.',
      photoUris: photoList,
      syncStatus: submitForReview ? SyncStatus.NOT_UPLOADED : SyncStatus.LOCAL_ONLY,
      reviewStatus: ReviewStatus.DRAFT,
      reviewComment: null,
      submissionRequested: submitForReview,
      submittedForReview: false,
    };

    const routeLength = Number.isFinite(parsedDistanceM)
      ? formatRouteDistance(parsedDistanceM)
      : existingRecord?.routeLength;
    const walkingTime = Number.isFinite(parsedDurationSec)
      ? formatRouteDuration(parsedDurationSec)
      : existingRecord?.walkingTime;

    const recordData = {
      scientificName: approvedSpecies?.scientific_name ?? '',
      speciesId: approvedSpecies?.id ?? null,
      commonName: approvedSpecies?.common_name ?? '',
      family: approvedSpecies?.taxonomy?.family ?? '',
      height: heightMetres === undefined ? undefined : String(heightMetres),
      diameter: diameterCm === undefined ? undefined : String(diameterCm),
      morphology: morphology.trim() || undefined,
      locationName: locationName.trim(),
      latitude: gpsFix.latitude,
      longitude: gpsFix.longitude,
      gpsAccuracyM: gpsFix.accuracyM,
      gpsCoordination: formatCoordinates(gpsFix.latitude, gpsFix.longitude, gpsFix.accuracyM),
      routeLength,
      walkingTime,
      photoUris: photoList,
      photoMeta,
      photoEntries,
      observations: existingRecord?.observations?.length
        ? [initialVisit, ...existingRecord.observations.slice(1)]
        : [initialVisit],
      recordStatus: submitForReview ? RecordStatus.COMPLETE : RecordStatus.DRAFT,
      identificationStatus: approvedSpecies ? IdentificationStatus.IDENTIFIED : IdentificationStatus.PENDING,
      syncStatus: submitForReview ? SyncStatus.NOT_UPLOADED : SyncStatus.LOCAL_ONLY,
      reviewStatus: submitForReview ? ReviewStatus.PENDING : ReviewStatus.DRAFT,
    };

    const saved = existingRecord
      ? await updateRecord(existingRecord.id, recordData)
      : await addRecord(recordData);

    if (!saved) {
      Toast.show({ type: 'error', text1: 'Record not updated', text2: 'Only local drafts can be edited.' });
      return;
    }

    if (paramRouteId) {
      await linkRouteToPlant(paramRouteId, saved.id);
    }

    if (existingRecord) {
      originalPhotoUris.current.forEach((uri) => {
        if (!photoList.includes(uri)) void deleteStoredPhoto(uri);
      });
    }

    recordSaved.current = true;
    Toast.show({
      type: 'success',
      text1: submitForReview ? 'Submitted for review' : 'Draft saved',
      text2: submitForReview ? 'Queued for officer review.' : 'Saved safely on this device.',
    });

    router.replace({ pathname: '/save-confirm', params: { id: saved.id } } as any);

    if (saved.syncStatus === SyncStatus.NOT_UPLOADED) {
      void syncRecord(saved.id).then((result) => {
        if (!result.ok) {
          Toast.show({
            type: 'info',
            text1: 'Saved on this device',
            text2: `Upload pending: ${result.reason}`,
          });
        }
      });
    }
  };

  if (blocked) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.navRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navSide}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back-outline" size={28} color="#213B2A" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>{isEditing ? 'Edit plant record' : 'Register plant'}</Text>
        <View style={styles.navSide} />
      </View>

      <FormScrollView contentContainerStyle={styles.scrollContent}>
        {/* Section 1: Photos */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>PHOTOS *</Text>
          <Text style={styles.sectionSubLabel}>{photos.length}/4 (min. 1 required)</Text>
        </View>

        {photos.length > 0 && (
          <View style={styles.thumbnailGrid}>
            {photos.map((asset, idx) => (
              <View key={`${asset.uri}-${idx}`} style={styles.thumbnailWrapper}>
                <Image source={{ uri: asset.uri }} style={styles.thumbnail} />
                <TouchableOpacity
                  style={styles.removePhotoBtn}
                  onPress={() => removePhoto(idx)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${idx + 1}`}
                >
                  <Ionicons name="close-outline" size={15} color="#FFFFFF" />
                </TouchableOpacity>
                <View style={styles.photoBadge}>
                  <Text style={styles.photoBadgeText}>#{idx + 1}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {photos.length < 4 && (
          <TouchableOpacity
            style={styles.pillUploadBtn}
            onPress={handleAddPhoto}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={photos.length === 0 ? 'Add plant photo' : 'Add another photo'}
          >
            <View style={styles.pillUploadContent}>
              <Ionicons name={photos.length === 0 ? 'camera-outline' : 'add-outline'} size={20} color="#213B2A" />
              <Text style={styles.pillUploadBtnText}>
                {photos.length === 0 ? 'Add plant photo' : 'Add another photo'}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        {errors.photos && <Text style={styles.errorText}>{errors.photos}</Text>}

        {/* AI Species Identification */}
        {identifyPhoto && (
          <View style={styles.aiSection}>
            <TouchableOpacity
              style={[styles.identifyBtn, identifying && styles.disabledBtn]}
              activeOpacity={0.85}
              onPress={() => void handleIdentify()}
              disabled={identifying}
              accessibilityRole="button"
              accessibilityLabel="Identify species with AI"
            >
              {identifying ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text style={styles.identifyBtnText}>Analysing photo...</Text>
                </View>
              ) : (
                <View style={styles.identifyContentRow}>
                  <Ionicons name="sparkles-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.identifyBtnText}>Identify species with AI</Text>
                </View>
              )}
            </TouchableOpacity>
            <Text style={styles.aiHint}>Uses your primary photo (#{1}) · internet required</Text>
            {identifyMessage !== '' && <Text style={styles.identifyMessage}>{identifyMessage}</Text>}

            {suggestions.length > 0 && (
              <View style={styles.suggestionsBlock}>
                <Text style={styles.suggestionsTitle}>AI species suggestions</Text>
                <Text style={styles.suggestionsHelp}>
                  Select a suggestion. Only a match in the approved catalogue can be submitted.
                </Text>
                {suggestions.map((s) => {
                  const selected = selectedSpecies?.rank === s.rank && selectedSpecies.scientificName === s.scientificName;
                  return (
                    <TouchableOpacity
                      key={`${s.rank}-${s.scientificName}`}
                      style={[styles.suggestionCard, selected && styles.selectedSuggestionCard]}
                      onPress={() => selectSuggestion(s)}
                    >
                      <View style={styles.suggestionHeader}>
                        <Text style={styles.suggestionName}>{s.rank}. {s.scientificName}</Text>
                        <Text style={styles.confidence}>{s.confidence.toFixed(1)}%</Text>
                      </View>
                      {s.commonName && (
                        <Text style={styles.suggestionDetail}>
                          Common: {s.commonName}
                        </Text>
                      )}

                      {s.family && (
                        <Text style={styles.suggestionDetail}>
                          Family: {s.family}
                        </Text>
                      )}

                      <Text style={styles.suggestionDetail}>
                        Confidence: {s.confidenceLevel}
                        {selected ? ' · Selected' : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Section 2: Approved species selection */}
        <Text style={styles.sectionLabel}>SPECIES DETAILS</Text>
        <Text style={styles.fieldLabel}>Approved species</Text>
        <Text style={styles.pickerHelp}>
          Search the offline species catalogue. If you cannot confirm the species in the field, save the record for later.
        </Text>
        <SpeciesPicker
          value={speciesChoice}
          onChange={handleSpeciesChange}
          query={speciesQuery}
          onQueryChange={(text) => {
            setSpeciesQuery(text);
            setSpeciesNotice('');
            clearError('scientificName');
          }}
          hasError={Boolean(errors.scientificName)}
        />
        {errors.scientificName && <Text style={styles.errorText}>{errors.scientificName}</Text>}
        {speciesNotice !== '' && <Text style={styles.speciesNotice}>{speciesNotice}</Text>}

        {/* Section 3: Measurements */}
        <View style={styles.measurementRow}>
          <View style={styles.halfCol}>
            <Text style={styles.fieldLabel}>Height (m)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2.0"
              placeholderTextColor="#8C9A91"
              keyboardType="decimal-pad"
              value={height}
              onChangeText={(text) => {
                setHeight(text);
                clearError('height');
              }}
              inputAccessoryViewID={DONE_BAR_ID}
            />
            {errors.height && <Text style={styles.errorText}>{errors.height}</Text>}
          </View>
          <View style={styles.halfCol}>
            <Text style={styles.fieldLabel}>Diameter (cm)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 40"
              placeholderTextColor="#8C9A91"
              keyboardType="decimal-pad"
              value={diameter}
              onChangeText={(text) => {
                setDiameter(text);
                clearError('diameter');
              }}
              inputAccessoryViewID={DONE_BAR_ID}
            />
            {errors.diameter && <Text style={styles.errorText}>{errors.diameter}</Text>}
          </View>
        </View>

        {/* Section 4: Observation Condition */}
        <Text style={styles.fieldLabel}>Life Stage</Text>
        <View style={styles.chipGrid}>
          {LIFE_STAGES.map((stage) => {
            const selected = lifeStage === stage;
            return (
              <TouchableOpacity
                key={stage}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setLifeStage(stage)}
              >
                <View style={styles.chipContent}>
                  {selected && <Ionicons name="checkmark-outline" size={14} color="#FFFFFF" style={styles.chipIcon} />}
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{stage}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Health Status</Text>
        <View style={styles.chipGrid}>
          {HEALTH_STATUSES.map((item) => {
            const selected = healthStatus === item.label;
            return (
              <TouchableOpacity
                key={item.label}
                style={[
                  styles.healthChip,
                  { backgroundColor: item.bg, borderColor: item.border },
                  selected && { borderColor: item.color, borderWidth: 2 },
                ]}
                onPress={() => setHealthStatus(item.label)}
              >
                <View style={[styles.statusDot, { backgroundColor: item.color }]} />
                <Text style={[styles.healthChipText, { color: item.color }]}>{item.label}</Text>
                {selected && <Ionicons name="checkmark-outline" size={14} color={item.color} style={{ marginLeft: 4 }} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Field notes</Text>
        <TextInput
          style={[styles.input, { height: 76, textAlignVertical: 'top' }]}
          placeholder="e.g. 3 pitchers, lower leaves damaged, growing on limestone"
          placeholderTextColor="#8C9A91"
          multiline
          value={morphology}
          onChangeText={setMorphology}
          inputAccessoryViewID={DONE_BAR_ID}
        />

        {/* Section 5: Location & Unified GPS Card */}
        <Text style={[styles.sectionLabel, { marginTop: 18 }]}>LOCATION</Text>
        <Text style={styles.fieldLabel}>Location landmark *</Text>
        <TextInput
          style={[styles.input, errors.locationName && styles.inputError]}
          placeholder="e.g. left of boardwalk, 50 m past cave entrance"
          placeholderTextColor="#8C9A91"
          value={locationName}
          onChangeText={(v) => {
            setLocationName(v);
            clearError('locationName');
          }}
          returnKeyType="done"
        />
        {errors.locationName && <Text style={styles.errorText}>{errors.locationName}</Text>}

        <Text style={styles.fieldLabel}>GPS coordinates *</Text>
        <View style={[styles.gpsCard, (gpsStatus === 'timeout' || gpsStatus === 'unavailable') && styles.gpsCardError]}>
          {hasAttachedRoute && (
            <View style={styles.routeAttachedPill}>
              <Ionicons name="navigate-outline" size={14} color="#2D6A4F" />
              <Text style={styles.routeAttachedText}>
                Transect attached
                {Number.isFinite(parsedDistanceM)
                  ? ` · ${formatRouteDistance(parsedDistanceM)}`
                  : ''}
                {Number.isFinite(parsedDurationSec)
                  ? ` · ${formatRouteDuration(parsedDurationSec)}`
                  : ''}
              </Text>
            </View>
          )}

          {gpsStatus === 'acquiring' && (
            <>
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#213B2A" />
                <Text style={styles.gpsStatusPending}>Acquiring GPS fix...</Text>
              </View>
              <Text style={styles.gpsDetails}>Takes longer under dense canopy. Gives up after 20 seconds.</Text>
            </>
          )}

          {gpsStatus === 'ready' && gpsFix && (
            <>
              <View style={styles.gpsHeaderRow}>
                <Ionicons name="location-outline" size={18} color="#215A36" />
                <Text style={styles.gpsStatusBadge}>{describeAccuracy(gpsFix.accuracyM)}</Text>
              </View>
              <Text style={styles.gpsCoords}>{formatCoordinates(gpsFix.latitude, gpsFix.longitude, null)}</Text>
              <Text style={styles.gpsDetails}>
                {gpsFix.accuracyM === null ? 'Accuracy not reported' : `Accuracy ±${Math.round(gpsFix.accuracyM)} m`}
              </Text>
            </>
          )}

          {(gpsStatus === 'timeout' || gpsStatus === 'unavailable') && (
            <>
              <View style={styles.gpsHeaderRow}>
                <Ionicons name="location-outline" size={18} color="#9B1C1C" />
                <Text style={styles.gpsStatusError}>
                  {gpsStatus === 'timeout' ? 'GPS timed out – step into an open area' : 'GPS unavailable'}
                </Text>
              </View>
              <Text style={styles.gpsDetails}>{gpsError || 'No fix obtained. Move away from rock walls and retry.'}</Text>
            </>
          )}

          <TouchableOpacity
            style={styles.refreshGpsBtn}
            onPress={() => void fetchLocation()}
            accessibilityRole="button"
            accessibilityLabel="Refresh GPS location"
          >
            <View style={styles.refreshContent}>
              <Ionicons name="refresh-outline" size={14} color="#213B2A" />
              <Text style={styles.refreshGpsBtnText}>
                {gpsStatus === 'ready' ? 'Update location' : 'Retry'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {errors.gps && !gpsFix && <Text style={[styles.errorText, styles.gpsErrorText]}>{errors.gps}</Text>}
        {Object.values(errors).some(Boolean) && (
          <Text style={styles.errorSummary}>Fix the highlighted fields above to save.</Text>
        )}

        {/* Section 6: Action Buttons */}
        <View style={styles.bottomActionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.saveDraftBtn]}
            activeOpacity={0.85}
            onPress={() => void handleSave(false)}
            accessibilityRole="button"
            accessibilityLabel="Save plant record locally as draft"
          >
            <Text style={styles.saveDraftBtnText}>Save for later</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.saveSubmitBtn]}
            activeOpacity={0.85}
            onPress={() => void handleSave(true)}
            accessibilityRole="button"
            accessibilityLabel="Save and submit plant record for officer review"
          >
            <Text style={styles.saveSubmitBtnText}>Save and submit</Text>
          </TouchableOpacity>
        </View>
      </FormScrollView>

      <KeyboardDoneBar nativeID={DONE_BAR_ID} />
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
  navTitle: { fontSize: 17, fontWeight: '700', color: '#1E2B22' },
  navSide: { width: 40, justifyContent: 'center' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  sectionLabel: { fontSize: 11.5, fontWeight: '800', color: '#7D8C81', letterSpacing: 0.8, marginTop: 14, marginBottom: 8 },
  sectionSubLabel: { fontSize: 11.5, color: '#88988D' },
  thumbnailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  thumbnailWrapper: { width: 74, height: 74, borderRadius: 12, position: 'relative' },
  thumbnail: { width: '100%', height: '100%', borderRadius: 12 },
  removePhotoBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#DC2626',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoBadge: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  photoBadgeText: { color: '#FFF', fontSize: 9, fontWeight: '700' },
  pillUploadBtn: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1.2,
    borderColor: '#213B2A',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 10,
  },
  pillUploadContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillUploadBtnText: { fontSize: 14, fontWeight: '700', color: '#213B2A' },
  measurementRow: { flexDirection: 'row', gap: 12 },
  halfCol: { flex: 1 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#F0F4F1',
    borderWidth: 1,
    borderColor: '#DFE7E1',
  },
  chipSelected: { backgroundColor: '#213B2A', borderColor: '#213B2A' },
  chipContent: { flexDirection: 'row', alignItems: 'center' },
  chipIcon: { marginRight: 4 },
  chipText: { fontSize: 13, fontWeight: '600', color: '#49594D' },
  chipTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  healthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  healthChipText: { fontSize: 12.5, fontWeight: '700' },
  aiSection: { marginBottom: 16 },
  identifyBtn: {
    backgroundColor: '#46654F',
    minHeight: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  disabledBtn: { opacity: 0.65 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  identifyContentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  identifyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  aiHint: { fontSize: 11.5, color: '#7E8F83', marginTop: 6, textAlign: 'center' },
  identifyMessage: { fontSize: 12.5, color: '#7A5134', lineHeight: 18, marginTop: 10, paddingHorizontal: 4 },
  suggestionsBlock: { marginTop: 12 },
  suggestionsTitle: { fontSize: 14, fontWeight: '700', color: '#213B2A', marginBottom: 2 },
  suggestionsHelp: { fontSize: 11.5, color: '#68776D', marginBottom: 8 },
  suggestionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 14,
    marginBottom: 8,
  },
  selectedSuggestionCard: { backgroundColor: '#EEF5F0', borderColor: '#213B2A', borderWidth: 2 },
  suggestionHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  suggestionName: { flex: 1, fontSize: 14, fontWeight: '700', color: '#213B2A' },
  confidence: { fontWeight: '700', color: '#46654F' },
  suggestionDetail: { fontSize: 12, color: '#68776D', marginTop: 3 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: '#213B2A', marginBottom: 6, marginTop: 6 },
  pickerHelp: { fontSize: 12, color: '#68776D', lineHeight: 17, marginBottom: 8 },
  speciesNotice: { fontSize: 12, color: '#46654F', lineHeight: 17, marginBottom: 10, paddingHorizontal: 4 },
  input: {
    backgroundColor: '#FFFFFF',
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 13.5,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 8,
  },
  inputError: { borderColor: '#E59A9A' },
  errorText: { fontSize: 12, color: '#9B1C1C', marginTop: -2, marginBottom: 10, paddingHorizontal: 4 },
  gpsErrorText: { marginTop: -16 },
  errorSummary: { fontSize: 12.5, color: '#9B1C1C', fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  gpsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 24,
  },
  gpsCardError: { borderColor: '#F0C2C2', backgroundColor: '#FFF8F8' },
  routeAttachedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#E8F5E9',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 10,
  },
  routeAttachedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D6A4F',
  },
  gpsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  gpsStatusBadge: { color: '#215A36', fontWeight: '700', fontSize: 12 },
  gpsStatusPending: { color: '#213B2A', fontWeight: '700', fontSize: 13 },
  gpsStatusError: { color: '#9B1C1C', fontWeight: '700', fontSize: 14 },
  gpsCoords: { fontSize: 14, fontWeight: '800', color: '#1E2B22', marginBottom: 4 },
  gpsDetails: { fontSize: 11.5, color: '#7E8F83', marginBottom: 12 },
  refreshGpsBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#EDF5EF',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  refreshContent: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  refreshGpsBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 12 },
  bottomActionsRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  actionBtn: { flex: 1, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  saveDraftBtn: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#213B2A' },
  saveDraftBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 15 },
  saveSubmitBtn: { backgroundColor: '#213B2A' },
  saveSubmitBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});