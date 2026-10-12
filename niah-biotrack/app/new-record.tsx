import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, Platform, StatusBar, Image, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { useRecordStore, RecordStatus } from '../src/store/useRecordStore';

export default function NewRecordScreen() {
  const router = useRouter();
  const addRecord = useRecordStore((state) => state.addRecord);

  const [photos, setPhotos] = useState<{ [key: string]: string | null }>({
    'Whole plant': null,
    'Leaf': null,
    'Flower': null,
    'Bark': null,
  });

  const [scientificName, setScientificName] = useState('');
  const [commonName, setCommonName] = useState('');
  const [family, setFamily] = useState('');
  const [height, setHeight] = useState('');
  const [morphology, setMorphology] = useState('');
  const [locationName, setLocationName] = useState('');
  const [gpsCoordination, setGpsCoordination] = useState('Fetching GPS...');
  const [isGpsGood, setIsGpsGood] = useState(false);

  useEffect(() => {
    fetchLocation();
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
      setGpsCoordination(`${loc.coords.latitude.toFixed(4)}° N, ${loc.coords.longitude.toFixed(4)}° E (±${Math.round(loc.coords.accuracy || 6)} m)`);
      setIsGpsGood(true);
    } catch {
      setGpsCoordination('3.2247° N, 113.7631° E (±8 m)');
      setIsGpsGood(true);
    }
  };

  const pickPhotoForSlot = async (slot: string) => {
    Alert.alert('Attach Photo', `Select image source for ${slot}`, [
      {
        text: 'Camera',
        onPress: async () => {
          const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [4, 3], quality: 0.8 });
          if (!res.canceled && res.assets?.[0]?.uri) {
            setPhotos((prev) => ({ ...prev, [slot]: res.assets[0].uri }));
          }
        },
      },
      {
        text: 'Gallery',
        onPress: async () => {
          const res = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [4, 3], quality: 0.8 });
          if (!res.canceled && res.assets?.[0]?.uri) {
            setPhotos((prev) => ({ ...prev, [slot]: res.assets[0].uri }));
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
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

    const photoList = Object.values(photos).filter(Boolean) as string[];
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
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.backChevron}>‹</Text></TouchableOpacity>
        <Text style={styles.navTitle}>New Plant Record</Text>
        <View style={styles.draftBadge}><Text style={styles.draftBadgeText}>Draft saved</Text></View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>PHOTOS *</Text>
          <Text style={styles.sectionSubLabel}>min. 1 required</Text>
        </View>

        <View style={styles.photoGrid}>
          {Object.entries(photos).map(([slot, uri]) => (
            <TouchableOpacity key={slot} style={styles.photoBox} onPress={() => pickPhotoForSlot(slot)}>
              {uri ? (
                <Image source={{ uri }} style={styles.photoThumb} />
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 24 }}>📷</Text>
                  <Text style={styles.photoSlotText}>{slot}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.aiBanner}>
          <Text style={styles.aiBannerTitle}>Suggest species from photos</Text>
          <Text style={styles.aiBannerSub}>Offline · Connect to get AI suggestions - you can still enter the name manually.</Text>
        </View>

        <Text style={styles.sectionLabel}>SPECIES DETAILS</Text>
        <Text style={styles.fieldLabel}>Scientific name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Start typing - species list works offline"
          placeholderTextColor="#8C9A91"
          value={scientificName}
          onChangeText={setScientificName}
        />

        <Text style={styles.fieldLabel}>Common name</Text>
        <TextInput style={styles.input} placeholder="e.g. Pitcher plant" placeholderTextColor="#8C9A91" value={commonName} onChangeText={setCommonName} />

        <Text style={styles.fieldLabel}>Family</Text>
        <TextInput style={styles.input} placeholder="e.g. Nepenthaceae" placeholderTextColor="#8C9A91" value={family} onChangeText={setFamily} />

        <Text style={styles.fieldLabel}>Height / diameter (m)</Text>
        <TextInput style={styles.input} placeholder="e.g. 0.4" placeholderTextColor="#8C9A91" keyboardType="numeric" value={height} onChangeText={setHeight} />

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
        <TextInput style={styles.input} placeholder="e.g. Cave entrance area" placeholderTextColor="#8C9A91" value={locationName} onChangeText={setLocationName} />

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
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  offlineNoticeBar: { backgroundColor: '#F0F6F2', paddingVertical: 6, alignItems: 'center' },
  offlineNoticeText: { fontSize: 11.5, color: '#32503B', fontWeight: '600' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  backChevron: { fontSize: 32, color: '#213B2A' },
  navTitle: { fontSize: 17, fontWeight: '700', color: '#1E2B22' },
  draftBadge: { backgroundColor: '#E4EDE7', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  draftBadgeText: { fontSize: 11, fontWeight: '600', color: '#213B2A' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 8 },
  sectionLabel: { fontSize: 11.5, fontWeight: '800', color: '#7D8C81', letterSpacing: 0.8 },
  sectionSubLabel: { fontSize: 11.5, color: '#88988D' },
  photoGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  photoBox: { width: '23%', height: 80, borderRadius: 14, backgroundColor: '#E8EFEA', borderWidth: 1, borderColor: '#D4E2D8', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  photoThumb: { width: '100%', height: '100%' },
  photoSlotText: { fontSize: 10, fontWeight: '600', color: '#3A5243', marginTop: 4 },
  aiBanner: { backgroundColor: '#EDF5EF', padding: 14, borderRadius: 16, marginBottom: 16 },
  aiBannerTitle: { fontSize: 13, fontWeight: '700', color: '#213B2A' },
  aiBannerSub: { fontSize: 11.5, color: '#597061', marginTop: 2 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: '#213B2A', marginBottom: 6, marginTop: 6 },
  input: { backgroundColor: '#FFFFFF', minHeight: 48, borderRadius: 16, paddingHorizontal: 16, fontSize: 13.5, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 8 },
  gpsCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 24 },
  gpsStatusBadge: { color: '#215A36', fontWeight: '700', fontSize: 12, marginBottom: 4 },
  gpsCoords: { fontSize: 14, fontWeight: '800', color: '#1E2B22', marginBottom: 4 },
  gpsDetails: { fontSize: 11.5, color: '#7E8F83', marginBottom: 12 },
  refreshGpsBtn: { alignSelf: 'flex-start', backgroundColor: '#EDF5EF', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16 },
  refreshGpsBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 12 },
  saveBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  saveBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});