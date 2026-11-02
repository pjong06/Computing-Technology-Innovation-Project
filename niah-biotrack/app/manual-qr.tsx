import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useRecordStore, SyncStatus } from '../src/store/useRecordStore';
import FormScrollView from '../src/components/FormScrollView';
import { parseTagCode } from '../src/utils/tagCode';

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.167:3000'
).trim().replace(/\/+$/, '');

export default function ManualQREntryScreen() {
  const router = useRouter();
  const { initialCode, notFound } = useLocalSearchParams();
  const findByTag = useRecordStore((state) => state.findByTag);
  const addRecord = useRecordStore((state) => state.addRecord);
  const attachTag = useRecordStore((state) => state.attachTag);

  const [code, setCode] = useState((initialCode as string) || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<null | 'invalid' | 'notFound'>(
    notFound === 'true' ? 'notFound' : null
  );

  const handleLookup = async () => {
    const clean = parseTagCode(code);
    if (!clean) {
      setError('invalid');
      return;
    }

    const matched = findByTag(clean);
    if (matched) {
      setError(null);
      router.push({ pathname: '/plant-detail', params: { id: matched.id } } as any);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/plants/tag/${encodeURIComponent(clean)}`);
      if (response.ok) {
        const body = await response.json();
        const remotePlant = body.data;

        if (remotePlant) {
          const imported = addRecord({
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
          attachTag(imported.id, clean);

          Toast.show({
            type: 'success',
            text1: 'Record Retrieved',
            text2: `Fetched ${clean} from server database.`,
          });

          router.push({ pathname: '/plant-detail', params: { id: imported.id } } as any);
          return;
        }
      }
      setError('notFound');
    } catch {
      setError('notFound');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 20 }}>
          <Text style={styles.backChevron}>‹ Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Enter Code</Text>
        <Text style={styles.subtitle}>Type the code printed on the tag if the QR code can't be scanned.</Text>

        <Text style={styles.label}>Tag code</Text>
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
          onSubmitEditing={handleLookup}
        />

        <Text style={styles.caption}>ℹ Printed below the QR code on the physical plant tag.</Text>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>
              {error === 'invalid' ? 'Not a plant tag' : 'Record not found'}
            </Text>
            <Text style={styles.errorSub}>
              {error === 'invalid'
                ? 'Tag codes look like NIAH-PLT-00001. Check the code and try again.'
                : `No plant record with tag ${code.trim().toUpperCase()} exists on this device or the server.`}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
          onPress={handleLookup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Look up record</Text>
          )}
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)/scan' as any)}>
          <Text style={styles.secondaryBtnText}>Scan QR code instead</Text>
        </TouchableOpacity>
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  backChevron: { fontSize: 18, color: '#213B2A', fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22' },
  subtitle: { fontSize: 13, color: '#68776D', marginTop: 4, marginBottom: 24, lineHeight: 18 },
  label: { fontSize: 12.5, fontWeight: '700', color: '#213B2A', marginBottom: 6 },
  input: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 8 },
  caption: { fontSize: 11.5, color: '#7E8F83', marginBottom: 18 },
  errorBox: { backgroundColor: '#FDF2F2', padding: 14, borderRadius: 16, marginBottom: 18 },
  errorTitle: { color: '#9B1C1C', fontWeight: '700', fontSize: 13 },
  errorSub: { color: '#9B1C1C', fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  primaryBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  primaryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#DEE4DF' },
  dividerText: { marginHorizontal: 12, color: '#88988D', fontSize: 11, fontWeight: '700' },
  secondaryBtn: { height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', borderWidth: 1.2, borderColor: '#213B2A', backgroundColor: '#FFF' },
  secondaryBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 14.5 },
});