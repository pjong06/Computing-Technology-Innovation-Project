import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  IdentificationStatus,
  SyncStatus,
  useRecordStore,
} from '../src/store/useRecordStore';
import PlantNotFound from '../src/components/PlantNotFound';
import { isPhysicalTag } from '../src/utils/myTags';

export default function SaveConfirmScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const records = useRecordStore((state) => state.records);

  const matched = records.find((r) => r.id === id);

  if (!matched) {
    return <PlantNotFound code={id} />;
  }

  // Identification-pending drafts remain local; complete records enter the
  // future upload queue.
  const needsIdentification =
    matched.identificationStatus === IdentificationStatus.PENDING ||
    !matched.scientificName.trim();
  const statusText =
    matched.syncStatus === SyncStatus.LOCAL_ONLY
      ? 'Status: Local draft – not queued for upload'
      : matched.syncStatus === SyncStatus.UPLOADED
        ? 'Status: Synced to server database'
      : matched.syncStatus === SyncStatus.FAILED
        ? 'Status: Upload failed – saved on this device'
        : 'Status: Saved locally – ready to sync';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.checkIconCircle}><Text style={{ color: '#FFF', fontSize: 24 }}>✓</Text></View>
          <Text style={styles.title}>{needsIdentification ? 'Draft saved' : 'Record saved'}</Text>
          <Text style={styles.subtitle}>{statusText}</Text>
          {needsIdentification ? (
            <Text style={styles.subtitle}>
              This draft is stored safely on this device. Confirm an approved species before it can be uploaded.
            </Text>
          ) : matched.syncStatus === SyncStatus.NOT_UPLOADED ? (
            <Text style={styles.subtitle}>
              Saved safely on this device. The app will try to upload it in the background. If the connection is unavailable, it will remain queued for later sync.
            </Text>
          ) : matched.syncStatus === SyncStatus.FAILED ? (
            <Text style={styles.subtitle}>
              The record is still safe on this device. You can retry the upload from Database Sync in your Profile.
            </Text>
          ) : matched.syncStatus === SyncStatus.UPLOADED ? (
            <Text style={styles.subtitle}>
              This record has been successfully uploaded to the server.
            </Text>
          ) : null}

          <View style={styles.infoBox}>
            <Text style={styles.plantTitle}>
              {matched.scientificName || 'Identification pending'}
            </Text>
            <Text style={styles.plantTaxa}>
              {[matched.commonName, matched.family].filter(Boolean).join(' · ') ||
                'Common name and family not recorded'}
            </Text>
            <Text style={styles.plantLoc}>📍 {matched.locationName}</Text>
            <Text style={styles.plantGps}>{matched.gpsCoordination}</Text>
            <Text style={styles.metaRow}>
              🕒 {matched.createdAt} · {matched.photoUris?.length || 0} photos
            </Text>
            <Text style={styles.recordIdTag}>Tag: {isPhysicalTag(matched.tagCode) ? matched.tagCode : 'No physical tag yet'}</Text>
          </View>

          <Text style={styles.helperNotice}>
            {isPhysicalTag(matched.tagCode)
              ? 'Tag attached – scanning it opens this record.'
              : 'Tie one of your printed tags (My QR tags in Profile) to the plant and scan it, or choose "No physical tag yet" and attach one later from its plant page.'}
          </Text>
        </View>

        {!isPhysicalTag(matched.tagCode) && (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() =>
                router.push({ pathname: '/attach-tag', params: { recordId: matched.id } } as any)
              }
            >
              <Text style={styles.primaryBtnText}>Scan tag</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.laterBtn}
              onPress={() => router.replace('/(tabs)/home' as any)}
              accessibilityRole="button"
            >
              <Text style={styles.laterBtnText}>No physical tag yet (attach it later)</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.secondaryBtn, styles.halfBtn]}
            onPress={() => router.replace('/new-record' as any)}
          >
            <Text style={styles.secondaryBtnText}>Add another</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryBtn, styles.halfBtn]}
            onPress={() => router.replace('/(tabs)/home' as any)}
          >
            <Text style={styles.secondaryBtnText}>Back to home</Text>
          </TouchableOpacity>
        </View>
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
  container: { flex: 1, padding: 22, justifyContent: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 20,
  },
  checkIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#213B2A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#1E2B22' },
  subtitle: { fontSize: 12.5, color: '#68776D', marginTop: 4, marginBottom: 16 },
  infoBox: {
    width: '100%',
    backgroundColor: '#F6F8F6',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  plantTitle: { fontSize: 16, fontWeight: '800', color: '#213B2A' },
  plantTaxa: { fontSize: 12.5, color: '#68776D', marginTop: 2 },
  plantLoc: { fontSize: 13, fontWeight: '700', color: '#1E2B22', marginTop: 8 },
  plantGps: { fontSize: 11.5, color: '#7E8F83', marginTop: 2 },
  metaRow: { fontSize: 11.5, color: '#7E8F83', marginTop: 8 },
  recordIdTag: { fontSize: 12, fontWeight: '800', color: '#213B2A', marginTop: 10 },
  helperNotice: { fontSize: 11.5, color: '#7E8F83', textAlign: 'center', lineHeight: 16 },
  primaryBtn: {
    backgroundColor: '#213B2A',
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },
  laterBtn: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 12, marginBottom: 4 },
  laterBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 13.5, textDecorationLine: 'underline' },
  secondaryBtn: {
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#213B2A',
    backgroundColor: '#FFF',
    marginBottom: 10,
  },
  secondaryBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 14.5 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  halfBtn: { flex: 1, marginBottom: 0 },
});
