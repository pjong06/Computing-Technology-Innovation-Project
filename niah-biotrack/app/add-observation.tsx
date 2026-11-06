import React, { useEffect, useState } from 'react';
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
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import Toast from 'react-native-toast-message';

import {
  useRecordStore,
  type HealthStatus,
  type LifeStage,
} from '../src/store/useRecordStore';
import { useProfileStore } from '../src/store/useProfileStore';
import {
  pickImageFromLibrary,
  takePhotoWithCamera,
} from '../src/utils/imagePicker';
import { savePhotoPermanently } from '../src/utils/photoStorage';
import { useAuthRole } from '../src/context/AuthRoleContext';
import { describeTagLookup, lookupTag } from '../src/services/tagLookup';

import FormScrollView from '../src/components/FormScrollView';
import KeyboardDoneBar from '../src/components/KeyboardDoneBar';

const DONE_BAR_ID = 'add-observation-done';
const GPS_TIMEOUT_MS = 20_000;

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

export default function AddObservationScreen() {
  const router = useRouter();
  const { isVisitor } = useAuthRole();

  const params = useLocalSearchParams<{
    plantId?: string;
    tagCode?: string;
    scientificName?: string;
  }>();

  const records = useRecordStore((state) => state.records);
  const addObservation = useRecordStore((state) => state.addObservation);
  const syncRecord = useRecordStore((state) => state.syncRecord);
  const me = useProfileStore((state) => state.me);

  useEffect(() => {
    if (!isVisitor) return;

    Alert.alert(
      'Botanist Access Required',
      'Visitor accounts are read-only. Logging observations requires staff credentials.',
      [
        {
          text: 'OK',
          onPress: () => router.replace('/(tabs)/home'),
        },
      ]
    );
  }, [isVisitor, router]);

  const passedPlant = params.plantId
    ? records.find(
        (record) =>
          record.id === params.plantId || record.serverId === params.plantId
      )
    : undefined;

  const firstStep = passedPlant ? 2 : 1;
  const [currentStep, setCurrentStep] = useState<number>(firstStep);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [plantTag, setPlantTag] = useState<string>(params.tagCode || '');

  // ── PART 1 & 2: SPLIT MEASUREMENT STATES ─────────────────────
  const [heightCm, setHeightCm] = useState<string>('');
  const [diameterCm, setDiameterCm] = useState<string>('');

  const [lifeStage, setLifeStage] = useState<LifeStage>('Mature');
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('Healthy');

  const cleanTag = plantTag.trim().toUpperCase();
  const plant =
    passedPlant ??
    (cleanTag
      ? records.find((record) => record.tagCode === cleanTag)
      : undefined);

  const scientificName =
    plant?.scientificName || params.scientificName || '';

  // ── UNIFIED PHOTO EVIDENCE (MIN 1, MAX 4) ────────────────────
  const [photos, setPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [visitLocation, setVisitLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracyM: number | null;
  } | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    'not-requested' | 'capturing' | 'ready' | 'unavailable'
  >('not-requested');
  const [locationMessage, setLocationMessage] = useState('');

  const adjustValue = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    delta: number,
    isFloat = false
  ) => {
    setter((previous) => {
      const current = Number.parseFloat(previous) || 0;
      const updated = Math.max(0, current + delta);
      return isFloat ? updated.toFixed(1) : Math.round(updated).toString();
    });
  };

  const handlePickPhoto = async (source: 'camera' | 'gallery') => {
    if (photos.length >= 4) {
      Toast.show({
        type: 'info',
        text1: 'Maximum Limit Reached',
        text2: 'You can upload a maximum of 4 photos per observation visit.',
      });
      return;
    }

    const result =
      source === 'camera'
        ? await takePhotoWithCamera()
        : await pickImageFromLibrary();

    if (result.status === 'permission-denied') {
      Alert.alert(
        'Permission Denied',
        'Camera permission is required to capture field evidence.'
      );
      return;
    }

    if (result.status === 'error') {
      Alert.alert(
        source === 'camera' ? 'Camera unavailable' : 'Gallery unavailable',
        source === 'camera'
          ? 'The camera could not be opened. Please try again.'
          : 'The photo library could not be opened. Please try again.'
      );
      return;
    }

    if (result.status === 'picked') {
      setPhotos((previous) => [...previous, result.asset.uri]);
    }
  };

  const captureVisitLocation = async () => {
    setLocationStatus('capturing');
    setLocationMessage('');

    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const { status } =
        await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationMessage(
          'Location permission is off. You can still save without GPS.'
        );
        setLocationStatus('unavailable');
        return null;
      }

      if (!(await Location.hasServicesEnabledAsync())) {
        setLocationMessage(
          'Location services are off. You can still save without GPS.'
        );
        setLocationStatus('unavailable');
        return null;
      }

      const locationPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('GPS_TIMEOUT')),
          GPS_TIMEOUT_MS
        );
      });
      const fix = await Promise.race([locationPromise, timeoutPromise]);
      const captured = {
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracyM: fix.coords.accuracy,
      };

      setVisitLocation(captured);
      setLocationStatus('ready');
      return captured;
    } catch (error) {
      console.warn('Could not capture observation location:', error);
      setLocationMessage(
        error instanceof Error && error.message === 'GPS_TIMEOUT'
          ? 'GPS took too long to respond. You can still save without GPS.'
          : 'Could not get a GPS fix. You can still save without GPS.'
      );
      setLocationStatus('unavailable');
      return null;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  const handleRemovePhoto = (index: number) => {
    setPhotos((previous) =>
      previous.filter((_, photoIndex) => photoIndex !== index)
    );
  };

  // ── STEP VALIDATION ──────────────────────────────────────────
  const handleNextStep = async () => {
    if (currentStep === 1) {
      if (!plantTag.trim() && !params.plantId) {
        Toast.show({
          type: 'error',
          text1: 'Tag Required',
          text2: 'Scan or input a plant tag identifier.',
        });
        return;
      }

      if (!plant) {
        const result = await lookupTag(cleanTag);
        if (result.status !== 'on-phone') {
          Toast.show({
            type: 'error',
            text1: describeTagLookup(result).title,
            text2: describeTagLookup(result).message,
          });
          return;
        }
      }

      setCurrentStep(2);
      return;
    }

    if (currentStep === 2) {
      if (!heightCm.trim() || !diameterCm.trim()) {
        Toast.show({
          type: 'error',
          text1: 'Measurements Required',
          text2: 'Both Height and Diameter values must be recorded.',
        });
        return;
      }

      setCurrentStep(3);
    }
  };

  // ── SAVE & VALIDATE MINIMUM 1 PHOTO ──────────────────────────
  const handleSaveObservation = async () => {
    if (!plant) {
      Toast.show({
        type: 'error',
        text1: 'Plant not found',
        text2: 'Open this plant from My Records and try again.',
      });
      return;
    }

    // Minimum 1 photo enforcement
    if (photos.length === 0) {
      Toast.show({
        type: 'error',
        text1: 'Evidence Photo Required',
        text2: 'Please capture at least 1 photo before saving this observation.',
      });
      return;
    }

    if (photos.length > 4) {
      Toast.show({
        type: 'error',
        text1: 'Photo Limit Exceeded',
        text2: 'Maximum 4 photos allowed per visit.',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const capturedLocation =
        visitLocation ??
        (locationStatus !== 'unavailable'
          ? await captureVisitLocation()
          : null);
      const storedPhotoUris = await Promise.all(
        photos.map((uri) => savePhotoPermanently(uri))
      );

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

      const height = Number.parseFloat(heightCm);
      const diameter = Number.parseFloat(diameterCm);

      await addObservation(plant.id, {
        date: `${formattedDate} · ${formattedTime}`,
        observedAt: now.toISOString(),
        recordedBy: me?.full_name || me?.email || 'Field Staff',
        health: healthStatus,
        stage: lifeStage,
        measurement: `Height ${heightCm} cm · Diameter ${diameterCm} cm`,
        heightCm: Number.isFinite(height) ? height : undefined,
        diameterCm: Number.isFinite(diameter) ? diameter : undefined,
        notes: notes.trim() || 'Observation logged in field.',
        photoUris: storedPhotoUris,
        latitude: capturedLocation?.latitude,
        longitude: capturedLocation?.longitude,
        gpsAccuracyM: capturedLocation?.accuracyM,
        submissionRequested: true,
      });

      syncRecord(plant.id)
        .then((result) => {
          if (!result.ok) {
            Toast.show({
              type: 'info',
              text1: 'Saved; submission is pending',
              text2: result.reason,
            });
          }
        })
        .catch((error: unknown) => {
          console.error('Observation sync failed:', error);
          Toast.show({
            type: 'error',
            text1: 'Saved; sync could not start',
            text2: 'The observation is stored on this device and will retry.',
          });
        });

      Toast.show({
        type: 'success',
        text1: 'Observation saved',
        text2: 'Saved on this device and queued for officer review.',
      });

      router.back();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Save Failed',
        text2:
          error instanceof Error
            ? error.message
            : 'The observation could not be saved. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isVisitor) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => {
            if (currentStep > firstStep) {
              setCurrentStep(currentStep - 1);
              return;
            }
            router.back();
          }}
        >
          <Text style={styles.headerBackText}>←</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Add Observation</Text>
          <Text style={styles.headerSub}>Step {currentStep} of 3</Text>
        </View>

        <View style={{ width: 40 }} />
      </View>

      {/* Stepper */}
      <View style={styles.stepperContainer}>
        {[1, 2, 3].map((step) => (
          <View key={step} style={styles.stepTrackWrapper}>
            <View
              style={[
                styles.stepTrack,
                step <= currentStep
                  ? styles.stepTrackActive
                  : styles.stepTrackInactive,
              ]}
            />
            <Text
              style={[
                styles.stepTrackLabel,
                step === currentStep && styles.stepTrackLabelActive,
              ]}
            >
              {step === 1 ? 'Plant' : step === 2 ? 'Metrics' : 'Evidence'}
            </Text>
          </View>
        ))}
      </View>

      <FormScrollView contentContainerStyle={styles.scrollContent}>
        {/* Identified Plant Summary Card */}
        {passedPlant && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>🌿</Text>
              <Text style={[styles.cardTitle, styles.plantName]}>
                {passedPlant.scientificName || 'Identification pending'}
              </Text>
            </View>
            <Text style={styles.plantInfo}>
              <Text style={styles.plantInfoLabel}>Tag: </Text>
              {passedPlant.tagCode ?? 'No tag attached'}
            </Text>
            <Text style={styles.plantInfo}>
              <Text style={styles.plantInfoLabel}>Location landmark: </Text>
              {passedPlant.locationName || 'Not recorded'}
            </Text>
          </View>
        )}

        {/* STEP 1: Tag Lookup */}
        {currentStep === 1 && !passedPlant && (
          <View style={styles.stepContent}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardIcon}>🏷️</Text>
                <Text style={styles.cardTitle}>Plant Identification</Text>
              </View>

              <Text style={styles.fieldLabel}>Plant Tag Code</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. NIAH-PLT-00001"
                placeholderTextColor="#8C9A91"
                value={plantTag}
                onChangeText={setPlantTag}
                autoCapitalize="characters"
              />

              {scientificName ? (
                <View style={styles.speciesBadge}>
                  <Text style={styles.speciesBadgeIcon}>🌿</Text>
                  <Text style={styles.speciesBadgeText}>{scientificName}</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}

        {/* STEP 2: Metrics (Split Height & Diameter) */}
        {currentStep === 2 && (
          <View style={styles.stepContent}>
            {/* PART 1: TREE HEIGHT */}
            <View style={styles.card}>
              <View style={styles.cardHeaderBetween}>
                <View style={styles.metricTitleGroup}>
                  <Text style={styles.metricPartPill}>PART 1</Text>
                  <Text style={styles.cardTitle}>Tree Height (cm)</Text>
                </View>
                <Text style={styles.unitBadge}>Centimeters</Text>
              </View>

              <View style={styles.stepperRow}>
                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => adjustValue(setHeightCm, -10)}
                >
                  <Text style={styles.stepperActionText}>-10</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => adjustValue(setHeightCm, -1)}
                >
                  <Text style={styles.stepperActionText}>-1</Text>
                </TouchableOpacity>

                <TextInput
                  style={styles.stepperInput}
                  value={heightCm}
                  onChangeText={setHeightCm}
                  placeholder="0"
                  placeholderTextColor="#A1B0A6"
                  keyboardType="numeric"
                  textAlign="center"
                  inputAccessoryViewID={DONE_BAR_ID}
                />

                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => adjustValue(setHeightCm, 1)}
                >
                  <Text style={styles.stepperActionText}>+1</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => adjustValue(setHeightCm, 10)}
                >
                  <Text style={styles.stepperActionText}>+10</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* PART 2: DIAMETER AT BREAST HEIGHT */}
            <View style={styles.card}>
              <View style={styles.cardHeaderBetween}>
                <View style={styles.metricTitleGroup}>
                  <Text style={styles.metricPartPill}>PART 2</Text>
                  <Text style={styles.cardTitle}>Diameter at Breast Height (cm)</Text>
                </View>
                <Text style={styles.unitBadge}>DBH</Text>
              </View>

              <View style={styles.stepperRow}>
                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => adjustValue(setDiameterCm, -1, true)}
                >
                  <Text style={styles.stepperActionText}>-1</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => adjustValue(setDiameterCm, -0.1, true)}
                >
                  <Text style={styles.stepperActionText}>-0.1</Text>
                </TouchableOpacity>

                <TextInput
                  style={styles.stepperInput}
                  value={diameterCm}
                  onChangeText={setDiameterCm}
                  placeholder="0.0"
                  placeholderTextColor="#A1B0A6"
                  keyboardType="decimal-pad"
                  textAlign="center"
                  inputAccessoryViewID={DONE_BAR_ID}
                />

                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => adjustValue(setDiameterCm, 0.1, true)}
                >
                  <Text style={styles.stepperActionText}>+0.1</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => adjustValue(setDiameterCm, 1, true)}
                >
                  <Text style={styles.stepperActionText}>+1</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Life Stage */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Life Stage</Text>
              <View style={styles.chipGrid}>
                {LIFE_STAGES.map((stage) => {
                  const selected = lifeStage === stage;
                  return (
                    <TouchableOpacity
                      key={stage}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setLifeStage(stage)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}
                      >
                        {selected ? `✓ ${stage}` : stage}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Health Status */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Health Status</Text>
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
                        style={[
                          styles.statusDot,
                          { backgroundColor: item.color },
                        ]}
                      />
                      <Text style={[styles.healthChipText, { color: item.color }]}>
                        {item.label} {selected ? '✓' : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        {/* STEP 3: Evidence (1-4 Photos) */}
        {currentStep === 3 && (
          <View style={styles.stepContent}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardIcon}>📍</Text>
                <Text style={styles.cardTitle}>Visit GPS Location</Text>
              </View>
              {locationStatus === 'capturing' ? (
                <Text style={styles.locationInfo}>Capturing phone location…</Text>
              ) : visitLocation ? (
                <>
                  <Text style={styles.locationInfo}>
                    {visitLocation.latitude.toFixed(6)}, {visitLocation.longitude.toFixed(6)}
                  </Text>
                  <Text style={styles.locationInfo}>
                    Accuracy:{' '}
                    {visitLocation.accuracyM === null
                      ? 'unavailable'
                      : `about ${Math.round(visitLocation.accuracyM)} m`}
                  </Text>
                </>
              ) : (
                <Text style={styles.locationInfo}>
                  {locationMessage || 'GPS will be captured for this visit when available.'}
                </Text>
              )}
              {locationStatus !== 'capturing' && !visitLocation ? (
                <TouchableOpacity
                  style={styles.locationRetryBtn}
                  onPress={() => void captureVisitLocation()}
                >
                  <Text style={styles.locationRetryText}>
                    {locationStatus === 'unavailable' ? 'Retry GPS' : 'Capture GPS'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeaderBetween}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>📷</Text>
                  <Text style={styles.cardTitle}>Field Evidence Photos *</Text>
                </View>
                <Text style={styles.photoCountText}>
                  {photos.length}/4 (min. 1)
                </Text>
              </View>

              <Text style={styles.photoInstructionText}>
                Capture or attach physical condition evidence (minimum 1 required).
              </Text>

              <View style={styles.photoGrid}>
                {/* Thumbnails */}
                {photos.map((uri, index) => (
                  <View key={`${uri}-${index}`} style={styles.photoTile}>
                    <Image source={{ uri }} style={styles.photoThumb} />
                    <TouchableOpacity
                      style={styles.photoRemoveBtn}
                      onPress={() => handleRemovePhoto(index)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.photoRemoveText}>✕</Text>
                    </TouchableOpacity>
                    <View style={styles.photoBadge}>
                      <Text style={styles.photoBadgeText}>#{index + 1}</Text>
                    </View>
                  </View>
                ))}

                {/* Camera and gallery options */}
                {photos.length < 4 && (
                  <>
                    <TouchableOpacity
                      style={styles.addPhotoCard}
                      onPress={() => handlePickPhoto('camera')}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.cameraIcon}>📸</Text>
                      <Text style={styles.addPhotoText}>Take Photo</Text>
                      <Text style={styles.addPhotoSlotHint}>
                        {4 - photos.length} slot(s) left
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.addPhotoCard}
                      onPress={() => handlePickPhoto('gallery')}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.cameraIcon}>🖼️</Text>
                      <Text style={styles.addPhotoText}>Choose from Gallery</Text>
                      <Text style={styles.addPhotoSlotHint}>
                        {4 - photos.length} slot(s) left
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>

            {/* Notes */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardIcon}>📝</Text>
                <Text style={styles.cardTitle}>Observation Notes</Text>
              </View>

              <TextInput
                style={styles.textArea}
                multiline
                numberOfLines={4}
                placeholder="Document canopy coverage, pest markings, or soil conditions..."
                placeholderTextColor="#8C9A91"
                value={notes}
                onChangeText={setNotes}
                inputAccessoryViewID={DONE_BAR_ID}
              />
            </View>
          </View>
        )}
      </FormScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        {currentStep > firstStep && (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setCurrentStep(currentStep - 1)}
            disabled={isSubmitting}
          >
            <Text style={styles.secondaryBtnText}>Back</Text>
          </TouchableOpacity>
        )}

        {currentStep < 3 ? (
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              { flex: 1, marginLeft: currentStep > firstStep ? 12 : 0 },
            ]}
            onPress={handleNextStep}
            disabled={isSubmitting}
          >
            <Text style={styles.primaryBtnText}>Continue →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.saveBtn, { flex: 1, marginLeft: 12 }]}
            onPress={handleSaveObservation}
            disabled={isSubmitting || locationStatus === 'capturing'}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>☁️ Save and submit</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F0F4F1',
  },
  headerBackText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#213B2A',
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
  stepperContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'space-between',
  },
  stepTrackWrapper: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  stepTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  stepTrackActive: {
    backgroundColor: '#213B2A',
  },
  stepTrackInactive: {
    backgroundColor: '#E0E7E2',
  },
  stepTrackLabel: {
    fontSize: 11,
    color: '#8A998E',
    fontWeight: '600',
  },
  stepTrackLabelActive: {
    color: '#213B2A',
    fontWeight: '800',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  stepContent: {
    gap: 14,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E6ECE8',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardHeaderBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardIcon: {
    fontSize: 18,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#213B2A',
  },
  metricTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metricPartPill: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2D6A4F',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  unitBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#526A5A',
    backgroundColor: '#EDF3EE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#415447',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#F9FAF9',
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E2E8E4',
  },
  plantName: {
    flex: 1,
    fontStyle: 'italic',
  },
  plantInfo: {
    fontSize: 13,
    color: '#1E2B22',
    marginTop: 4,
  },
  plantInfoLabel: {
    fontWeight: '700',
    color: '#415447',
  },
  speciesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF4EE',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 10,
    gap: 6,
  },
  speciesBadgeIcon: {
    fontSize: 15,
  },
  speciesBadgeText: {
    fontSize: 13,
    fontStyle: 'italic',
    fontWeight: '700',
    color: '#2D6A4F',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  stepperActionBtn: {
    backgroundColor: '#EDF3EE',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    minWidth: 44,
    alignItems: 'center',
  },
  stepperActionText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#213B2A',
  },
  stepperInput: {
    flex: 1,
    backgroundColor: '#F9FAF9',
    height: 48,
    borderRadius: 10,
    fontSize: 18,
    fontWeight: '800',
    color: '#213B2A',
    borderWidth: 1.2,
    borderColor: '#D4DDD6',
    textAlign: 'center',
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
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
  photoCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#76877B',
  },
  photoInstructionText: {
    fontSize: 12,
    color: '#68776D',
    marginBottom: 10,
  },
  locationInfo: {
    fontSize: 13,
    color: '#526A5A',
    marginBottom: 4,
  },
  locationRetryBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#E8F5E9',
  },
  locationRetryText: {
    color: '#2D6A4F',
    fontSize: 12,
    fontWeight: '700',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
  },
  photoTile: {
    width: 82,
    height: 82,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#D7DFD9',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#DC2626',
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoRemoveText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  photoBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  photoBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  addPhotoCard: {
    width: 82,
    height: 82,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#A8B7AC',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F6F8F6',
  },
  cameraIcon: {
    fontSize: 22,
  },
  addPhotoText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4A5C50',
    marginTop: 3,
  },
  addPhotoSlotHint: {
    fontSize: 8.5,
    color: '#8A998E',
    marginTop: 1,
  },
  textArea: {
    backgroundColor: '#F9FAF9',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E2E8E4',
    minHeight: 90,
    textAlignVertical: 'top',
  },
  bottomBar: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E6ECE8',
  },
  secondaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: '#EDF2EE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#213B2A',
  },
  primaryBtn: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: '#213B2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtn: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: '#2D6A4F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
});