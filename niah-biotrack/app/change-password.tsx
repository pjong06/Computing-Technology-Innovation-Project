import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Platform, StatusBar} from 'react-native';
import { useRouter } from 'expo-router';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleReset = () => {
    if (pass !== confirm) return Alert.alert('Mismatch', 'Passwords do not match.');
    Alert.alert('Success', 'Password reset.', [{ text: 'Log in', onPress: () => router.replace('/' as any) }]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Text style={styles.backChevron}>‹</Text></TouchableOpacity>
      <View style={styles.container}>
        <Text style={styles.title}>Set new password</Text>
        <TextInput style={styles.input} placeholder="New password" secureTextEntry value={pass} onChangeText={setPass} />
        <TextInput style={styles.input} placeholder="Confirm password" secureTextEntry value={confirm} onChangeText={setConfirm} />
        <TouchableOpacity style={styles.btn} onPress={handleReset}><Text style={styles.btnText}>Confirm</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6',paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  backBtn: { paddingHorizontal: 20, paddingTop: 12 },
  backChevron: { fontSize: 32, color: '#213B2A' },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', marginTop: -40 },
  title: { fontSize: 24, fontWeight: '700', color: '#213B2A', textAlign: 'center', marginBottom: 24 },
  input: { backgroundColor: '#FFFFFF', height: 52, borderRadius: 26, paddingHorizontal: 20, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 18 },
  btn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: '700' }
});