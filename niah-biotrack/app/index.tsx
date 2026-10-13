import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import LeafLogo from '../src/components/LeafLogo';
import FormScrollView from '../src/components/FormScrollView';
import { supabase } from '../src/lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const handleLogin = async () => {
    if (loading) return; // ignore double taps

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setErrorMessage('Enter your email and password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    setLoading(false);

    if (error) {
      // status 0 / fetch error = the phone never reached Supabase
      if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
        setErrorMessage("Can't reach the server. Check your connection and try again.");
      } else if (error.code === 'invalid_credentials' || error.status === 400) {
        setErrorMessage('Incorrect email or password. Check them and try again, or reset your password below.');
      } else {
        setErrorMessage('Sign-in failed. Please try again.');
      }
      return;
    }

    setPassword(''); // don't keep the password in memory
    router.replace('/(tabs)/home' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        {/* Design Emblem */}
        <LeafLogo width={120} height={75} marginBottom={14} />

        <Text style={styles.brandTitle}>Niah Ground-Truth</Text>
        <Text style={styles.brandSubtitle}>Biodiversity documentation system</Text>

        <View style={styles.form}>
          <Text style={styles.inputLabel}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. sfc.botanist@sarawakforestry.com"
            placeholderTextColor="#8C9A91"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <Text style={styles.inputLabel}>Password</Text>
          <View style={styles.passwordWrapper}>
            <TextInput
              ref={passwordRef}
              style={styles.passwordInput}
              placeholder="••••••••"
              placeholderTextColor="#8C9A91"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Text style={styles.eyeIcon}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </TouchableOpacity>
          </View>

          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            activeOpacity={0.85}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.loginBtnText}>Log in</Text>
            )}
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
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 32, justifyContent: 'center' },
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
  loginBtnDisabled: { opacity: 0.6 },
  forgotBtn: { alignSelf: 'center', marginTop: 14 },
  forgotBtnText: { color: '#213B2A', fontSize: 13, fontWeight: '700' },
  footer: { marginTop: 32, alignItems: 'center' },
  offlineNotice: { fontSize: 12.5, fontWeight: '600', color: '#213B2A', marginBottom: 6 },
  helpText: { fontSize: 11.5, color: '#7E8F83', textAlign: 'center', lineHeight: 16 },
});