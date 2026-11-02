import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  StatusBar,
  Alert,
  AppState,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions, Camera } from 'expo-camera';
import { pickImageFromLibrary } from '../../src/utils/imagePicker';
import Toast from 'react-native-toast-message';
import { parseTagCode } from '../../src/utils/tagCode';
import { useRecordStore, SyncStatus } from '../../src/store/useRecordStore';

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.167:3000'
).trim().replace(/\/+$/, '');

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [torch, setTorch] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const findByTag = useRecordStore((state) => state.findByTag);
  const addRecord = useRecordStore((state) => state.addRecord);
  const attachTag = useRecordStore((state) => state.attachTag);

  useEffect(() => {
    if (permission?.status === 'undetermined') {
      requestPermission();
    }
  }, [permission?.status]);

  useFocusEffect(
    useCallback(() => {
      setScanned(false);
      setIsLookingUp(false);
      getPermission();
    }, [getPermission])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') getPermission();
    });
    return () => subscription.remove();
  }, [getPermission]);

  const processScannedCode = async (rawCode: string) => {
    const code = parseTagCode(rawCode);
    if (!code) {
      Alert.alert('Not a plant tag', "That isn't a Niah plant tag.", [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
      return;
    }

    // 1. Check local cache first
    const localMatch = findByTag(code);
    if (localMatch) {
      router.push({ pathname: '/plant-detail', params: { id: localMatch.id } } as any);
      return;
    }

    // 2. Query remote server
    setIsLookingUp(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/plants/tag/${encodeURIComponent(code)}`);
      
      if (response.ok) {
        const body = await response.json();
        const remotePlant = body.data;

        if (remotePlant) {
          const importedRecord = addRecord({
            scientificName: remotePlant.species?.scientific_name || remotePlant.scientific_name || 'Unknown species',
            speciesId: remotePlant.species_id || null,
            commonName: remotePlant.common_name || '',
            family: remotePlant.family || '',
            height: remotePlant.height_m ? String(remotePlant.height_m) : undefined,
            morphology: remotePlant.morphology || undefined,
            locationName: remotePlant.location_name || 'Niah National Park',
            latitude: remotePlant.latitude || 3.8167,
            longitude: remotePlant.longitude || 113.7833,
            gpsCoordination: `${remotePlant.latitude ?? 3.8167}° N, ${remotePlant.longitude ?? 113.7833}° E`,
            photoUris: [],
            syncStatus: SyncStatus.UPLOADED,
          });
          attachTag(importedRecord.id, code);

          Toast.show({
            type: 'success',
            text1: 'Record Retrieved',
            text2: `Fetched ${code} from database.`,
          });

          router.push({ pathname: '/plant-detail', params: { id: importedRecord.id } } as any);
          return;
        }
      }

      router.push({
        pathname: '/manual-qr',
        params: { initialCode: code, notFound: 'true' },
      } as any);
    } catch {
      router.push({
        pathname: '/manual-qr',
        params: { initialCode: code, notFound: 'true' },
      } as any);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned || isLookingUp) return;
    setScanned(true);
    void processScannedCode(data);
  };

  const handleUploadImage = async () => {
    const picked = await pickImageFromLibrary();
    if (picked.status === 'canceled') return;
    if (picked.status !== 'picked') {
      Toast.show({ type: 'error', text1: 'Photos unavailable', text2: 'The photo library could not be opened.' });
      return;
    }

    try {
      const scannedResults = await Camera.scanFromURLAsync(picked.asset.uri, ['qr']);
      if (scannedResults && scannedResults.length > 0 && scannedResults[0].data) {
        void processScannedCode(scannedResults[0].data);
      } else {
        Alert.alert(
          'No QR Code Found',
          'No valid plant tag QR code could be detected in this photo. Try another image or enter the code manually.',
          [
            { text: 'Enter code', onPress: () => router.push('/manual-qr' as any) },
            { text: 'OK', style: 'cancel' },
          ]
        );
      }
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Scan Error',
        text2: 'Could not read QR code from image.',
      });
    }
  };

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.safeAreaFallback}>
        <View style={styles.fallbackBox}>
          <Text style={{ fontSize: 50, marginBottom: 16 }}>🚫📷</Text>
          <Text style={styles.fallbackTitle}>Camera access is off</Text>
          <Text style={styles.fallbackSub}>
            Niah Ground-Truth needs the camera to scan plant tags and take record photos.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => Linking.openSettings()}>
            <Text style={styles.primaryBtnText}>Open settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push('/manual-qr' as any)}
          >
            <Text style={styles.secondaryBtnText}>Enter code manually</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <CameraView
        style={StyleSheet.absoluteFill}
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned || isLookingUp ? undefined : handleBarcodeScanned}
      />

      <View style={styles.overlayContainer}>
        <View style={styles.topHeader}>
          <Text style={styles.topTitle}>Scan QR code</Text>
          <Text style={styles.topSub}>Point at the plant tag</Text>
          <Text style={styles.topSub2}>Hold steady - scans automatically</Text>
        </View>

        <View style={styles.scanReticle}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
          {isLookingUp && (
            <View style={styles.reticleLoading}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.reticleLoadingText}>Checking database...</Text>
            </View>
          )}
        </View>

        <View style={styles.bottomControls}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.pillButton}
              activeOpacity={0.8}
              onPress={handleUploadImage}
              disabled={isLookingUp}
            >
              <Text style={styles.pillButtonText}>Upload image</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.pillButton}
              activeOpacity={0.8}
              onPress={() => router.push('/manual-qr' as any)}
              disabled={isLookingUp}
            >
              <Text style={styles.pillButtonText}>Enter code</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.torchCircle, torch && styles.torchCircleActive]}
              activeOpacity={0.8}
              onPress={() => setTorch(!torch)}
            >
              <Text style={[styles.torchText, torch && styles.torchTextActive]}>
                {torch ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000000' },
  safeAreaFallback: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  fallbackBox: {
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  fallbackTitle: { fontSize: 20, fontWeight: '800', color: '#213B2A', marginBottom: 8 },
  fallbackSub: { fontSize: 13, color: '#68776D', textAlign: 'center', marginBottom: 24, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: '#213B2A',
    height: 48,
    borderRadius: 24,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  secondaryBtn: {
    height: 48,
    borderRadius: 24,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#213B2A',
    backgroundColor: '#FFFFFF',
  },
  secondaryBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 14 },
  overlayContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 24,
    paddingBottom: 20,
  },
  topHeader: { alignItems: 'center' },
  topTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  topSub: { color: 'rgba(255, 255, 255, 0.85)', fontSize: 14, marginTop: 4, fontWeight: '500' },
  topSub2: { color: 'rgba(255, 255, 255, 0.65)', fontSize: 12, marginTop: 2 },
  scanReticle: {
    alignSelf: 'center',
    width: 260,
    height: 260,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: '#74B886' },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 },
  reticleLoading: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  reticleLoadingText: { color: '#FFF', fontSize: 13, fontWeight: '700', marginTop: 8 },
  bottomControls: { marginBottom: Platform.OS === 'ios' ? 14 : 8 },
  actionRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  pillButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    elevation: 2,
  },
  pillButtonText: { color: '#213B2A', fontWeight: '700', fontSize: 13.5 },
  torchCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  torchCircleActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  torchText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  torchTextActive: { color: '#213B2A' },
});