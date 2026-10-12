import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useRecordStore } from '../src/store/useRecordStore';

export default function ManualQREntryScreen() {
  const router = useRouter();
  const { initialCode, notFound } = useLocalSearchParams();
  const records = useRecordStore((state) => state.records);

  const [code, setCode] = useState((initialCode as string) || '');
  const [hasError, setHasError] = useState(notFound === 'true');

  const handleLookup = () => {
    const clean = code.trim().toUpperCase();
    const matched = records.find((r) => r.recordId.toUpperCase() === clean);

    if (matched) {
      setHasError(false);
      router.push({ pathname: '/plant-detail', params: { id: matched.recordId } } as any);
    } else {
      setHasError(true);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 20 }}>
          <Text style={styles.backChevron}>‹ Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Enter Code</Text>
        <Text style={styles.subtitle}>Type the record code on the tag if the QR code can't be scanned.</Text>

        <Text style={styles.label}>Record code</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. NP-2026-0417"
          placeholderTextColor="#8C9A91"
          value={code}
          onChangeText={(val) => {
            setCode(val);
            if (hasError) setHasError(false);
          }}
          autoCapitalize="characters"
        />

        <Text style={styles.caption}>ℹ Printed below the QR code on the physical plant tag.</Text>

        {hasError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Record not found</Text>
            <Text style={styles.errorSub}>No record matches {code}. Check the tag isn't damaged, or the record may not have synced yet.</Text>
          </View>
        )}

        <TouchableOpacity style={styles.primaryBtn} onPress={handleLookup}>
          <Text style={styles.primaryBtnText}>Look up record</Text>
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)/scan' as any)}>
          <Text style={styles.secondaryBtnText}>Scan QR code instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
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