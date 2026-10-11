import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';

import {
  useRecordStore,
  RecordStatus,
} from '../src/store/useRecordStore';

import {
  identifyPlant,
  type SpeciesSuggestion,
} from '../src/services/identifyPlant';

const FALLBACK_COORDINATES =
  '3.2247° N, 113.7631° E';

export default function NewRecordScreen() {
  const router = useRouter();

  const addRecord = useRecordStore(
    (state) => state.addRecord
  );

  const identifyRequest =
    useRef<AbortController | null>(null);

  const [
    scientificName,
    setScientificName,
  ] = useState('');

  const [
    locationName,
    setLocationName,
  ] = useState('');

  const [
    gpsCoordination,
    setGpsCoordination,
  ] = useState('Fetching...');

  const [photo, setPhoto] =
    useState<ImagePicker.ImagePickerAsset | null>(
      null
    );

  const [
    suggestions,
    setSuggestions,
  ] = useState<SpeciesSuggestion[]>([]);

  const [
    selectedSpecies,
    setSelectedSpecies,
  ] = useState<SpeciesSuggestion | null>(null);

  const [
    identifying,
    setIdentifying,
  ] = useState(false);

  const [
    identifyMessage,
    setIdentifyMessage,
  ] = useState('');

  useEffect(() => {
    let screenActive = true;

    async function loadLocation() {
      try {
        const permission =
          await Location.requestForegroundPermissionsAsync();

        if (!permission.granted) {
          if (screenActive) {
            setGpsCoordination(
              FALLBACK_COORDINATES
            );
          }

          return;
        }

        const location =
          await Location.getCurrentPositionAsync(
            {}
          );

        if (screenActive) {
          setGpsCoordination(
            `${location.coords.latitude.toFixed(
              4
            )}°, ${location.coords.longitude.toFixed(
              4
            )}°`
          );
        }
      } catch {
        if (screenActive) {
          setGpsCoordination(
            FALLBACK_COORDINATES
          );
        }
      }
    }

    loadLocation();

    return () => {
      screenActive = false;
      identifyRequest.current?.abort();
      identifyRequest.current = null;
    };
  }, []);

  function applyPhoto(
    asset: ImagePicker.ImagePickerAsset
  ) {
    identifyRequest.current?.abort();
    identifyRequest.current = null;

    if (selectedSpecies) {
      setScientificName('');
    }

    setPhoto(asset);
    setSuggestions([]);
    setSelectedSpecies(null);
    setIdentifyMessage('');
    setIdentifying(false);
  }

  async function takePhoto() {
    try {
      const permission =
        await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        Toast.show({
          type: 'error',
          text1:
            'Camera Permission Needed',
          text2:
            'Please allow camera access to take a plant photo.',
          position: 'top',
        });

        return;
      }

      const result =
        await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
        });

      if (
        !result.canceled &&
        result.assets?.[0]
      ) {
        applyPhoto(result.assets[0]);
      }
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Camera Unavailable',
        text2:
          'The camera could not be opened.',
        position: 'top',
      });
    }
  }

  async function choosePhoto() {
    try {
      const result =
        await ImagePicker.launchImageLibraryAsync(
          {
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
          }
        );

      if (
        !result.canceled &&
        result.assets?.[0]
      ) {
        applyPhoto(result.assets[0]);
      }
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Photos Unavailable',
        text2:
          'The photo library could not be opened.',
        position: 'top',
      });
    }
  }

  async function handleIdentify() {
    if (!photo || identifying) {
      return;
    }

    const request =
      new AbortController();

    identifyRequest.current = request;

    setIdentifying(true);
    setIdentifyMessage('');
    setSuggestions([]);

    if (selectedSpecies) {
      setScientificName('');
    }

    setSelectedSpecies(null);

    try {
      const nextSuggestions =
        await identifyPlant(
          photo,
          request.signal
        );

      if (request.signal.aborted) {
        return;
      }

      setSuggestions(nextSuggestions);

      if (
        nextSuggestions.length === 0
      ) {
        setIdentifyMessage(
          'No match found. Enter the scientific name manually or try another photo.'
        );
      }
    } catch (error) {
      if (!request.signal.aborted) {
        setIdentifyMessage(
          error instanceof Error
            ? error.message
            : 'Identification failed. Please try again.'
        );
      }
    } finally {
      if (
        identifyRequest.current ===
        request
      ) {
        identifyRequest.current = null;
        setIdentifying(false);
      }
    }
  }

  function selectSuggestion(
    suggestion: SpeciesSuggestion
  ) {
    setSelectedSpecies(suggestion);

    setScientificName(
      suggestion.scientificName
    );
  }

  function handleScientificNameChange(
    value: string
  ) {
    setScientificName(value);
    setSelectedSpecies(null);
  }

  function handleSave() {
    const finalScientificName =
      scientificName.trim();

    if (!finalScientificName) {
      Toast.show({
        type: 'error',
        text1: 'Missing Information',
        text2:
          'Please enter or select a scientific name.',
        position: 'top',
      });

      return;
    }

    const recordId =
      `NB-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

    addRecord({
      recordId,

      scientificName:
        finalScientificName,

      commonName:
        selectedSpecies?.commonName ||
        'Field Specimen',

      family:
        selectedSpecies?.family ||
        'Unknown',

      locationName:
        locationName.trim() ||
        'Trail Point',

      gpsCoordination,
      photoUri: photo?.uri,
      status: RecordStatus.PENDING,
    });

    router.push({
      pathname: '/save-confirm',
      params: {
        recordId,
      },
    } as any);
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
    >
      <ScrollView
        contentContainerStyle={
          styles.container
        }
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          onPress={() => router.back()}
        >
          <Text style={styles.back}>
            ‹ Back
          </Text>
        </TouchableOpacity>

        <Text style={styles.title}>
          New Record
        </Text>

        <TouchableOpacity
          style={styles.photoBox}
          onPress={takePhoto}
        >
          {photo ? (
            <Image
              source={{
                uri: photo.uri,
              }}
              style={styles.photo}
              resizeMode="cover"
            />
          ) : (
            <Text>
              📷 Capture Photo
            </Text>
          )}
        </TouchableOpacity>

        <View
          style={styles.photoActions}
        >
          <TouchableOpacity
            style={
              styles.photoActionButton
            }
            onPress={takePhoto}
          >
            <Text
              style={
                styles.photoActionText
              }
            >
              Take Photo
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.photoActionButton
            }
            onPress={choosePhoto}
          >
            <Text
              style={
                styles.photoActionText
              }
            >
              Choose Photo
            </Text>
          </TouchableOpacity>
        </View>

        {photo && (
          <TouchableOpacity
            style={[
              styles.identifyButton,

              identifying &&
                styles.disabledButton,
            ]}
            onPress={handleIdentify}
            disabled={identifying}
          >
            {identifying ? (
              <View
                style={
                  styles.loadingRow
                }
              >
                <ActivityIndicator
                  color="#FFFFFF"
                />

                <Text
                  style={styles.btnText}
                >
                  Analysing Photo...
                </Text>
              </View>
            ) : (
              <Text
                style={styles.btnText}
              >
                Get AI Species
                Suggestions
              </Text>
            )}
          </TouchableOpacity>
        )}

        {identifyMessage !== '' && (
          <Text
            style={
              styles.identifyMessage
            }
          >
            {identifyMessage}
          </Text>
        )}

        {suggestions.length > 0 && (
          <View
            style={
              styles.suggestionsSection
            }
          >
            <Text
              style={
                styles.suggestionsTitle
              }
            >
              AI Species Suggestions
            </Text>

            <Text
              style={
                styles.suggestionsHelp
              }
            >
              Select one suggestion, or
              enter the scientific name
              manually.
            </Text>

            {suggestions.map(
              (suggestion) => {
                const selected =
                  selectedSpecies?.rank ===
                    suggestion.rank &&
                  selectedSpecies
                    .scientificName ===
                    suggestion.scientificName;

                return (
                  <TouchableOpacity
                    key={`${suggestion.rank}-${suggestion.scientificName}`}
                    style={[
                      styles.suggestionCard,

                      selected &&
                        styles.selectedSuggestionCard,
                    ]}
                    onPress={() =>
                      selectSuggestion(
                        suggestion
                      )
                    }
                  >
                    <View
                      style={
                        styles.suggestionHeader
                      }
                    >
                      <Text
                        style={
                          styles.suggestionName
                        }
                      >
                        {suggestion.rank}.{' '}
                        {
                          suggestion.scientificName
                        }
                      </Text>

                      <Text
                        style={
                          styles.confidence
                        }
                      >
                        {suggestion.confidence.toFixed(
                          1
                        )}
                        %
                      </Text>
                    </View>

                    {suggestion.commonName && (
                      <Text
                        style={
                          styles.suggestionDetail
                        }
                      >
                        Common name:{' '}
                        {
                          suggestion.commonName
                        }
                      </Text>
                    )}

                    {suggestion.family && (
                      <Text
                        style={
                          styles.suggestionDetail
                        }
                      >
                        Family:{' '}
                        {
                          suggestion.family
                        }
                      </Text>
                    )}

                    <Text
                      style={
                        styles.suggestionDetail
                      }
                    >
                      Confidence:{' '}
                      {
                        suggestion.confidenceLevel
                      }
                      {selected
                        ? ' · Selected'
                        : ''}
                    </Text>
                  </TouchableOpacity>
                );
              }
            )}
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder="Scientific Name"
          value={scientificName}
          onChangeText={
            handleScientificNameChange
          }
        />

        <TextInput
          style={styles.input}
          placeholder="Location"
          value={locationName}
          onChangeText={
            setLocationName
          }
        />

        <Text style={styles.gps}>
          📍 {gpsCoordination}
        </Text>

        <TouchableOpacity
          style={styles.btn}
          onPress={handleSave}
        >
          <Text style={styles.btnText}>
            Save
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',

    paddingTop:
      Platform.OS === 'android'
        ? StatusBar.currentHeight
        : 0,
  },

  container: {
    padding: 22,
    paddingBottom: 40,
  },

  back: {
    fontSize: 18,
    color: '#213B2A',
    marginBottom: 10,
  },

  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#213B2A',
    marginBottom: 20,
  },

  photoBox: {
    height: 160,
    backgroundColor: '#E7EFEA',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },

  photo: {
    width: '100%',
    height: '100%',
  },

  photoActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },

  photoActionButton: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#213B2A',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },

  photoActionText: {
    color: '#213B2A',
    fontWeight: 'bold',
  },

  identifyButton: {
    backgroundColor: '#46654F',
    minHeight: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 16,
  },

  disabledButton: {
    opacity: 0.65,
  },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  identifyMessage: {
    color: '#7A5134',
    lineHeight: 20,
    marginBottom: 14,
    paddingHorizontal: 8,
  },

  suggestionsSection: {
    marginBottom: 16,
  },

  suggestionsTitle: {
    color: '#213B2A',
    fontSize: 17,
    fontWeight: 'bold',
    marginBottom: 4,
  },

  suggestionsHelp: {
    color: '#68776D',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },

  suggestionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6ECE8',
    padding: 14,
    marginBottom: 10,
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
    color: '#213B2A',
    fontSize: 15,
    fontWeight: 'bold',
  },

  confidence: {
    color: '#46654F',
    fontWeight: 'bold',
  },

  suggestionDetail: {
    color: '#68776D',
    fontSize: 13,
    marginTop: 4,
  },

  input: {
    backgroundColor: '#FFFFFF',
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#E6ECE8',
    marginBottom: 14,
  },

  gps: {
    color: '#68776D',
    marginBottom: 30,
    paddingHorizontal: 10,
  },

  btn: {
    backgroundColor: '#213B2A',
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },

  btnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});