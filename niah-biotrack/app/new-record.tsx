import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { useRecordStore, RecordStatus } from '../src/store/useRecordStore';
import { identifyPlant, IdentifyNetworkError, type SpeciesSuggestion } from '../src/services/identifyPlant';
import { formatCoordinates, describeAccuracy } from '../src/utils/formatCoordinates';

const PHOTO_SLOTS = ['Whole plant', 'Leaf', 'Flower', 'Bark'] as const;
type PhotoSlot = (typeof PHOTO_SLOTS)[number];
type SlotPhotos = Record<PhotoSlot, ImagePicker.ImagePickerAsset | null>;

interface GpsFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}
type GpsStatus = 'acquiring' | 'ready' | 'unavailable';

type FieldErrors = Partial<Record<'photos' | 'scientificName' | 'locationName' | 'gps', string>>;

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [4, 3],
  quality: 0.8,
};

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

  useEffect(() => {
    screenActive.current = true;
    fetchLocation();

    return () => {
      screenActive.current = false;
      identifyRequest.current?.abort();
      identifyRequest.current = null;
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

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (!isCurrent()) return;

      setGpsFix({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracyM: loc.coords.accuracy ?? null,
      });
      setGpsStatus('ready');
      clearError('gps');
    } catch {
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

  const applyPhoto = (slot: PhotoSlot, asset: ImagePicker.ImagePickerAsset) => {
    // Suggestions belong to the old photo, so cancel any request and reset them.
    identifyRequest.current?.abort();
    identifyRequest.current = null;
    clearSuggestionFields();

    setPhotos((prev) => ({ ...prev, [slot]: asset }));
    clearError('photos');
    setSuggestions([]);
    setSelectedSpecies(null);
    setIdentifyMessage('');
    setIdentifying(false);
  };

  const takePhoto = async (slot: PhotoSlot) => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Toast.show({
          type: 'error',
          text1: 'Camera permission needed',
          text2: 'Allow camera access to take a plant photo.',
        });
        return;
      }
      const res = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
      if (!res.canceled && res.assets?.[0]) {
        applyPhoto(slot, res.assets[0]);
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Camera unavailable', text2: 'The camera could not be opened.' });
    }
  };

  const choosePhoto = async (slot: PhotoSlot) => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
      if (!res.canceled && res.assets?.[0]) {
        applyPhoto(slot, res.assets[0]);
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Photos unavailable', text2: 'The photo library could not be opened.' });
    }
  };

  const pickPhotoForSlot = (slot: PhotoSlot) => {
    Alert.alert('Attach Photo', `Select image source for ${slot}`, [
      { text: 'Camera', onPress: () => takePhoto(slot) },
      { text: 'Gallery', onPress: () => choosePhoto(slot) },
      { text: 'Cancel', style: 'cancel' },
    ]);
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

    const recordId = `NP-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const saved = addRecord({
      recordId,
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
      status: RecordStatus.PENDING,
    });

    router.replace({ pathname: '/save-confirm', params: { id: saved.recordId } } as any);
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

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>PHOTOS *</Text>
          <Text style={styles.sectionSubLabel}>min. 1 required</Text>
        </View>

        <View style={styles.photoGrid}>
          {PHOTO_SLOTS.map((slot) => {
            const asset = photos[slot];
            return (
              <TouchableOpacity key={slot} style={styles.photoBox} onPress={() => pickPhotoForSlot(slot)}>
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
        />
        {errors.scientificName && <Text style={styles.errorText}>{errors.scientificName}</Text>}

        <Text style={styles.fieldLabel}>Common name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Pitcher plant"
          placeholderTextColor="#8C9A91"
          value={commonName}
          onChangeText={setCommonName}
        />

        <Text style={styles.fieldLabel}>Family</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Nepenthaceae"
          placeholderTextColor="#8C9A91"
          value={family}
          onChangeText={setFamily}
        />

        <Text style={styles.fieldLabel}>Height / diameter (m)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 0.4"
          placeholderTextColor="#8C9A91"
          keyboardType="numeric"
          value={height}
          onChangeText={setHeight}
        />

        <Text style={styles.fieldLabel}>Morphological characteristics</Text>
        <TextInput
          style={[styles.input, { height: 76, textAlignVertical: 'top' }]}
          placeholder="Squat, round lower pitchers in a ground carpet..."
          placeholderTextColor="#8C9A91"
          multiline
          value={morphology}
          onChangeText={setMorphology}
        />

        <Text style={styles.sectionLabel}>LOCATION</Text>
        <Text style={styles.fieldLabel}>Location name *</Text>
        <TextInput
          style={[styles.input, errors.locationName && styles.inputError]}
          placeholder="e.g. Cave entrance area"
          placeholderTextColor="#8C9A91"
          value={locationName}
          onChangeText={handleLocationNameChange}
        />
        {errors.locationName && <Text style={styles.errorText}>{errors.locationName}</Text>}

        <Text style={styles.fieldLabel}>GPS coordinates *</Text>
        {gpsStatus === 'acquiring' && (
          <View style={styles.gpsCard}>
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#213B2A" />
              <Text style={styles.gpsStatusPending}>Acquiring GPS fix...</Text>
            </View>
            <Text style={styles.gpsDetails}>This can take longer under dense canopy.</Text>
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
  photoThumb: { width: '100%', height: '100%' },
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
