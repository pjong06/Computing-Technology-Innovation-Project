import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import LeafLogo from '../src/components/LeafLogo';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState(false);

  const handleLogin = () => {
    if (!email.trim() || !password.trim()) {
      setAuthError(true);
      return;
    }
    setAuthError(false);
    router.replace('/(tabs)/home' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Design Emblem */}
        <LeafLogo width={120} height={75} marginBottom={14} />

        <Text style={styles.brandTitle}>Niah Ground-Truth</Text>
        <Text style={styles.brandSubtitle}>Biodiversity documentation system</Text>

        <View style={styles.form}>
          <Text style={styles.inputLabel}>Staff ID or email</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. sfc.botanist@sarawakforestry.com"
            placeholderTextColor="#8C9A91"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
          />

          <Text style={styles.inputLabel}>Password</Text>
          <View style={styles.passwordWrapper}>
            <TextInput
              style={styles.passwordInput}
              placeholder="••••••••"
              placeholderTextColor="#8C9A91"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Text style={styles.eyeIcon}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </TouchableOpacity>
          </View>

          {authError && (
            <Text style={styles.errorText}>
              Incorrect password. Check it and try again, or reset it below.
            </Text>
          )}

          <TouchableOpacity style={styles.loginBtn} activeOpacity={0.85} onPress={handleLogin}>
            <Text style={styles.loginBtnText}>Log in</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/forgot-password' as any)} style={styles.forgotBtn}>
            <Text style={styles.forgotBtnText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.offlineNotice}>✓ Works offline after your first sign-in</Text>
          <Text style={styles.helpText}>
            No account? Contact your Conservation Officer to be registered on the system.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  brandTitle: { fontSize: 26, fontWeight: '800', color: '#213B2A', textAlign: 'center' },
  brandSubtitle: { fontSize: 13.5, color: '#68776D', textAlign: 'center', marginBottom: 26 },
  form: { width: '100%' },
  inputLabel: { fontSize: 13, fontWeight: '700', color: '#213B2A', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 8 },
  passwordWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 12 },
  passwordInput: { flex: 1, fontSize: 14, color: '#1E2B22' },
  eyeIcon: { fontSize: 16, color: '#68776D', marginLeft: 8 },
  errorText: { color: '#9B1C1C', fontSize: 12.5, marginBottom: 10 },
  loginBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  loginBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  forgotBtn: { alignSelf: 'center', marginTop: 14 },
  forgotBtnText: { color: '#213B2A', fontSize: 13, fontWeight: '700' },
  footer: { marginTop: 32, alignItems: 'center' },
  offlineNotice: { fontSize: 12.5, fontWeight: '600', color: '#213B2A', marginBottom: 6 },
  helpText: { fontSize: 11.5, color: '#7E8F83', textAlign: 'center', lineHeight: 16 },
});