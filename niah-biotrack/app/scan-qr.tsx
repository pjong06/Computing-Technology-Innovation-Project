import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRecordStore } from '../src/store/useRecordStore';

export default function ScanQRScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const records = useRecordStore((state) => state.records);

  useEffect(() => { if (!permission?.granted) requestPermission(); }, [permission]);

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    const scannedText = data.trim();
    const matched = records.find(r => r.recordId.toUpperCase() === scannedText.toUpperCase() || r.scientificName.toLowerCase() === scannedText.toLowerCase());

    if (matched) {
      router.push({ pathname: '/plant-detail', params: { id: matched.recordId } } as any);
    } else {
      router.push({ pathname: '/plant-detail', params: { id: scannedText, name: scannedText } } as any);
    }
  };

  if (!permission?.granted) return <SafeAreaView style={styles.container}><Text style={{color:'white'}}>Requesting Camera...</Text></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : handleBarcodeScanned} />
      <TouchableOpacity onPress={() => router.back()} style={{padding: 20}}><Text style={{color: '#FFF', fontSize: 16}}>‹ Back</Text></TouchableOpacity>
      <View style={styles.targetFrame} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  targetFrame: { alignSelf: 'center', marginTop: 150, width: 250, height: 250, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' }
});