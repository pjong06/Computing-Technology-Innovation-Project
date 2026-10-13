import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';

export default function OfflineMapScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()}><Text style={styles.backChevron}>‹</Text></TouchableOpacity>
          <Text style={styles.headerTag}>Offline map · GPS only</Text>
        </View>

        <View style={styles.compassCard}>
          <Text style={styles.directionDistance}>140 m</Text>
          <Text style={styles.directionInstruction}>Head north-east along the trail</Text>
          <View style={styles.compassRing}>
            <Text style={{ fontSize: 44 }}>🧭</Text>
          </View>
          <Text style={styles.accuracyWarning}>±6 m GPS accuracy</Text>
        </View>

        <View style={styles.targetInfo}>
          <Text style={styles.targetTitle}>Rafflesia tuan-mudae</Text>
          <Text style={styles.targetLoc}>West trail junction · NP-2026-0417</Text>
          <View style={styles.statRow}>
            <View><Text style={styles.statVal}>140 m</Text><Text style={styles.statLabel}>remaining</Text></View>
            <View><Text style={styles.statVal}>~3 min</Text><Text style={styles.statLabel}>walk</Text></View>
          </View>
        </View>

        <TouchableOpacity style={styles.arriveBtn} onPress={() => router.replace('/(tabs)/scan' as any)}>
          <Text style={styles.arriveBtnText}>Arrived - scan tag</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, padding: 22, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  backChevron: { fontSize: 32, color: '#213B2A', marginRight: 10 },
  headerTag: { fontSize: 13, color: '#5C7163', fontWeight: '600' },
  compassCard: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 24, alignItems: 'center', borderWidth: 1.2, borderColor: '#E6ECE8' },
  directionDistance: { fontSize: 32, fontWeight: '800', color: '#1E2B22' },
  directionInstruction: { fontSize: 13, color: '#68776D', marginTop: 4, marginBottom: 20 },
  compassRing: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#EDF5EF', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  accuracyWarning: { fontSize: 11.5, color: '#447C56', fontWeight: '600' },
  targetInfo: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, borderWidth: 1.2, borderColor: '#E6ECE8' },
  targetTitle: { fontSize: 17, fontWeight: '700', color: '#1E2B22' },
  targetLoc: { fontSize: 12.5, color: '#68776D', marginTop: 2, marginBottom: 14 },
  statRow: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: '#EEF2EF', paddingTop: 12 },
  statVal: { fontSize: 16, fontWeight: '800', color: '#213B2A' },
  statLabel: { fontSize: 11, color: '#7E8F83' },
  arriveBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  arriveBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },
});