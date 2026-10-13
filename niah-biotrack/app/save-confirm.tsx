import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useRecordStore, SyncStatus } from '../src/store/useRecordStore';
import PlantNotFound from '../src/components/PlantNotFound';

export default function SaveConfirmScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const records = useRecordStore((state) => state.records);

  const matched = records.find((r) => r.id === id);

  if (!matched) {
    return <PlantNotFound code={id} />;
  }

  // Describe the record's real local status. Nothing is uploaded yet, so a new
  // record is always Not Uploaded here.
  const statusText =
    matched.syncStatus === SyncStatus.UPLOADED
      ? 'Status: Synced to the server'
      : matched.syncStatus === SyncStatus.FAILED
        ? 'Status: Upload failed – saved on this device'
        : 'Status: Not uploaded – saved on this device only';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.checkIconCircle}><Text style={{ color: '#FFF', fontSize: 24 }}>✓</Text></View>
          <Text style={styles.title}>Record saved</Text>
          <Text style={styles.subtitle}>{statusText}</Text>
          {matched.syncStatus !== SyncStatus.UPLOADED && (
            <Text style={styles.subtitle}>Uploading to the server is not available yet.</Text>
          )}

          <View style={styles.infoBox}>
            <Text style={styles.plantTitle}>{matched.scientificName}</Text>
            <Text style={styles.plantTaxa}>
              {[matched.commonName, matched.family].filter(Boolean).join(' · ') || 'Common name and family not recorded'}
            </Text>
            <Text style={styles.plantLoc}>📍 {matched.locationName}</Text>
            <Text style={styles.plantGps}>{matched.gpsCoordination}</Text>
            <Text style={styles.metaRow}>🕒 {matched.createdAt} · {matched.photoUris?.length || 0} photos</Text>
            <Text style={styles.recordIdTag}>Tag: {matched.tagCode ?? 'No tag attached'}</Text>
          </View>

          <Text style={styles.helperNotice}>
            {matched.tagCode
              ? 'Tag attached – scanning it opens this record.'
            : 'Tie a pre-printed tag to the plant and scan it, or attach one later from its plant page.'}
          </Text>
      </View>    

        {!matched.tagCode && (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push({ pathname: '/attach-tag', params: { recordId: matched.id } } as any)}
          >
            <Text style={styles.primaryBtnText}>Attach tag</Text>
          </TouchableOpacity>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.secondaryBtn, styles.halfBtn]} onPress={() => router.replace('/new-record' as any)}>
            <Text style={styles.secondaryBtnText}>Add another</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryBtn, styles.halfBtn]} onPress={() => router.replace('/(tabs)/home' as any)}>
            <Text style={styles.secondaryBtnText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, padding: 22, justifyContent: 'center' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 24, alignItems: 'center', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 20 },
  checkIconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#213B2A', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#1E2B22' },
  subtitle: { fontSize: 12.5, color: '#68776D', marginTop: 4, marginBottom: 16 },
  infoBox: { width: '100%', backgroundColor: '#F6F8F6', borderRadius: 18, padding: 16, marginBottom: 14 },
  plantTitle: { fontSize: 16, fontWeight: '800', color: '#213B2A' },
  plantTaxa: { fontSize: 12.5, color: '#68776D', marginTop: 2 },
  plantLoc: { fontSize: 13, fontWeight: '700', color: '#1E2B22', marginTop: 8 },
  plantGps: { fontSize: 11.5, color: '#7E8F83', marginTop: 2 },
  metaRow: { fontSize: 11.5, color: '#7E8F83', marginTop: 8 },
  recordIdTag: { fontSize: 12, fontWeight: '800', color: '#213B2A', marginTop: 10 },
  helperNotice: { fontSize: 11.5, color: '#7E8F83', textAlign: 'center', lineHeight: 16 },
  primaryBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  primaryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },
  secondaryBtn: { height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', borderWidth: 1.2, borderColor: '#213B2A', backgroundColor: '#FFF', marginBottom: 10 },
  secondaryBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 14.5 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  halfBtn: { flex: 1, marginBottom: 0 },
});