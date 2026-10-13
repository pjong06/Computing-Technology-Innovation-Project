import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';

interface PlantNotFoundProps {
  code?: string;
}

export default function PlantNotFound({ code }: PlantNotFoundProps) {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/home' as any);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Plant not found</Text>
        <Text style={styles.sub}>
          {code ? `No plant record on this device matches ${code}.` : 'No plant record on this device matches this link.'}
        </Text>
        <TouchableOpacity style={styles.backBtn} activeOpacity={0.85} onPress={handleBack}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  title: { fontSize: 20, fontWeight: '800', color: '#213B2A', marginBottom: 8 },
  sub: { fontSize: 13.5, color: '#68776D', textAlign: 'center', lineHeight: 19, marginBottom: 24 },
  backBtn: { backgroundColor: '#213B2A', height: 48, borderRadius: 24, paddingHorizontal: 40, justifyContent: 'center', alignItems: 'center' },
  backBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
