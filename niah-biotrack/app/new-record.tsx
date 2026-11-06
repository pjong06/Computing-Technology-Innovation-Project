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

const DONE_BAR_ID = 'new-record-done';

const DEFAULT_PHOTO_TYPES: PlantPhotoType[] = [
  'whole_plant',
  'leaf',
  'flower',
  'bark',
];

const LIFE_STAGES: LifeStage[] = [
  'Seedling',
  'Sapling',
  'Pole',
  'Mature',
  'Senescent',
];

const HEALTH_STATUSES: {
  label: HealthStatus;
  color: string;
  bg: string;
  border: string;
}[] = [
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

function initialPhotos(
  record: PlantRecord | undefined
): ImagePicker.ImagePickerAsset[] {
  if (!record) return [];

  const asset = (uri: string): ImagePicker.ImagePickerAsset =>
    ({
      uri,
      width: 0,
      height: 0,
    } as ImagePicker.ImagePickerAsset);

  const offlineRecord = record as PlantRecordWithOfflinePhotos;

  if (offlineRecord.photoEntries && offlineRecord.photoEntries.length > 0) {
    return offlineRecord.photoEntries.map((photo) => asset(photo.uri));
  }

  if (record.photoUris && record.photoUris.length > 0) {
    return record.photoUris.map(asset);
  }

  return [];
}

interface GpsFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}

type GpsStatus = 'acquiring' | 'ready' | 'unavailable' | 'timeout';

const GPS_TIMEOUT_MS = 20_000;

class GpsTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GpsTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

type FieldErrors = Partial<
  Record<'photos' | 'scientificName' | 'locationName' | 'gps', string>
>;

