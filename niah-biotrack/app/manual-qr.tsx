import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { useRecordStore } from '../src/store/useRecordStore';

export default function ManualQREntryScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const records = useRecordStore((state) => state.records);

  const handleLookup = () => {
    const match = records.find((r) => r.recordId.toUpperCase() === code.trim().toUpperCase());
    if (match) router.push({ pathname: '/plant-detail', params: { id: match.recordId } } as any);
    else router.push({ pathname: '/plant-detail', params: { id: code, name: 'Unknown Code' } } as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Text style={{fontSize: 28}}>‹</Text></TouchableOpacity>
      <View style={styles.container}>
        <Text style={styles.title}>Enter Code Manually</Text>
        <TextInput style={styles.input} placeholder="e.g. NB-1234" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <TouchableOpacity style={styles.btn} onPress={handleLookup}><Text style={{color:'#FFF', fontWeight:'bold'}}>Look Up</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  backBtn: { padding: 20 },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', marginTop: -60 },
  title: { fontSize: 24, fontWeight: '700', color: '#1E2B22', textAlign: 'center', marginBottom: 20 },
  input: { backgroundColor: '#FFFFFF', height: 52, borderRadius: 26, paddingHorizontal: 20, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 20 },
  btn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' }
});