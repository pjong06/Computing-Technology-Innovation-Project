import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, Platform, StatusBar, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Toast from 'react-native-toast-message';
import { useRecordStore } from '../src/store/useRecordStore';
import FormScrollView from '../src/components/FormScrollView';
import { parseTagCode } from '../src/utils/tagCode';

export default function AttachTagScreen() {
  const router = useRouter();

  // ── 1. Which plant are we tagging? ─────────────────────────────
  const { recordId } = useLocalSearchParams<{ recordId: string }>();
  const record = useRecordStore((state) => state.records.find((r) => r.id === recordId));
  const attachTag = useRecordStore((state) => state.attachTag);

  // ── 2. Camera (copied from scan.tsx) ───────────────────────────
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (permission?.status === 'undetermined') requestPermission();
  }, [permission?.status]);

  // ── 3. Manual entry (like manual-qr.tsx) ───────────────────────
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ── 4. The core: try to attach a code ──────────────────────────
  const tryAttach = (raw: string) => {
    const clean = parseTagCode(raw);
    if (!clean) {
      return "That isn't a Niah plant tag. Tag codes look like NIAH-PLT-00001.";
    }

    const result = attachTag(recordId, clean);
    if (!result.ok) {
      return result.reason;
    }

    Toast.show({ type: 'success', text1: 'Tag attached', text2: clean });
    router.back();
    return null; // null = no error
  };

  // Camera found a QR
  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    const problem = tryAttach(data);
    if (problem) {
      Alert.alert("Couldn't attach tag", problem, [
        { text: 'OK', onPress: () => setScanned(false) }, // re-arm the camera
      ]);
    }
  };

  // "Attach" button under the text box
  const handleManualAttach = () => {
    setError(tryAttach(code));
  };

  // ── 5. Safety: record doesn't exist ────────────────────────────
  if (!record) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.title}>Plant not found</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── 6. The screen ──────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
          <Text style={styles.backChevron}>‹ Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Attach tag</Text>
        <Text style={styles.subtitle}>
          Tie a pre-printed tag to <Text style={styles.plantName}>{record.scientificName}</Text>, then scan it.
        </Text>

        {/* Camera, only if permission granted */}
        {permission?.granted ? (
          <View style={styles.cameraBox}>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
            />
          </View>
        ) : (
          <View style={styles.noCameraBox}>
            <Text style={styles.noCameraText}>Camera access is off – type the code below instead.</Text>
          </View>
        )}

        {/* Manual entry */}
        <Text style={styles.label}>Or type the tag code</Text>
        <TextInput
          style={styles.input}
          placeholder="NIAH-PLT-00001"
          placeholderTextColor="#8C9A91"
          value={code}
          onChangeText={(val) => {
            setCode(val);
            if (error) setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleManualAttach}
        />

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.primaryBtn} onPress={handleManualAttach}>
          <Text style={styles.primaryBtnText}>Attach tag</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()}>
          <Text style={styles.secondaryBtnText}>Skip for now</Text>
        </TouchableOpacity>
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flexGrow: 1, padding: 24 },
  backChevron: { fontSize: 18, color: '#213B2A', fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22' },
  subtitle: { fontSize: 13, color: '#68776D', marginTop: 4, marginBottom: 18, lineHeight: 18 },
  plantName: { fontStyle: 'italic', fontWeight: '700', color: '#213B2A' },
  cameraBox: { height: 280, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000', marginBottom: 20 },
  noCameraBox: { padding: 16, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 20 },
  noCameraText: { fontSize: 13, color: '#68776D', textAlign: 'center' },
  label: { fontSize: 12.5, fontWeight: '700', color: '#213B2A', marginBottom: 6 },
  input: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 12 },
  errorBox: { backgroundColor: '#FDF2F2', padding: 14, borderRadius: 16, marginBottom: 12 },
  errorText: { color: '#9B1C1C', fontSize: 12.5, lineHeight: 17 },
  primaryBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  primaryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },
  secondaryBtn: { height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', borderWidth: 1.2, borderColor: '#213B2A', backgroundColor: '#FFF' },
  secondaryBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 14.5 },
});