import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, Image, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { useRecordStore, RecordStatus } from '../src/store/useRecordStore';

export default function NewRecordScreen() {
  const router = useRouter();
  const addRecord = useRecordStore((state) => state.addRecord);
  
  const [scientificName, setScientificName] = useState('');
  const [locationName, setLocationName] = useState('');
  const [gpsCoordination, setGpsCoordination] = useState('Fetching...');
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setGpsCoordination('3.2247° N, 113.7631° E');
      const loc = await Location.getCurrentPositionAsync({});
      setGpsCoordination(`${loc.coords.latitude.toFixed(4)}°, ${loc.coords.longitude.toFixed(4)}°`);
    })();
  }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [4, 3], quality: 0.8 });
    if (!result.canceled && result.assets?.[0]?.uri) setPhotoUri(result.assets[0].uri);
  };

  const handleSave = () => {
    if (!scientificName) {
      Toast.show({
        type: 'error',
        text1: 'Missing Information',
        text2: 'Please enter a scientific name.',
        position: 'top',
      });
      return;
    }

    const recordId = `NB-${Math.floor(1000 + Math.random() * 9000)}`;
    
    addRecord({
      recordId,
      scientificName,
      commonName: 'Field Specimen',
      family: 'Unknown',
      locationName: locationName || 'Trail Point',
      gpsCoordination,
      photoUri: photoUri || undefined,
      status: RecordStatus.PENDING, // Using Enum instead of 'Pending'
    });
    router.push({ pathname: '/save-confirm', params: { recordId } } as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
        <Text style={styles.title}>New Record</Text>

        <TouchableOpacity style={styles.photoBox} onPress={pickImage}>
          {photoUri ? <Image source={{ uri: photoUri }} style={{width: '100%', height: '100%'}} /> : <Text>📷 Capture Photo</Text>}
        </TouchableOpacity>

        <TextInput style={styles.input} placeholder="Scientific Name" value={scientificName} onChangeText={setScientificName} />
        <TextInput style={styles.input} placeholder="Location" value={locationName} onChangeText={setLocationName} />
        <Text style={styles.gps}>📍 {gpsCoordination}</Text>

        <TouchableOpacity style={styles.btn} onPress={handleSave}><Text style={styles.btnText}>Save</Text></TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { padding: 22, paddingBottom: 40 },
  back: { fontSize: 18, color: '#213B2A', marginBottom: 10 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#213B2A', marginBottom: 20 },
  photoBox: { height: 160, backgroundColor: '#E7EFEA', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 20, overflow: 'hidden' },
  input: { backgroundColor: '#FFFFFF', height: 52, borderRadius: 26, paddingHorizontal: 20, borderWidth: 1, borderColor: '#E6ECE8', marginBottom: 14 },
  gps: { color: '#68776D', marginBottom: 30, paddingHorizontal: 10 },
  btn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: 'bold' },
});