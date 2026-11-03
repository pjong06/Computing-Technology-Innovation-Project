import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { useStaffOnly } from '../src/context/AuthRoleContext';
import { useRecordStore } from '../src/store/useRecordStore';

export default function LinkRouteScreen() {
  const router = useRouter();
  // Botanist-only screen: guests and visitors are sent back to Home.
  const blocked = useStaffOnly();
  const draft = useRecordStore((state) => state.activeDraftRoute);
  const clearDraft = useRecordStore((state) => state.clearActiveDraftRoute);

  if (blocked) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.statusPill}>Recording stopped · {draft?.distanceMeters || 640} m</Text>
        <Text style={styles.heading}>Link this route to...</Text>
        <Text style={styles.sub}>Route ends at {draft?.endGps || '3.2251° N, 113.7644° E (±6 m)'}</Text>

        <TouchableOpacity
          style={styles.actionBox}
          onPress={() => {
            clearDraft();
            router.push('/new-record' as any);
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.actionBoxTitle}>New record</Text>
            <Text style={styles.actionBoxSub}>Opens New Record with GPS already filled in</Text>
          </View>
          <Text style={{ fontSize: 24, color: '#213B2A' }}>➕</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBox}
          onPress={() => {
            clearDraft();
            router.push('/(tabs)/records' as any);
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.actionBoxTitle}>Existing tagged plant</Text>
            <Text style={styles.actionBoxSub}>Scan its tag, or pick from plants nearby</Text>
          </View>
          <Text style={{ fontSize: 24, color: '#213B2A' }}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.discardBtn}
          onPress={() => {
            clearDraft();
            router.replace('/(tabs)/home' as any);
          }}
        >
          <Text style={styles.discardBtnText}>Discard route</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  statusPill: { alignSelf: 'flex-start', backgroundColor: '#EDF5EF', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12, color: '#213B2A', fontWeight: '700', fontSize: 12 },
  heading: { fontSize: 24, fontWeight: '800', color: '#1E2B22', marginTop: 12 },
  sub: { fontSize: 13, color: '#68776D', marginTop: 4, marginBottom: 28 },
  actionBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 20, borderRadius: 24, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 14 },
  actionBoxTitle: { fontSize: 16, fontWeight: '700', color: '#1E2B22' },
  actionBoxSub: { fontSize: 12.5, color: '#68776D', marginTop: 3 },
  discardBtn: { alignSelf: 'center', marginTop: 16, padding: 12 },
  discardBtnText: { color: '#9B1C1C', fontWeight: '700', fontSize: 14 },
});