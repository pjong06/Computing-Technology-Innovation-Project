import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type * as ImagePicker from 'expo-image-picker';
import { pickImageFromLibrary, takePhotoWithCamera, type PickImageResult } from '../src/utils/imagePicker';
import { savePhotoPermanently, deleteStoredPhoto } from '../src/utils/photoStorage';
import Toast from 'react-native-toast-message';
import { useRecordStore, SyncStatus } from '../src/store/useRecordStore';
import { identifyPlant, IdentifyNetworkError, type SpeciesSuggestion } from '../src/services/identifyPlant';
import { formatCoordinates, describeAccuracy } from '../src/utils/formatCoordinates';
import FormScrollView from '../src/components/FormScrollView';
import KeyboardDoneBar from '../src/components/KeyboardDoneBar';

const DONE_BAR_ID = 'new-record-done';

const PHOTO_SLOTS = ['Whole plant', 'Leaf', 'Flower', 'Bark'] as const;
type PhotoSlot = (typeof PHOTO_SLOTS)[number];
type SlotPhotos = Record<PhotoSlot, ImagePicker.ImagePickerAsset | null>;

interface GpsFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}
type GpsStatus = 'acquiring' | 'ready' | 'unavailable' | 'timeout';

const GPS_TIMEOUT_MS = 20_000;

class GpsTimeoutError extends Error {}

// Rejects if the device hasn't produced a fix in time. The underlying request
// keeps running, but its late result is ignored (see isCurrent in fetchLocation).
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

type FieldErrors = Partial<Record<'photos' | 'scientificName' | 'locationName' | 'gps', string>>;

