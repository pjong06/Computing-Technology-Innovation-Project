import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, ScrollView, Alert, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = () => {
    if (!email.trim() || !password.trim()) return Alert.alert('Required', 'Enter your credentials.');
    router.replace('/(tabs)/home' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} bounces={false}>
          <Text style={styles.brandTitle}>Niah BioTrack</Text>
          <Text style={styles.subtitle}>Biodiversity documentation system</Text>

          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Staff ID or email" placeholderTextColor="#8C9A91" value={email} onChangeText={setEmail} autoCapitalize="none" />
            <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#8C9A91" secureTextEntry value={password} onChangeText={setPassword} />

            <TouchableOpacity style={styles.loginBtn} activeOpacity={0.85} onPress={handleLogin}>
              <Text style={styles.loginBtnText}>LOGIN</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push('/forgot-password' as any)} style={styles.forgotBtn}>
              <Text style={styles.forgotBtnText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6',paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center', paddingVertical: 40 },
  brandTitle: { fontSize: 28, fontWeight: '800', color: '#213B2A', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#68776D', textAlign: 'center', marginBottom: 40, marginTop: 4 },
  form: { width: '100%' },
  input: { backgroundColor: '#FFFFFF', height: 52, borderRadius: 26, paddingHorizontal: 20, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 18 },
  loginBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  loginBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.8 },
  forgotBtn: { alignSelf: 'center', marginTop: 20 },
  forgotBtnText: { color: '#213B2A', fontSize: 13.5, fontWeight: '700' },
});