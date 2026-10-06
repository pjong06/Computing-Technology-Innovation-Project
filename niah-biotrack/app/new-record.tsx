import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, Alert, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useRecordStore } from '../src/store/useRecordStore';

export default function NewRecordScreen() {
  const router = useRouter();
  const addRecord = useRecordStore((state) => state.addRecord);

  const [scientificName, setScientificName] = useState('');
  const [commonName, setCommonName] = useState('');
  const [family, setFamily] = useState('');
  const [morphology, setMorphology] = useState('');
  const [locationName, setLocationName] = useState('');
  const [gpsCoordination, setGpsCoordination] = useState('Fetching GPS...');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loadingGps, setLoadingGps] = useState(false);

  useEffect(() => { fetchLiveLocation(); }, []);

  const fetchLiveLocation = async () => {
    setLoadingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setGpsCoordination('3.2247° N, 113.7631° E'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGpsCoordination(`${loc.coords.latitude.toFixed(4)}°, ${loc.coords.longitude.toFixed(4)}°`);
    } catch { setGpsCoordination('3.2247° N, 113.7631° E'); } finally { setLoadingGps(false); }
  };

  const pickImage = async () => {
    Alert.alert('Attach Photo', 'Select capture mode', [
      {
        text: 'Camera', onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') return Alert.alert('Permission Required');
          const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [4, 3], quality: 0.8 });
          if (!result.canceled && result.assets?.[0]?.uri) setPhotoUri(result.assets[0].uri);
        }
      },
      {
        text: 'Gallery', onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [4, 3], quality: 0.8 });
          if (!result.canceled && result.assets?.[0]?.uri) setPhotoUri(result.assets[0].uri);
        }
      },
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const handleSave = () => {
    if (!scientificName.trim()) return Alert.alert('Required Field', 'Enter a scientific name.');
    const recordId = `NB-${Math.floor(1000 + Math.random() * 9000)}`;

    addRecord({
      recordId,
      scientificName: scientificName.trim(),
      commonName: commonName.trim() || 'Unknown',
      family: family.trim() || 'Unknown',
      morphology: morphology.trim() || 'Field observation logged via BioTrack.',
      locationName: locationName.trim() || 'Field Junction',
      gpsCoordination,
      photoUri: photoUri || undefined,
      status: 'Pending',
    });

    router.push({ pathname: '/save-confirm', params: { recordId } } as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backTouch}><Text style={styles.backChevron}>‹</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>New Plant Record</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionCategory}>PHOTO</Text>
        <TouchableOpacity style={styles.photoCaptureBox} activeOpacity={0.8} onPress={pickImage}>
          {photoUri ? <Image source={{ uri: photoUri }} style={styles.capturedPhoto} resizeMode="cover" /> : <Text style={styles.photoPrompt}>📷 Capture or attach photo</Text>}
        </TouchableOpacity>

        <Text style={styles.sectionCategory}>SPECIES DETAILS</Text>
        <TextInput style={styles.input} placeholder="Scientific name" placeholderTextColor="#8C9A91" value={scientificName} onChangeText={setScientificName} />
        <TextInput style={styles.input} placeholder="Common name" placeholderTextColor="#8C9A91" value={commonName} onChangeText={setCommonName} />
        <TextInput style={styles.input} placeholder="Family (taxonomy)" placeholderTextColor="#8C9A91" value={family} onChangeText={setFamily} />
        <TextInput style={[styles.input, {height: 76, textAlignVertical: 'top'}]} placeholder="Morphological characteristics" placeholderTextColor="#8C9A91" multiline value={morphology} onChangeText={setMorphology} />

        <Text style={styles.sectionCategory}>LOCATION</Text>
        <TextInput style={styles.input} placeholder="Location name" placeholderTextColor="#8C9A91" value={locationName} onChangeText={setLocationName} />

        <View style={styles.gpsCard}>
          <Text style={styles.gpsLabel}>GPS coordination</Text>
          <Text style={styles.gpsValue}>{loadingGps ? 'Locating satellites...' : gpsCoordination}</Text>
          <TouchableOpacity style={styles.gpsPill} activeOpacity={0.8} onPress={fetchLiveLocation}>
            {loadingGps ? <ActivityIndicator size="small" color="#213B2A" /> : <Text style={styles.gpsPillText}>Refresh location</Text>}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.saveRecordBtn} activeOpacity={0.85} onPress={handleSave}>
          <Text style={styles.saveRecordBtnText}>Save Record</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backTouch: { width: 36, height: 36, justifyContent: 'center' },
  backChevron: { fontSize: 28, color: '#1E2B22' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1E2B22' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionCategory: { fontSize: 11.5, fontWeight: '800', color: '#7D8C81', letterSpacing: 0.9, marginTop: 14, marginBottom: 8 },
  photoCaptureBox: { height: 150, borderRadius: 16, backgroundColor: '#E7EFEA', borderWidth: 1.5, borderColor: '#B6C9BD', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 12, overflow: 'hidden' },
  capturedPhoto: { width: '100%', height: '100%' },
  photoPrompt: { fontSize: 14, fontWeight: '600', color: '#264635' },
  input: { backgroundColor: '#FFFFFF', minHeight: 48, borderRadius: 12, paddingHorizontal: 16, fontSize: 13.5, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 10 },
  gpsCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 24 },
  gpsLabel: { fontSize: 12, color: '#68776D', fontWeight: '500' },
  gpsValue: { fontSize: 15, fontWeight: '700', color: '#1E2B22', marginVertical: 6 },
  gpsPill: { alignSelf: 'flex-start', backgroundColor: '#E7F0E9', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, marginTop: 4 },
  gpsPillText: { fontSize: 12, fontWeight: '700', color: '#213B2A' },
  saveRecordBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  saveRecordBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});