export default function NewRecordScreen() {
  const router = useRouter();
  const addRecord = useRecordStore((state) => state.addRecord);

  const [photos, setPhotos] = useState<SlotPhotos>({
    'Whole plant': null,
    Leaf: null,
    Flower: null,
    Bark: null,
  });

  const [scientificName, setScientificName] = useState('');
  const [commonName, setCommonName] = useState('');
  const [family, setFamily] = useState('');
  const [height, setHeight] = useState('');
  const [morphology, setMorphology] = useState('');
  const [locationName, setLocationName] = useState('');
  const [gpsFix, setGpsFix] = useState<GpsFix | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('acquiring');
  const [gpsError, setGpsError] = useState('');
  const screenActive = useRef(true);
  const gpsRequestId = useRef(0);

  // Lets the keyboard's "next" key move through the form in order.
  const commonNameRef = useRef<TextInput>(null);
  const familyRef = useRef<TextInput>(null);
  const heightRef = useRef<TextInput>(null);

  const [errors, setErrors] = useState<FieldErrors>({});
  const clearError = (field: keyof FieldErrors) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const identifyRequest = useRef<AbortController | null>(null);
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([]);
  const [selectedSpecies, setSelectedSpecies] = useState<SpeciesSuggestion | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identifyMessage, setIdentifyMessage] = useState('');

  // The backend identifies from one photo, so use the first filled slot.
  const identifySlot = PHOTO_SLOTS.find((slot) => photos[slot] !== null);
  const identifyPhoto = identifySlot ? photos[identifySlot] : null;

  // Photos are copied to permanent storage as soon as they're picked. If the user
  // leaves without saving, those copies are deleted so no orphan files pile up.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const recordSaved = useRef(false);

  useEffect(() => {
    screenActive.current = true;
    fetchLocation();

    return () => {
      screenActive.current = false;
      identifyRequest.current?.abort();
      identifyRequest.current = null;
      if (!recordSaved.current) {
        PHOTO_SLOTS.forEach((slot) => deleteStoredPhoto(photosRef.current[slot]?.uri));
      }
    };
  }, []);

  const fetchLocation = async () => {
    // Only the latest request may update state, so a slow earlier fix can't overwrite a newer one.
    const requestId = ++gpsRequestId.current;
    const isCurrent = () => screenActive.current && requestId === gpsRequestId.current;

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
      if (!(await Location.hasServicesEnabledAsync())) {
        markUnavailable('Location services are turned off on this device.');
        return;
      }

      const loc = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        GPS_TIMEOUT_MS
      );
      if (!isCurrent()) return;

      setGpsFix({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracyM: loc.coords.accuracy ?? null,
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

  // Drop the AI fields a suggestion filled in, unless the user has since edited them.
  const clearSuggestionFields = () => {
    if (!selectedSpecies) return;
    const { scientificName: name, commonName: common, family: fam } = selectedSpecies;
    setScientificName((value) => (value === name ? '' : value));
    if (common) setCommonName((value) => (value === common ? '' : value));
    if (fam) setFamily((value) => (value === fam ? '' : value));
  };

  // Setting or removing any photo invalidates the AI suggestions for the old one.
  const setSlotPhoto = (slot: PhotoSlot, asset: ImagePicker.ImagePickerAsset | null) => {
    identifyRequest.current?.abort();
    identifyRequest.current = null;
    clearSuggestionFields();

    // Replacing or removing a photo deletes the permanent copy of the old one.
    const previous = photosRef.current[slot];
    if (previous && previous.uri !== asset?.uri) deleteStoredPhoto(previous.uri);

    setPhotos((prev) => ({ ...prev, [slot]: asset }));
    if (asset) clearError('photos');
    setSuggestions([]);
    setSelectedSpecies(null);
    setIdentifyMessage('');
    setIdentifying(false);
  };

  // Photo source choice is shown inline under the grid (not in an Alert),
  // so the picker is never presented while a native alert is closing.
  const [activeSlot, setActiveSlot] = useState<PhotoSlot | null>(null);

  const handlePickResult = async (slot: PhotoSlot, result: PickImageResult) => {
    if (result.status === 'picked') {
      let permanentUri: string;
      try {
        permanentUri = await savePhotoPermanently(result.asset.uri);
      } catch {
        Toast.show({ type: 'error', text1: 'Photo not saved', text2: 'The photo could not be stored on this device.' });
        return;
      }
      if (!screenActive.current) {
        deleteStoredPhoto(permanentUri); // user left the screen while the copy was running
        return;
      }
      // Keep the picker's metadata (size, type, name) but point at the permanent copy.
      setSlotPhoto(slot, { ...result.asset, uri: permanentUri });
      setActiveSlot(null);
    } else if (result.status === 'permission-denied') {
      Toast.show({
        type: 'error',
        text1: 'Camera permission needed',
        text2: 'Allow camera access for Expo Go in Settings.',
      });
    } else if (result.status === 'error') {
      Toast.show({ type: 'error', text1: 'Could not open', text2: 'The camera or photo library could not be opened.' });
    }
  };

  const takePhoto = async (slot: PhotoSlot) => handlePickResult(slot, await takePhotoWithCamera());
  const choosePhoto = async (slot: PhotoSlot) => handlePickResult(slot, await pickImageFromLibrary());

  const removePhoto = (slot: PhotoSlot) => {
    setSlotPhoto(slot, null);
    setActiveSlot(null);
  };

  const handleIdentify = async () => {
    if (!identifyPhoto || identifying) return;

    const request = new AbortController();
    identifyRequest.current = request;

    setIdentifying(true);
    setIdentifyMessage('');
    setSuggestions([]);
    clearSuggestionFields();
    setSelectedSpecies(null);

    try {
      const nextSuggestions = await identifyPlant(identifyPhoto, request.signal);
      if (request.signal.aborted) return;

      setSuggestions(nextSuggestions);
      if (nextSuggestions.length === 0) {
        setIdentifyMessage('No match found. Enter the scientific name manually or try another photo.');
      }
    } catch (error) {
      if (request.signal.aborted) return;

      if (error instanceof IdentifyNetworkError) {
        setIdentifyMessage(
          "Can't reach the server - you may be offline. Enter the scientific name manually, or try again when connected."
        );
      } else {
        setIdentifyMessage(error instanceof Error ? error.message : 'Identification failed. Please try again.');
      }
    } finally {
      if (identifyRequest.current === request) {
        identifyRequest.current = null;
        setIdentifying(false);
      }
    }
  };

  const selectSuggestion = (suggestion: SpeciesSuggestion) => {
    clearSuggestionFields(); // undo the previously selected suggestion first
    setSelectedSpecies(suggestion);
    setScientificName(suggestion.scientificName);
    // Only overwrite what the suggestion actually knows; keep anything the user typed otherwise.
    if (suggestion.commonName) setCommonName(suggestion.commonName);
    if (suggestion.family) setFamily(suggestion.family);
    clearError('scientificName');
  };

  const handleScientificNameChange = (value: string) => {
    setScientificName(value);
    setSelectedSpecies(null);
    clearError('scientificName');
  };

  const handleLocationNameChange = (value: string) => {
    setLocationName(value);
    clearError('locationName');
  };

  const handleSave = () => {
    const photoList = PHOTO_SLOTS.map((slot) => photos[slot]?.uri).filter(Boolean) as string[];

    const nextErrors: FieldErrors = {};
    if (photoList.length === 0) nextErrors.photos = 'Add at least one photo.';
    if (!scientificName.trim()) nextErrors.scientificName = 'Enter the scientific name, or pick an AI suggestion.';
    if (!locationName.trim()) nextErrors.locationName = 'Enter a location name.';
    if (!gpsFix) nextErrors.gps = 'A GPS fix is required. Wait for it, or tap the GPS card to retry.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !gpsFix) return;

    const saved = addRecord({
      scientificName: scientificName.trim(),
      commonName: commonName.trim(),
      family: family.trim(),
      height: height.trim() || undefined,
      morphology: morphology.trim() || undefined,
      locationName: locationName.trim(),
      latitude: gpsFix.latitude,
      longitude: gpsFix.longitude,
      gpsAccuracyM: gpsFix.accuracyM,
      gpsCoordination: formatCoordinates(gpsFix.latitude, gpsFix.longitude, gpsFix.accuracyM),
      photoUris: photoList,
      syncStatus: SyncStatus.NOT_UPLOADED,
    });

    recordSaved.current = true; // the record now owns the stored photos
    router.replace({ pathname: '/save-confirm', params: { id: saved.id } } as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navSide}>
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>New Plant Record</Text>
        <View style={styles.navSide} />
      </View>

      <FormScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>PHOTOS *</Text>
          <Text style={styles.sectionSubLabel}>min. 1 required</Text>
        </View>

        <View style={styles.photoGrid}>
          {PHOTO_SLOTS.map((slot) => {
            const asset = photos[slot];
            return (
              <TouchableOpacity
                key={slot}
                style={[styles.photoBox, activeSlot === slot && styles.photoBoxActive]}
                onPress={() => setActiveSlot((current) => (current === slot ? null : slot))}
              >
                {asset ? (
                  <Image source={{ uri: asset.uri }} style={styles.photoThumb} />
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 24 }}>📷</Text>
                    <Text style={styles.photoSlotText}>{slot}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {activeSlot && (
          <View style={styles.sourcePanel}>
            <Text style={styles.sourceTitle}>{activeSlot} photo</Text>
            <View style={styles.sourceRow}>
              <TouchableOpacity style={styles.sourceBtn} activeOpacity={0.85} onPress={() => takePhoto(activeSlot)}>
                <Text style={styles.sourceBtnText}>Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sourceBtn} activeOpacity={0.85} onPress={() => choosePhoto(activeSlot)}>
                <Text style={styles.sourceBtnText}>Choose from gallery</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.sourceRow}>
              {photos[activeSlot] && (
                <TouchableOpacity onPress={() => removePhoto(activeSlot)} hitSlop={8}>
                  <Text style={styles.sourceRemove}>Remove photo</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setActiveSlot(null)} hitSlop={8} style={styles.sourceCancel}>
                <Text style={styles.sourceCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {errors.photos && <Text style={styles.errorText}>{errors.photos}</Text>}

        {identifyPhoto && (
          <View style={styles.aiSection}>
            <TouchableOpacity
              style={[styles.identifyBtn, identifying && styles.disabledBtn]}
              activeOpacity={0.85}
              onPress={handleIdentify}
              disabled={identifying}
            >
              {identifying ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text style={styles.identifyBtnText}>Analysing photo...</Text>
                </View>
              ) : (
                <Text style={styles.identifyBtnText}>Get AI species suggestions</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.aiHint}>Uses your {identifySlot?.toLowerCase()} photo</Text>

            {identifyMessage !== '' && <Text style={styles.identifyMessage}>{identifyMessage}</Text>}

            {suggestions.length > 0 && (
              <View style={styles.suggestionsBlock}>
                <Text style={styles.suggestionsTitle}>AI species suggestions</Text>
                <Text style={styles.suggestionsHelp}>Tap one to fill in the details, or enter the name manually.</Text>

                {suggestions.map((suggestion) => {
                  const selected =
                    selectedSpecies?.rank === suggestion.rank &&
                    selectedSpecies.scientificName === suggestion.scientificName;

                  return (
                    <TouchableOpacity
                      key={`${suggestion.rank}-${suggestion.scientificName}`}
                      style={[styles.suggestionCard, selected && styles.selectedSuggestionCard]}
                      onPress={() => selectSuggestion(suggestion)}
                    >
                      <View style={styles.suggestionHeader}>
                        <Text style={styles.suggestionName}>
                          {suggestion.rank}. {suggestion.scientificName}
                        </Text>
                        <Text style={styles.confidence}>{suggestion.confidence.toFixed(1)}%</Text>
                      </View>
                      {suggestion.commonName && (
                        <Text style={styles.suggestionDetail}>Common name: {suggestion.commonName}</Text>
                      )}
                      {suggestion.family && <Text style={styles.suggestionDetail}>Family: {suggestion.family}</Text>}
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

        <Text style={styles.sectionLabel}>SPECIES DETAILS</Text>
        <Text style={styles.fieldLabel}>Scientific name *</Text>
        <TextInput
          style={[styles.input, errors.scientificName && styles.inputError]}
          placeholder="e.g. Nepenthes ampullaria"
          placeholderTextColor="#8C9A91"
          value={scientificName}
          onChangeText={handleScientificNameChange}
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => commonNameRef.current?.focus()}
        />
        {errors.scientificName && <Text style={styles.errorText}>{errors.scientificName}</Text>}

        <Text style={styles.fieldLabel}>Common name</Text>
        <TextInput
          ref={commonNameRef}
          style={styles.input}
          placeholder="e.g. Pitcher plant"
          placeholderTextColor="#8C9A91"
          value={commonName}
          onChangeText={setCommonName}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => familyRef.current?.focus()}
        />

        <Text style={styles.fieldLabel}>Family</Text>
        <TextInput
          ref={familyRef}
          style={styles.input}
          placeholder="e.g. Nepenthaceae"
          placeholderTextColor="#8C9A91"
          value={family}
          onChangeText={setFamily}
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => heightRef.current?.focus()}
        />

        <Text style={styles.fieldLabel}>Height / diameter (m)</Text>
        <TextInput
          ref={heightRef}
          style={styles.input}
          placeholder="e.g. 0.4"
          placeholderTextColor="#8C9A91"
          keyboardType="decimal-pad"
          value={height}
          onChangeText={setHeight}
          inputAccessoryViewID={DONE_BAR_ID}
        />

        <Text style={styles.fieldLabel}>Morphological characteristics</Text>
        <TextInput
          style={[styles.input, { height: 76, textAlignVertical: 'top' }]}
          placeholder="Squat, round lower pitchers in a ground carpet..."
          placeholderTextColor="#8C9A91"
          multiline
          value={morphology}
          onChangeText={setMorphology}
          inputAccessoryViewID={DONE_BAR_ID}
        />

        <Text style={styles.sectionLabel}>LOCATION</Text>
        <Text style={styles.fieldLabel}>Location name *</Text>
        <TextInput
          style={[styles.input, errors.locationName && styles.inputError]}
          placeholder="e.g. Cave entrance area"
          placeholderTextColor="#8C9A91"
          value={locationName}
          onChangeText={handleLocationNameChange}
          returnKeyType="done"
        />
        {errors.locationName && <Text style={styles.errorText}>{errors.locationName}</Text>}

        <Text style={styles.fieldLabel}>GPS coordinates *</Text>
        {gpsStatus === 'acquiring' && (
          <View style={styles.gpsCard}>
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#213B2A" />
              <Text style={styles.gpsStatusPending}>Acquiring GPS fix...</Text>
            </View>
            <Text style={styles.gpsDetails}>This can take longer under dense canopy. Gives up after 20 seconds.</Text>
            <TouchableOpacity style={styles.refreshGpsBtn} onPress={fetchLocation}>
              <Text style={styles.refreshGpsBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {gpsStatus === 'timeout' && (
          <View style={[styles.gpsCard, styles.gpsCardError]}>
            <Text style={styles.gpsStatusError}>Couldn't get a GPS fix – move to an open spot</Text>
            <Text style={styles.gpsDetails}>No fix after 20 seconds. Step away from dense canopy or rock walls, then retry.</Text>
            <TouchableOpacity style={styles.refreshGpsBtn} onPress={fetchLocation}>
              <Text style={styles.refreshGpsBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {gpsStatus === 'unavailable' && (
          <TouchableOpacity style={[styles.gpsCard, styles.gpsCardError]} activeOpacity={0.8} onPress={fetchLocation}>
            <Text style={styles.gpsStatusError}>GPS unavailable – tap to retry</Text>
            {gpsError !== '' && <Text style={styles.gpsDetails}>{gpsError}</Text>}
          </TouchableOpacity>
        )}

        {gpsStatus === 'ready' && gpsFix && (
          <View style={styles.gpsCard}>
            <Text style={styles.gpsStatusBadge}>{describeAccuracy(gpsFix.accuracyM)}</Text>
            <Text style={styles.gpsCoords}>{formatCoordinates(gpsFix.latitude, gpsFix.longitude, null)}</Text>
            <Text style={styles.gpsDetails}>
              {gpsFix.accuracyM === null
                ? 'The device did not report accuracy for this fix.'
                : `Accuracy ±${Math.round(gpsFix.accuracyM)} m`}
            </Text>
            <TouchableOpacity style={styles.refreshGpsBtn} onPress={fetchLocation}>
              <Text style={styles.refreshGpsBtnText}>Update to current location</Text>
            </TouchableOpacity>
          </View>
        )}
        {errors.gps && !gpsFix && <Text style={[styles.errorText, styles.gpsErrorText]}>{errors.gps}</Text>}

        {Object.values(errors).some(Boolean) && (
          <Text style={styles.errorSummary}>Fix the highlighted fields above to save.</Text>
        )}

        <TouchableOpacity style={styles.saveBtn} activeOpacity={0.85} onPress={handleSave}>
          <Text style={styles.saveBtnText}>Save record</Text>
        </TouchableOpacity>
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
  backChevron: { fontSize: 32, color: '#213B2A' },
  navTitle: { fontSize: 17, fontWeight: '700', color: '#1E2B22' },
  navSide: { width: 40 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  sectionLabel: { fontSize: 11.5, fontWeight: '800', color: '#7D8C81', letterSpacing: 0.8 },
  sectionSubLabel: { fontSize: 11.5, color: '#88988D' },
  photoGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  photoBox: {
    width: '23%',
    height: 80,
    borderRadius: 14,
    backgroundColor: '#E8EFEA',
    borderWidth: 1,
    borderColor: '#D4E2D8',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  photoBoxActive: { borderColor: '#213B2A', borderWidth: 2 },
  photoThumb: { width: '100%', height: '100%' },
  sourcePanel: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1.2, borderColor: '#E6ECE8', padding: 14, marginBottom: 14 },
  sourceTitle: { fontSize: 13, fontWeight: '700', color: '#213B2A', marginBottom: 10 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceBtn: { flex: 1, height: 44, borderRadius: 22, backgroundColor: '#213B2A', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  sourceBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  sourceRemove: { color: '#9B1C1C', fontWeight: '700', fontSize: 13 },
  sourceCancel: { marginLeft: 'auto' },
  sourceCancelText: { color: '#4E6254', fontWeight: '700', fontSize: 13 },
  photoSlotText: { fontSize: 10, fontWeight: '600', color: '#3A5243', marginTop: 4 },
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
  gpsStatusBadge: { color: '#215A36', fontWeight: '700', fontSize: 12, marginBottom: 4 },
  gpsStatusPending: { color: '#213B2A', fontWeight: '700', fontSize: 13 },
  gpsStatusError: { color: '#9B1C1C', fontWeight: '700', fontSize: 14, marginBottom: 4 },
  gpsCoords: { fontSize: 14, fontWeight: '800', color: '#1E2B22', marginBottom: 4 },
  gpsDetails: { fontSize: 11.5, color: '#7E8F83', marginBottom: 12 },
  refreshGpsBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#EDF5EF',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  refreshGpsBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 12 },
  saveBtn: {
    backgroundColor: '#213B2A',
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});
