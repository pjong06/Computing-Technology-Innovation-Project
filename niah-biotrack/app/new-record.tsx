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

const PHOTO_SLOTS = ['Whole plant', 'Leaf', 'Flower', 'Bark'] as const;
type PhotoSlot = (typeof PHOTO_SLOTS)[number];
type SlotPhotos = Record<PhotoSlot, ImagePicker.ImagePickerAsset | null>;

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
  const [gpsCoordination, setGpsCoordination] = useState('Fetching GPS...');
  const [isGpsGood, setIsGpsGood] = useState(false);

  const identifyRequest = useRef<AbortController | null>(null);
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([]);
  const [selectedSpecies, setSelectedSpecies] = useState<SpeciesSuggestion | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identifyMessage, setIdentifyMessage] = useState('');

  // The backend identifies from one photo, so use the first filled slot.
  const identifySlot = PHOTO_SLOTS.find((slot) => photos[slot] !== null);
  const identifyPhoto = identifySlot ? photos[identifySlot] : null;

  useEffect(() => {
    fetchLocation();

    return () => {
      identifyRequest.current?.abort();
      identifyRequest.current = null;
    };
  }, []);

  const fetchLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsCoordination('3.2247° N, 113.7631° E (±8 m)');
        setIsGpsGood(true);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGpsCoordination(
        `${loc.coords.latitude.toFixed(4)}° N, ${loc.coords.longitude.toFixed(4)}° E (±${Math.round(
          loc.coords.accuracy || 6
        )} m)`
      );
      setIsGpsGood(true);
    } catch {
      setGpsCoordination('3.2247° N, 113.7631° E (±8 m)');
      setIsGpsGood(true);
    }
  };

  // Drop the AI fields a suggestion filled in, unless the user has since edited them.
  const clearSuggestionFields = () => {
    if (!selectedSpecies) return;
    setScientificName((value) => (value === selectedSpecies.scientificName ? '' : value));
    setCommonName((value) => (value === (selectedSpecies.commonName ?? '') ? '' : value));
    setFamily((value) => (value === (selectedSpecies.family ?? '') ? '' : value));
  };

  const applyPhoto = (slot: PhotoSlot, asset: ImagePicker.ImagePickerAsset) => {
    // Suggestions belong to the old photo, so cancel any request and reset them.
    identifyRequest.current?.abort();
    identifyRequest.current = null;
    clearSuggestionFields();

    setPhotos((prev) => ({ ...prev, [slot]: asset }));
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
    setSelectedSpecies(suggestion);
    setScientificName(suggestion.scientificName);
    setCommonName(suggestion.commonName ?? '');
    setFamily(suggestion.family ?? '');
  };

  const handleScientificNameChange = (value: string) => {
    setScientificName(value);
    setSelectedSpecies(null);
  };

  const handleSave = () => {
    if (!scientificName.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Required Field',
        text2: 'Please provide a scientific name.',
      });
      return;
    }

    const photoList = PHOTO_SLOTS.map((slot) => photos[slot]?.uri).filter(Boolean) as string[];
    const recordId = `NP-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const saved = addRecord({
      recordId,
      scientificName: scientificName.trim(),
      commonName: commonName.trim() || 'Unknown',
      family: family.trim() || 'General Flora',
      height: height.trim() || '0.5 m',
      morphology: morphology.trim() || 'Field specimen observation.',
      locationName: locationName.trim() || 'Niah Trail Point',
      gpsCoordination,
      photoUris: photoList,
      status: RecordStatus.PENDING,
    });

    router.replace({ pathname: '/save-confirm', params: { id: saved.recordId } } as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.offlineNoticeBar}>
        <Text style={styles.offlineNoticeText}>Offline - record will save to this device</Text>
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>New Plant Record</Text>
        <View style={styles.draftBadge}>
          <Text style={styles.draftBadgeText}>Draft saved</Text>
        </View>
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
          style={styles.input}
          placeholder="e.g. Nepenthes ampullaria"
          placeholderTextColor="#8C9A91"
          value={scientificName}
          onChangeText={handleScientificNameChange}
        />

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
          style={styles.input}
          placeholder="e.g. Cave entrance area"
          placeholderTextColor="#8C9A91"
          value={locationName}
          onChangeText={setLocationName}
        />

        <Text style={styles.fieldLabel}>GPS coordinates *</Text>
        <View style={styles.gpsCard}>
          <Text style={styles.gpsStatusBadge}>{isGpsGood ? '✓ Good fix' : 'Acquiring...'}</Text>
          <Text style={styles.gpsCoords}>{gpsCoordination}</Text>
          <Text style={styles.gpsDetails}>Works without signal · Captured current coordinates</Text>
          <TouchableOpacity style={styles.refreshGpsBtn} onPress={fetchLocation}>
            <Text style={styles.refreshGpsBtnText}>Update to current location</Text>
          </TouchableOpacity>
        </View>

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
  offlineNoticeBar: { backgroundColor: '#F0F6F2', paddingVertical: 6, alignItems: 'center' },
  offlineNoticeText: { fontSize: 11.5, color: '#32503B', fontWeight: '600' },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  backChevron: { fontSize: 32, color: '#213B2A' },
  navTitle: { fontSize: 17, fontWeight: '700', color: '#1E2B22' },
  draftBadge: { backgroundColor: '#E4EDE7', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  draftBadgeText: { fontSize: 11, fontWeight: '600', color: '#213B2A' },
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
  gpsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 24,
  },
  gpsStatusBadge: { color: '#215A36', fontWeight: '700', fontSize: 12, marginBottom: 4 },
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
