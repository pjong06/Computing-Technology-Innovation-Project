import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { supabase } from '../src/lib/supabase';
import { useAuthRole } from '../src/context/AuthRoleContext';

const LIFE_STAGES = ['Seedling', 'Sapling', 'Pole', 'Mature', 'Senescent'];
const HEALTH_STATUSES = [
  { label: 'Healthy', color: '#2D6A4F', bg: '#E8F5E9', border: '#A3D9A5' },
  { label: 'Stressed', color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
  { label: 'Diseased', color: '#DC2626', bg: '#FEE2E2', border: '#FCA5A5' },
  { label: 'Damaged', color: '#7C3AED', bg: '#F3E8FF', border: '#D8B4FE' },
  { label: 'Dead', color: '#4B5563', bg: '#F3F4F6', border: '#D1D5DB' },
];

export default function AddObservationScreen() {
  const router = useRouter();
  const { isVisitor } = useAuthRole();
  const params = useLocalSearchParams<{ plantId?: string; tagCode?: string; scientificName?: string }>();

  // Guard against visitor write attempts
  useEffect(() => {
    if (isVisitor) {
      Alert.alert(
        'Botanist Access Required',
        'Visitor accounts are read-only. Logging observations requires staff credentials.',
        [{ text: 'OK', onPress: () => router.replace('/(tabs)/home') }]
      );
    }
  }, [isVisitor]);

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLocating, setIsLocating] = useState<boolean>(false);

  const [plantTag, setPlantTag] = useState<string>(params.tagCode || '');
  const [plantId, setPlantId] = useState<string>(params.plantId || '');
  const [scientificName, setScientificName] = useState<string>(params.scientificName || '');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);

  const [heightCm, setHeightCm] = useState<string>('120');
  const [diameterCm, setDiameterCm] = useState<string>('15.5');
  const [lifeStage, setLifeStage] = useState<string>('Mature');
  const [healthStatus, setHealthStatus] = useState<string>('Healthy');

  const [photos, setPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (!isVisitor) {
      fetchCurrentLocation();
    }
  }, [isVisitor]);

  const fetchCurrentLocation = async () => {
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Toast.show({
          type: 'error',
          text1: 'GPS Permission Denied',
          text2: 'Enable location services to register field coordinates.',
        });
        setIsLocating(false);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      setLatitude(Number(loc.coords.latitude.toFixed(6)));
      setLongitude(Number(loc.coords.longitude.toFixed(6)));
      setGpsAccuracy(Math.round(loc.coords.accuracy || 0));
    } catch (err: any) {
      Toast.show({
        type: 'error',
        text1: 'GPS Fix Failed',
        text2: err.message || 'Unable to retrieve location.',
      });
    } finally {
      setIsLocating(false);
    }
  };

  const adjustValue = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    delta: number,
    isFloat = false
  ) => {
    setter((prev) => {
      const current = parseFloat(prev) || 0;
      const updated = Math.max(0, current + delta);
      return isFloat ? updated.toFixed(1) : Math.round(updated).toString();
    });
  };

  const handlePickPhoto = async () => {
    if (photos.length >= 4) {
      Alert.alert('Maximum Limit', 'You can attach up to 4 photos per observation.');
      return;
    }

    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Denied', 'Camera permission is required to capture field evidence.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      aspect: [4, 3],
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setPhotos((prev) => [...prev, result.assets[0].uri]);
    }
  };

  const handleRemovePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleNextStep = () => {
    if (currentStep === 1) {
      if (!plantTag.trim() && !plantId) {
        Toast.show({
          type: 'error',
          text1: 'Tag Required',
          text2: 'Scan or input a plant tag identifier.',
        });
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!heightCm || !diameterCm) {
        Toast.show({
          type: 'error',
          text1: 'Measurements Required',
          text2: 'Enter height and diameter values.',
        });
        return;
      }
      setCurrentStep(3);
    }
  };

  const handleSaveObservation = async () => {
    setIsSubmitting(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const observerId = authData?.user?.id || null;

      const recordPayload = {
        plant_id: plantId || null,
        observer_id: observerId,
        observed_at: new Date().toISOString(),
        height_cm: parseFloat(heightCm) || null,
        diameter_cm: parseFloat(diameterCm) || null,
        life_stage: lifeStage,
        health_status: healthStatus,
        gps_accuracy_m: gpsAccuracy,
        notes: notes.trim() || null,
        photo: photos[0] || null,
        location: latitude && longitude ? `POINT(${longitude} ${latitude})` : null,
      };

      const { error } = await supabase.from('observations').insert([recordPayload]);

      if (error) {
        throw error;
      }

      Toast.show({
        type: 'success',
        text1: 'Observation Logged',
        text2: 'Record successfully synced to database.',
      });

      router.replace('/(tabs)/home');
    } catch (err: any) {
      Toast.show({
        type: 'error',
        text1: 'Save Failed',
        text2: err.message || 'Could not record observation.',
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
          onPress={() => (currentStep > 1 ? setCurrentStep(currentStep - 1) : router.back())}
        >
          <Text style={styles.headerBackText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Add Observation</Text>
          <Text style={styles.headerSub}>Step {currentStep} of 3</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Stepper Progress Bar */}
      <View style={styles.stepperContainer}>
        {[1, 2, 3].map((step) => (
          <View key={step} style={styles.stepTrackWrapper}>
            <View
              style={[
                styles.stepTrack,
                step <= currentStep ? styles.stepTrackActive : styles.stepTrackInactive,
              ]}
            />
            <Text
              style={[
                styles.stepTrackLabel,
                step === currentStep && styles.stepTrackLabelActive,
              ]}
            >
              {step === 1 ? 'Location' : step === 2 ? 'Metrics' : 'Evidence'}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* STEP 1: Identification & GPS */}
        {currentStep === 1 && (
          <View style={styles.stepContent}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardIcon}>🏷️</Text>
                <Text style={styles.cardTitle}>Plant Identification</Text>
              </View>

              <Text style={styles.fieldLabel}>Plant Tag Code</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. TR-2026-089"
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

            <View style={styles.card}>
              <View style={styles.cardHeaderBetween}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>📍</Text>
                  <Text style={styles.cardTitle}>GPS Position</Text>
                </View>
                <TouchableOpacity
                  style={styles.refreshLocBtn}
                  onPress={fetchCurrentLocation}
                  disabled={isLocating}
                >
                  {isLocating ? (
                    <ActivityIndicator size="small" color="#2D6A4F" />
                  ) : (
                    <Text style={styles.refreshLocText}>🔄 Refresh</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.geoGrid}>
                <View style={styles.geoCol}>
                  <Text style={styles.geoLabel}>Latitude</Text>
                  <Text style={styles.geoVal}>{latitude !== null ? `${latitude}°` : 'Acquiring...'}</Text>
                </View>
                <View style={styles.geoDivider} />
                <View style={styles.geoCol}>
                  <Text style={styles.geoLabel}>Longitude</Text>
                  <Text style={styles.geoVal}>{longitude !== null ? `${longitude}°` : 'Acquiring...'}</Text>
                </View>
              </View>

              <View style={styles.accuracyPill}>
                <Text style={styles.accuracyText}>
                  {gpsAccuracy !== null && gpsAccuracy <= 10 ? '🟢 ' : '🟠 '}
                  {gpsAccuracy !== null ? `Estimated Accuracy: ±${gpsAccuracy}m` : 'Calculating accuracy...'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* STEP 2: Measurements & Botanical Health */}
        {currentStep === 2 && (
          <View style={styles.stepContent}>
            <View style={styles.card}>
              <View style={styles.cardHeaderBetween}>
                <Text style={styles.cardTitle}>Tree Height (cm)</Text>
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
                  keyboardType="numeric"
                  textAlign="center"
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

            <View style={styles.card}>
              <View style={styles.cardHeaderBetween}>
                <Text style={styles.cardTitle}>Diameter at Breast Height (cm)</Text>
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
                  keyboardType="decimal-pad"
                  textAlign="center"
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
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {selected ? `✓ ${stage}` : stage}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

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
                      <View style={[styles.statusDot, { backgroundColor: item.color }]} />
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

        {/* STEP 3: Photos & Observations Notes */}
        {currentStep === 3 && (
          <View style={styles.stepContent}>
            <View style={styles.card}>
              <View style={styles.cardHeaderBetween}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>📷</Text>
                  <Text style={styles.cardTitle}>Field Photos</Text>
                </View>
                <Text style={styles.photoCountText}>{photos.length}/4</Text>
              </View>

              <View style={styles.photoGrid}>
                {photos.map((uri, idx) => (
                  <View key={idx} style={styles.photoTile}>
                    <Image source={{ uri }} style={styles.photoThumb} />
                    <TouchableOpacity
                      style={styles.photoRemoveBtn}
                      onPress={() => handleRemovePhoto(idx)}
                    >
                      <Text style={styles.photoRemoveText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                {photos.length < 4 && (
                  <TouchableOpacity style={styles.addPhotoCard} onPress={handlePickPhoto}>
                    <Text style={{ fontSize: 24 }}>📸</Text>
                    <Text style={styles.addPhotoText}>Take Photo</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

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
              />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Fixed Bottom Action Bar */}
      <View style={styles.bottomBar}>
        {currentStep > 1 && (
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
            style={[styles.primaryBtn, { flex: 1, marginLeft: currentStep > 1 ? 12 : 0 }]}
            onPress={handleNextStep}
          >
            <Text style={styles.primaryBtnText}>Continue →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.saveBtn, { flex: 1, marginLeft: 12 }]}
            onPress={handleSaveObservation}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>☁️ Save Observation</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
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
  refreshLocBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#EAF3EC',
    borderRadius: 12,
  },
  refreshLocText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D6A4F',
  },
  geoGrid: {
    flexDirection: 'row',
    backgroundColor: '#F7F9F7',
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E8EFEA',
  },
  geoCol: {
    flex: 1,
    alignItems: 'center',
  },
  geoDivider: {
    width: 1,
    backgroundColor: '#DDE5E0',
  },
  geoLabel: {
    fontSize: 11,
    color: '#76877B',
    fontWeight: '600',
    marginBottom: 2,
  },
  geoVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#213B2A',
  },
  accuracyPill: {
    marginTop: 10,
    alignSelf: 'center',
  },
  accuracyText: {
    fontSize: 12,
    color: '#5C6E61',
    fontWeight: '600',
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
  addPhotoText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4A5C50',
    marginTop: 4,
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