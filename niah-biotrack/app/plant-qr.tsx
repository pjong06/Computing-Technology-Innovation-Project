import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert, StatusBar, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function PlantQRScreen() {
  const router = useRouter();
  const { id, scientificName } = useLocalSearchParams();

  return (
    <SafeAreaView style={styles.safeArea}>
      <TouchableOpacity onPress={() => router.back()} style={{padding: 20}}><Text style={{fontSize: 28}}>‹</Text></TouchableOpacity>
      <View style={styles.container}>
        <Text style={styles.title}>{scientificName}</Text>
        <Text style={{textAlign: 'center', marginBottom: 20}}>ID: {id}</Text>
        <View style={styles.qrBox}><Text style={{fontSize: 80}}>🏁</Text></View>
        <TouchableOpacity style={styles.btn} onPress={() => Alert.alert('Print', 'Sending to printer...')}><Text style={{color:'#FFF', fontWeight:'bold'}}>Print Tag</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#1E2B22', textAlign: 'center' },
  qrBox: { alignSelf: 'center', width: 200, height: 200, backgroundColor: '#E6ECE8', justifyContent: 'center', alignItems: 'center', borderRadius: 20, marginBottom: 30 },
  btn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' }
});