export default function NewRecordScreen() {
  const router = useRouter();
  const blocked = useStaffOnly();
  const me = useProfileStore((state) => state.me);

  const { editId } = useLocalSearchParams<{ editId?: string }>();

  const existingRecord = useRecordStore((state) =>
    editId ? state.records.find((record) => record.id === editId) : undefined
  );

  const addRecord = useRecordStore((state) => state.addRecord);
  const updateRecord = useRecordStore((state) => state.updateRecord);
  const syncRecord = useRecordStore((state) => state.syncRecord);

  const isEditing = Boolean(existingRecord);

  // Photos (1-4 uploads)
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>(() =>
    initialPhotos(existingRecord)
  );

  // Manual Botanical Inputs
  const [scientificName, setScientificName] = useState(
    existingRecord?.scientificName ?? ''
  );
  const [commonName, setCommonName] = useState(
    existingRecord?.commonName ?? ''
  );
  const [family, setFamily] = useState(existingRecord?.family ?? '');

  // Split Measurements: Height (m) & Diameter (cm)
  const [height, setHeight] = useState(existingRecord?.height ?? '');
  const [diameter, setDiameter] = useState(
    (existingRecord as PlantRecordWithOfflinePhotos)?.diameter ?? ''
  );

  // Baseline condition selectors
  const [lifeStage, setLifeStage] = useState<LifeStage>(
    existingRecord?.observations?.[0]?.stage ?? 'Mature'
  );
  const [healthStatus, setHealthStatus] = useState<HealthStatus>(
    existingRecord?.observations?.[0]?.health ?? 'Healthy'
  );

  const allSpecies = useSpeciesStore((state) => state.species);

  const [morphology, setMorphology] = useState(
    existingRecord?.morphology ?? ''
  );
  const [locationName, setLocationName] = useState(
    existingRecord?.locationName ?? ''
  );

  const [gpsFix, setGpsFix] = useState<GpsFix | null>(
    existingRecord?.latitude !== undefined &&
      existingRecord?.longitude !== undefined
      ? {
          latitude: existingRecord.latitude,
          longitude: existingRecord.longitude,
          accuracyM: existingRecord.gpsAccuracyM ?? null,
        }
      : null
  );

  const [gpsStatus, setGpsStatus] = useState<GpsStatus>(
    existingRecord?.latitude !== undefined &&
      existingRecord?.longitude !== undefined
      ? 'ready'
      : 'acquiring'
  );

  const [gpsError, setGpsError] = useState('');
  const screenActive = useRef(true);
  const gpsRequestId = useRef(0);
  const [errors, setErrors] = useState<FieldErrors>({});

  const clearError = (field: keyof FieldErrors) => {
    setErrors((previous) =>
      previous[field] ? { ...previous, [field]: undefined } : previous
    );
  };

  const identifyRequest = useRef<AbortController | null>(null);
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([]);
  const [selectedSpecies, setSelectedSpecies] =
    useState<SpeciesSuggestion | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identifyMessage, setIdentifyMessage] = useState('');

  const identifyPhoto = photos.length > 0 ? photos[0] : null;

  const photosRef = useRef(photos);
  photosRef.current = photos;

  const recordSaved = useRef(false);
  const originalPhotoUris = useRef(new Set(existingRecord?.photoUris ?? []));

  useEffect(() => {
    screenActive.current = true;

    if (!gpsFix) {
      void fetchLocation();
    }

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

  const fetchLocation = async () => {
    const requestId = ++gpsRequestId.current;
    const isCurrent = () =>
      screenActive.current && requestId === gpsRequestId.current;

    const markUnavailable = (reason: string) => {
      if (!isCurrent()) return;
      setGpsFix(null);
      setGpsError(reason);
      setGpsStatus('unavailable');
    };

    setGpsStatus('acquiring');
    setGpsError('');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        markUnavailable('Location permission is off for this app.');
        return;
      }

      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        markUnavailable('Location services are turned off on this device.');
        return;
      }

      const location = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }),
        GPS_TIMEOUT_MS
      );

      if (!isCurrent()) return;

      setGpsFix({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracyM: location.coords.accuracy ?? null,
      });
      setGpsStatus('ready');
      clearError('gps');
    } catch (error) {
      if (error instanceof GpsTimeoutError) {
        if (!isCurrent()) return;
        setGpsFix(null);
        setGpsError('');
        setGpsStatus('timeout');
        return;
      }
      markUnavailable('Could not get a GPS fix.');
    }
  };

  const handlePickResult = async (result: PickImageResult) => {
    if (result.status === 'picked') {
      let permanentUri: string;
      try {
        permanentUri = await savePhotoPermanently(result.asset.uri);
      } catch {
        Toast.show({
          type: 'error',
          text1: 'Photo not saved',
          text2: 'The photo could not be stored on this device.',
        });
        return;
      }

      if (!screenActive.current) {
        void deleteStoredPhoto(permanentUri);
        return;
      }

      setPhotos((previous) => {
        if (previous.length >= 4) return previous;
        return [...previous, { ...result.asset, uri: permanentUri }];
      });

      clearError('photos');
      return;
    }

    if (result.status === 'permission-denied') {
      Toast.show({
        type: 'error',
        text1: 'Camera permission needed',
        text2: 'Allow camera access for Expo Go in Settings.',
      });
      return;
    }

    if (result.status === 'error') {
      Toast.show({
        type: 'error',
        text1: 'Could not open',
        text2: 'The camera or photo library could not be opened.',
      });
    }
  };

  const handleAddPhoto = () => {
    if (photos.length >= 4) {
      Toast.show({
        type: 'info',
        text1: 'Maximum Limit Reached',
        text2: 'You can attach up to 4 photos per plant record.',
      });
      return;
    }

    Alert.alert('Attach Plant Photo', 'Select image source', [
      {
        text: 'Take Photo',
        onPress: async () => {
          await handlePickResult(await takePhotoWithCamera());
        },
      },
      {
        text: 'Choose from Gallery',
        onPress: async () => {
          await handlePickResult(await pickImageFromLibrary());
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const removePhoto = (index: number) => {
    const photo = photos[index];
    if (photo && !originalPhotoUris.current.has(photo.uri)) {
      void deleteStoredPhoto(photo.uri);
    }
    setPhotos((previous) => previous.filter((_, i) => i !== index));
  };

  const handleIdentify = async () => {
    if (!identifyPhoto || identifying) return;

    const request = new AbortController();
    identifyRequest.current = request;

    setIdentifying(true);
    setIdentifyMessage('');
    setSuggestions([]);
    setSelectedSpecies(null);

    try {
      const nextSuggestions = await identifyPlant(
        identifyPhoto,
        request.signal
      );

      if (request.signal.aborted) return;
      setSuggestions(nextSuggestions);

      if (nextSuggestions.length === 0) {
        setIdentifyMessage('No species match found. You can enter details manually.');
      }
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof IdentifyNetworkError) {
        setIdentifyMessage("Can't reach the AI server. You can enter details manually.");
      } else {
        setIdentifyMessage(
          error instanceof Error
            ? error.message
            : 'Identification failed. Please enter details manually.'
        );
      }
    } finally {
      if (identifyRequest.current === request) {
        identifyRequest.current = null;
        setIdentifying(false);
      }
    }
  };

  const selectSuggestion = (suggestion: SpeciesSuggestion) => {
    setSelectedSpecies(suggestion);
    setScientificName(suggestion.scientificName);
    if (suggestion.commonName) setCommonName(suggestion.commonName);
    if (suggestion.family) setFamily(suggestion.family);
    clearError('scientificName');
  };

  const handleLocationNameChange = (value: string) => {
    setLocationName(value);
    clearError('locationName');
  };

  const handleSave = async (submitForReview: boolean) => {
    const offlineRecord = existingRecord as
      | PlantRecordWithOfflinePhotos
      | undefined;

    const photoMeta: Record<string, PhotoUpload> = {};
    const photoEntries: OfflinePlantPhotoEntry[] = [];

    photos.forEach((asset, index) => {
      const uri = asset.uri;
      const photoType = DEFAULT_PHOTO_TYPES[index] || 'whole_plant';

      const previousEntry = offlineRecord?.photoEntries?.find(
        (photo) => photo.uri === uri
      );
      const previousMeta = existingRecord?.photoMeta?.[uri];
      const photoId = previousEntry?.id ?? previousMeta?.id ?? randomUUID();

      let photoSyncStatus =
        previousEntry?.syncStatus ??
        (previousMeta?.uploaded
          ? SyncStatus.UPLOADED
          : submitForReview
          ? SyncStatus.NOT_UPLOADED
          : SyncStatus.LOCAL_ONLY);

      if (submitForReview && photoSyncStatus === SyncStatus.LOCAL_ONLY) {
        photoSyncStatus = SyncStatus.NOT_UPLOADED;
      }

      photoEntries.push({
        id: photoId,
        uri,
        photoType,
        syncStatus: photoSyncStatus,
        serverId: previousEntry?.serverId,
        lastError: previousEntry?.lastError,
      });

      photoMeta[uri] = {
        ...(previousMeta && previousMeta.type === photoType
          ? previousMeta
          : {}),
        id: photoId,
        type: photoType,
        uploaded: photoSyncStatus === SyncStatus.UPLOADED,
      };
    });

    const photoList = photoEntries.map((photo) => photo.uri);
    const nextErrors: FieldErrors = {};

    if (photoList.length === 0) {
      nextErrors.photos = 'Add at least one photo (min. 1, max. 4).';
    }

    if (!scientificName.trim()) {
      nextErrors.scientificName = 'Enter a scientific name.';
    }

    if (!locationName.trim()) {
      nextErrors.locationName = 'Enter a location landmark.';
    }

    if (!gpsFix) {
      nextErrors.gps =
        'A GPS fix is required. Wait for it, or tap the GPS card to retry.';
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0 || !gpsFix) {
      return;
    }

    const match = allSpecies.find(
      (s) => s.scientific_name.trim().toLowerCase() === scientificName.trim().toLowerCase()
    );

    const heightNum = parseFloat(height);
    const diameterNum = parseFloat(diameter);

    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const formattedTime = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const initialVisit: ObservationVisit = {
      id: existingRecord?.observations?.[0]?.id || randomUUID(),
      date: `${formattedDate} · ${formattedTime}`,
      observedAt: now.toISOString(),
      recordedBy: me?.full_name || me?.email || 'Field Staff',
      health: healthStatus,
      stage: lifeStage,
      heightCm: Number.isFinite(heightNum) ? Math.round(heightNum * 100) : undefined,
      diameterCm: Number.isFinite(diameterNum) ? diameterNum : undefined,
      measurement: `Height ${height || '-'} m · Diameter ${diameter || '-'} cm`,
      notes: morphology.trim() || 'Initial registration record.',
      photoUris: photoList,
      syncStatus: submitForReview
        ? SyncStatus.NOT_UPLOADED
        : SyncStatus.LOCAL_ONLY,
    };

    const recordData = {
      scientificName: scientificName.trim(),
      speciesId: match?.id ?? null,
      commonName: commonName.trim(),
      family: family.trim(),
      height: height.trim() || undefined,
      diameter: diameter.trim() || undefined,
      morphology: morphology.trim() || undefined,
      locationName: locationName.trim(),
      latitude: gpsFix.latitude,
      longitude: gpsFix.longitude,
      gpsAccuracyM: gpsFix.accuracyM,
      gpsCoordination: formatCoordinates(
        gpsFix.latitude,
        gpsFix.longitude,
        gpsFix.accuracyM
      ),
      photoUris: photoList,
      photoMeta,
      photoEntries,
      observations: existingRecord?.observations?.length
        ? [initialVisit, ...existingRecord.observations.slice(1)]
        : [initialVisit],
      recordStatus: submitForReview
        ? RecordStatus.COMPLETE
        : RecordStatus.DRAFT,
      identificationStatus: scientificName.trim()
        ? IdentificationStatus.IDENTIFIED
        : IdentificationStatus.PENDING,
      syncStatus: submitForReview
        ? SyncStatus.NOT_UPLOADED
        : SyncStatus.LOCAL_ONLY,
      reviewStatus: submitForReview ? ReviewStatus.PENDING : ReviewStatus.DRAFT,
    };

    const saved = existingRecord
      ? await updateRecord(existingRecord.id, recordData as any)
      : await addRecord(recordData as any);

    if (!saved) {
      Toast.show({
        type: 'error',
        text1: 'Record not updated',
        text2: 'Only local drafts and returned records can be edited.',
      });
      return;
    }

    if (existingRecord) {
      originalPhotoUris.current.forEach((uri) => {
        if (!photoList.includes(uri)) {
          void deleteStoredPhoto(uri);
        }
      });
    }

    recordSaved.current = true;

    Toast.show({
      type: 'success',
      text1: submitForReview ? 'Submitted for review' : 'Draft saved',
      text2: submitForReview
        ? 'Plant record queued for officer review.'
        : 'Plant record saved safely on this device.',
    });

    router.replace({
      pathname: '/save-confirm',
      params: { id: saved.id },
    } as any);

    if (saved.syncStatus === SyncStatus.NOT_UPLOADED) {
      void syncRecord(saved.id);
    }
  };

  if (blocked) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Navigation Header */}
      <View style={styles.navRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navSide}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back-outline" size={28} color="#213B2A" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>
          {isEditing ? 'Edit plant record' : 'Register plant'}
        </Text>
        <View style={styles.navSide} />
      </View>

      <FormScrollView contentContainerStyle={styles.scrollContent}>
        {/* ── SECTION 1: PHOTOS (PILL OUTLINE BUTTON) ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>PHOTOS *</Text>
          <Text style={styles.sectionSubLabel}>
            {photos.length}/4 (min. 1 required)
          </Text>
        </View>

        {photos.length > 0 && (
          <View style={styles.thumbnailGrid}>
            {photos.map((asset, index) => (
              <View key={`${asset.uri}-${index}`} style={styles.thumbnailWrapper}>
                <Image source={{ uri: asset.uri }} style={styles.thumbnail} />
                <TouchableOpacity
                  style={styles.removePhotoBtn}
                  onPress={() => removePhoto(index)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${index + 1}`}
                >
                  <Ionicons name="close-outline" size={15} color="#FFFFFF" />
                </TouchableOpacity>
                <View style={styles.photoBadge}>
                  <Text style={styles.photoBadgeText}>#{index + 1}</Text>
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
              <Ionicons
                name={photos.length === 0 ? 'camera-outline' : 'add-outline'}
                size={20}
                color="#213B2A"
              />
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
                  <Text style={styles.identifyBtnText}>
                    Identify species with AI
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={styles.aiHint}>
              Uses your primary photo (#{1}) · internet required
            </Text>

            {identifyMessage !== '' && (
              <Text style={styles.identifyMessage}>{identifyMessage}</Text>
            )}

            {suggestions.length > 0 && (
              <View style={styles.suggestionsBlock}>
                <Text style={styles.suggestionsTitle}>
                  AI species suggestions
                </Text>
                <Text style={styles.suggestionsHelp}>
                  Select an AI suggestion to auto-fill the fields below.
                </Text>

                {suggestions.map((suggestion) => {
                  const selected =
                    selectedSpecies?.rank === suggestion.rank &&
                    selectedSpecies.scientificName ===
                      suggestion.scientificName;

                  return (
                    <TouchableOpacity
                      key={`${suggestion.rank}-${suggestion.scientificName}`}
                      style={[
                        styles.suggestionCard,
                        selected && styles.selectedSuggestionCard,
                      ]}
                      onPress={() => selectSuggestion(suggestion)}
                    >
                      <View style={styles.suggestionHeader}>
                        <Text style={styles.suggestionName}>
                          {suggestion.rank}. {suggestion.scientificName}
                        </Text>
                        <Text style={styles.confidence}>
                          {suggestion.confidence.toFixed(1)}%
                        </Text>
                      </View>

                      {suggestion.commonName && (
                        <Text style={styles.suggestionDetail}>
                          Common name: {suggestion.commonName}
                        </Text>
                      )}

                      {suggestion.family && (
                        <Text style={styles.suggestionDetail}>
                          Family: {suggestion.family}
                        </Text>
                      )}

                      <Text style={styles.suggestionDetail}>
                        Confidence: {suggestion.confidenceLevel}
                        {selected ? ' · Selected' : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── SECTION 2: SPECIES DETAILS (MANUAL INPUTS ONLY) ── */}
        <Text style={styles.sectionLabel}>SPECIES DETAILS</Text>

        <Text style={styles.fieldLabel}>Scientific name *</Text>
        <TextInput
          style={[styles.input, errors.scientificName && styles.inputError]}
          placeholder="e.g. Nepenthes bicalcarata"
          placeholderTextColor="#8C9A91"
          value={scientificName}
          onChangeText={(text) => {
            setScientificName(text);
            clearError('scientificName');
          }}
          inputAccessoryViewID={DONE_BAR_ID}
        />
        {errors.scientificName && (
          <Text style={styles.errorText}>{errors.scientificName}</Text>
        )}

        <Text style={styles.fieldLabel}>Common name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Fanged Pitcher Plant"
          placeholderTextColor="#8C9A91"
          value={commonName}
          onChangeText={setCommonName}
          inputAccessoryViewID={DONE_BAR_ID}
        />

        <Text style={styles.fieldLabel}>Family</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Nepenthaceae"
          placeholderTextColor="#8C9A91"
          value={family}
          onChangeText={setFamily}
          inputAccessoryViewID={DONE_BAR_ID}
        />

        {/* ── SECTION 3: SPLIT HEIGHT (M) & DIAMETER (CM) ── */}
        <View style={styles.measurementRow}>
          <View style={styles.halfCol}>
            <Text style={styles.fieldLabel}>Height (m)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2.0"
              placeholderTextColor="#8C9A91"
              keyboardType="decimal-pad"
              value={height}
              onChangeText={setHeight}
              inputAccessoryViewID={DONE_BAR_ID}
            />
          </View>

          <View style={styles.halfCol}>
            <Text style={styles.fieldLabel}>Diameter (cm)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 40"
              placeholderTextColor="#8C9A91"
              keyboardType="decimal-pad"
              value={diameter}
              onChangeText={setDiameter}
              inputAccessoryViewID={DONE_BAR_ID}
            />
          </View>
        </View>

        {/* ── SECTION 4: LIFE STAGE & HEALTH STATUS ── */}
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
                  {selected && (
                    <Ionicons
                      name="checkmark-outline"
                      size={14}
                      color="#FFFFFF"
                      style={styles.chipIcon}
                    />
                  )}
                  <Text
                    style={[styles.chipText, selected && styles.chipTextSelected]}
                  >
                    {stage}
                  </Text>
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
                <View
                  style={[styles.statusDot, { backgroundColor: item.color }]}
                />
                <Text style={[styles.healthChipText, { color: item.color }]}>
                  {item.label}
                </Text>
                {selected && (
                  <Ionicons
                    name="checkmark-outline"
                    size={14}
                    color={item.color}
                    style={{ marginLeft: 4 }}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Field Notes */}
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

        {/* ── SECTION 5: LOCATION & GPS ── */}
        <Text style={[styles.sectionLabel, { marginTop: 18 }]}>LOCATION</Text>

        <Text style={styles.fieldLabel}>Location landmark *</Text>
        <TextInput
          style={[styles.input, errors.locationName && styles.inputError]}
          placeholder="e.g. left of boardwalk, 50 m past cave entrance"
          placeholderTextColor="#8C9A91"
          value={locationName}
          onChangeText={handleLocationNameChange}
          returnKeyType="done"
        />

        {errors.locationName && (
          <Text style={styles.errorText}>{errors.locationName}</Text>
        )}

        <Text style={styles.fieldLabel}>GPS coordinates *</Text>

        {gpsStatus === 'acquiring' && (
          <View style={styles.gpsCard}>
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#213B2A" />
              <Text style={styles.gpsStatusPending}>Acquiring GPS fix...</Text>
            </View>
            <Text style={styles.gpsDetails}>
              This can take longer under dense canopy. Gives up after 20 seconds.
            </Text>
            <TouchableOpacity
              style={styles.refreshGpsBtn}
              onPress={() => void fetchLocation()}
              accessibilityRole="button"
              accessibilityLabel="Retry GPS location acquisition"
            >
              <View style={styles.refreshContent}>
                <Ionicons name="refresh-outline" size={14} color="#213B2A" />
                <Text style={styles.refreshGpsBtnText}>Retry</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {gpsStatus === 'timeout' && (
          <View style={[styles.gpsCard, styles.gpsCardError]}>
            <View style={styles.gpsHeaderRow}>
              <Ionicons name="location-outline" size={18} color="#9B1C1C" />
              <Text style={styles.gpsStatusError}>
                Couldn't get a GPS fix – move to an open spot
              </Text>
            </View>
            <Text style={styles.gpsDetails}>
              No fix after 20 seconds. Step away from dense canopy or rock walls,
              then retry.
            </Text>
            <TouchableOpacity
              style={styles.refreshGpsBtn}
              onPress={() => void fetchLocation()}
              accessibilityRole="button"
              accessibilityLabel="Retry GPS location acquisition"
            >
              <View style={styles.refreshContent}>
                <Ionicons name="refresh-outline" size={14} color="#213B2A" />
                <Text style={styles.refreshGpsBtnText}>Retry</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {gpsStatus === 'unavailable' && (
          <TouchableOpacity
            style={[styles.gpsCard, styles.gpsCardError]}
            activeOpacity={0.8}
            onPress={() => void fetchLocation()}
            accessibilityRole="button"
            accessibilityLabel="GPS unavailable, tap to retry"
          >
            <View style={styles.gpsHeaderRow}>
              <Ionicons name="location-outline" size={18} color="#9B1C1C" />
              <Text style={styles.gpsStatusError}>
                GPS unavailable – tap to retry
              </Text>
            </View>
            {gpsError !== '' && (
              <Text style={styles.gpsDetails}>{gpsError}</Text>
            )}
          </TouchableOpacity>
        )}

        {gpsStatus === 'ready' && gpsFix && (
          <View style={styles.gpsCard}>
            <View style={styles.gpsHeaderRow}>
              <Ionicons name="location-outline" size={18} color="#215A36" />
              <Text style={styles.gpsStatusBadge}>
                {describeAccuracy(gpsFix.accuracyM)}
              </Text>
            </View>
            <Text style={styles.gpsCoords}>
              {formatCoordinates(gpsFix.latitude, gpsFix.longitude, null)}
            </Text>
            <Text style={styles.gpsDetails}>
              {gpsFix.accuracyM === null
                ? 'The device did not report accuracy for this fix.'
                : `Accuracy ±${Math.round(gpsFix.accuracyM)} m`}
            </Text>
            <TouchableOpacity
              style={styles.refreshGpsBtn}
              onPress={() => void fetchLocation()}
              accessibilityRole="button"
              accessibilityLabel="Update GPS to current location"
            >
              <View style={styles.refreshContent}>
                <Ionicons name="refresh-outline" size={14} color="#213B2A" />
                <Text style={styles.refreshGpsBtnText}>
                  Update to current location
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {errors.gps && !gpsFix && (
          <Text style={[styles.errorText, styles.gpsErrorText]}>
            {errors.gps}
          </Text>
        )}

        {Object.values(errors).some(Boolean) && (
          <Text style={styles.errorSummary}>
            Fix the highlighted fields above to save.
          </Text>
        )}

        {/* ── SECTION 6: DUAL ACTIONS ("Save" vs "Save and submit") ── */}
        <View style={styles.bottomActionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.saveDraftBtn]}
            activeOpacity={0.85}
            onPress={() => void handleSave(false)}
            accessibilityRole="button"
            accessibilityLabel="Save plant record locally as draft"
          >
            <Text style={styles.saveDraftBtnText}>Save</Text>
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
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#7D8C81',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 8,
  },
  sectionSubLabel: {
    fontSize: 11.5,
    color: '#88988D',
  },
  thumbnailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  thumbnailWrapper: {
    width: 74,
    height: 74,
    borderRadius: 12,
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
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
  photoBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
  },
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
  pillUploadContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillUploadBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#213B2A',
  },
  measurementRow: {
    flexDirection: 'row',
    gap: 12,
  },
  halfCol: {
    flex: 1,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#F0F4F1',
    borderWidth: 1,
    borderColor: '#DFE7E1',
  },
  chipSelected: {
    backgroundColor: '#213B2A',
    borderColor: '#213B2A',
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipIcon: {
    marginRight: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#49594D',
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  healthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  healthChipText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  aiSection: {
    marginBottom: 16,
  },
  identifyBtn: {
    backgroundColor: '#46654F',
    minHeight: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  disabledBtn: {
    opacity: 0.65,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  identifyContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  identifyBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  aiHint: {
    fontSize: 11.5,
    color: '#7E8F83',
    marginTop: 6,
    textAlign: 'center',
  },
  identifyMessage: {
    fontSize: 12.5,
    color: '#7A5134',
    lineHeight: 18,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  suggestionsBlock: {
    marginTop: 12,
  },
  suggestionsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#213B2A',
    marginBottom: 2,
  },
  suggestionsHelp: {
    fontSize: 11.5,
    color: '#68776D',
    marginBottom: 8,
  },
  suggestionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 14,
    marginBottom: 8,
  },
  selectedSuggestionCard: {
    backgroundColor: '#EEF5F0',
    borderColor: '#213B2A',
    borderWidth: 2,
  },
  suggestionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  suggestionName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#213B2A',
  },
  confidence: {
    fontWeight: '700',
    color: '#46654F',
  },
  suggestionDetail: {
    fontSize: 12,
    color: '#68776D',
    marginTop: 3,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#213B2A',
    marginBottom: 6,
    marginTop: 6,
  },
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
  inputError: {
    borderColor: '#E59A9A',
  },
  errorText: {
    fontSize: 12,
    color: '#9B1C1C',
    marginTop: -2,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  gpsErrorText: {
    marginTop: -16,
  },
  errorSummary: {
    fontSize: 12.5,
    color: '#9B1C1C',
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  gpsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 24,
  },
  gpsCardError: {
    borderColor: '#F0C2C2',
    backgroundColor: '#FFF8F8',
  },
  gpsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  gpsStatusBadge: {
    color: '#215A36',
    fontWeight: '700',
    fontSize: 12,
  },
  gpsStatusPending: {
    color: '#213B2A',
    fontWeight: '700',
    fontSize: 13,
  },
  gpsStatusError: {
    color: '#9B1C1C',
    fontWeight: '700',
    fontSize: 14,
  },
  gpsCoords: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E2B22',
    marginBottom: 4,
  },
  gpsDetails: {
    fontSize: 11.5,
    color: '#7E8F83',
    marginBottom: 12,
  },
  refreshGpsBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#EDF5EF',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  refreshContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  refreshGpsBtnText: {
    color: '#213B2A',
    fontWeight: '700',
    fontSize: 12,
  },
  bottomActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  actionBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveDraftBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#213B2A',
  },
  saveDraftBtnText: {
    color: '#213B2A',
    fontWeight: '700',
    fontSize: 15,
  },
  saveSubmitBtn: {
    backgroundColor: '#213B2A',
  },
  saveSubmitBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});