import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { useRouter } from 'expo-router';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <SafeAreaView style={styles.safeArea}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Text style={styles.backChevron}>‹</Text></TouchableOpacity>
      <View style={styles.container}>
        {!sent ? (
          <>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>Enter your registered email.</Text>
            <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#8C9A91" value={email} onChangeText={setEmail} autoCapitalize="none" />
            <TouchableOpacity style={styles.btn} onPress={() => setSent(true)}><Text style={styles.btnText}>Send Link</Text></TouchableOpacity>
          </>
        ) : (
          <View style={{alignItems: 'center'}}>
            <Text style={styles.title}>Check your inbox</Text>
            <TouchableOpacity style={styles.btn} onPress={() => router.push('/change-password' as any)}><Text style={styles.btnText}>Set New Password</Text></TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6' },
  backBtn: { paddingHorizontal: 20, paddingTop: 12 },
  backChevron: { fontSize: 32, color: '#213B2A' },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', marginTop: -40 },
  title: { fontSize: 24, fontWeight: '700', color: '#213B2A', textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 14, color: '#68776D', textAlign: 'center', marginBottom: 24 },
  input: { backgroundColor: '#FFFFFF', height: 52, borderRadius: 26, paddingHorizontal: 20, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 22 },
  btn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', width: '100%' },
  btnText: { color: '#FFFFFF', fontWeight: '700' }
});