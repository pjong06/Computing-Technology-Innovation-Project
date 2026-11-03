import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import LeafLogo from '../src/components/LeafLogo';
import FormScrollView from '../src/components/FormScrollView';
import { supabase } from '../src/lib/supabase';
import { useAuthRole } from '../src/context/AuthRoleContext';
import { hasSavedSession } from '../src/lib/auth';

export default function LoginScreen() {
  const passwordRef = useRef<any>(null);
  const router = useRouter();
  const { checkUserRole, setVisitorMode } = useAuthRole();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    hasSavedSession()
      .then(async (signedIn) => {
        if (signedIn) {
          await checkUserRole();
          router.replace('/(tabs)/home');
        } else {
          setCheckingSession(false);
        }
      })
      .catch(() => setCheckingSession(false));
  }, []);

  const handleStaffLogin = async () => {
    if (loading) return;

    const cleanId = identifier.trim();
    if (!cleanId || !password) {
      setErrorMessage('Enter your staff email/ID and password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      await AsyncStorage.removeItem('niah_is_guest_visitor');
      let loginEmail = cleanId.toLowerCase();

      // Resolve Staff ID (e.g., SFC-BOT-002) to email if no '@' provided
      if (!cleanId.includes('@')) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .ilike('staff_id', cleanId)
          .maybeSingle();

        if (profile?.email) {
          loginEmail = profile.email.toLowerCase();
        }
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (error) {
        if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
          setErrorMessage("Cannot reach server. Check connection.");
        } else if (error.code === 'invalid_credentials' || error.status === 400) {
          setErrorMessage('Incorrect email/ID or password.');
        } else {
          setErrorMessage(error.message || 'Sign-in failed.');
        }
        setLoading(false);
        return;
      }

      await checkUserRole();
      setPassword('');
      router.replace('/(tabs)/home');
    } catch (err: any) {
      setErrorMessage(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnterAsVisitor = async () => {
    await setVisitorMode();
    Toast.show({
      type: 'info',
      text1: 'Welcome to Niah National Park',
      text2: 'Exploring in Visitor Mode (Read-Only).',
    });
    router.replace('/(tabs)/home');
  };

  if (checkingSession) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.centered]}>
        <ActivityIndicator color="#213B2A" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        <LeafLogo width={120} height={75} marginBottom={14} />

        <Text style={styles.brandTitle}>Niah Ground-Truth</Text>
        <Text style={styles.brandSubtitle}>Biodiversity documentation system</Text>

        <View style={styles.form}>
          <Text style={styles.inputLabel}>Staff Email or Staff ID</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. botanist@sarawak.gov or SFC-BOT-002"
            placeholderTextColor="#8C9A91"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => (passwordRef.current as any)?.focus()}
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
              onSubmitEditing={handleStaffLogin}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color="#68776D"
              />
            </TouchableOpacity>
          </View>

          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            activeOpacity={0.85}
            onPress={handleStaffLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.loginBtnText}>Staff Sign In</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/forgot-password')}
            style={styles.forgotBtn}
          >
            <Text style={styles.forgotBtnText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR EXPLORE PARK</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Visitor Access */}
        <TouchableOpacity
          style={styles.visitorBtn}
          activeOpacity={0.85}
          onPress={handleEnterAsVisitor}
        >
          <Ionicons name="compass-outline" size={20} color="#2D6A4F" />
          <Text style={styles.visitorBtnText}>Continue as Park Visitor</Text>
        </TouchableOpacity>
        <Text style={styles.visitorSubtext}>
          No account needed • Browse species, trails, and scan QR plaques
        </Text>

        <View style={styles.footer}>
          <Text style={styles.offlineNotice}>✓ Offline field logging available for staff</Text>
          <Text style={styles.helpText}>
            Protected Sarawak Forestry Corporation Research Portal
          </Text>
        </View>
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
    justifyContent: 'center',
  },
  centered: { justifyContent: 'center', alignItems: 'center' },
  brandTitle: { fontSize: 26, fontWeight: '800', color: '#213B2A', textAlign: 'center' },
  brandSubtitle: { fontSize: 13.5, color: '#68776D', textAlign: 'center', marginBottom: 22 },
  form: { width: '100%' },
  inputLabel: { fontSize: 13, fontWeight: '700', color: '#213B2A', marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: '#FFFFFF',
    height: 50,
    borderRadius: 25,
    paddingHorizontal: 18,
    fontSize: 14,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 8,
  },
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    height: 50,
    borderRadius: 25,
    paddingHorizontal: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 12,
  },
  passwordInput: { flex: 1, fontSize: 14, color: '#1E2B22' },
  errorText: { color: '#9B1C1C', fontSize: 12.5, marginBottom: 10, textAlign: 'center' },
  loginBtn: {
    backgroundColor: '#213B2A',
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  loginBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  loginBtnDisabled: { opacity: 0.6 },
  forgotBtn: { alignSelf: 'center', marginTop: 14 },
  forgotBtnText: { color: '#213B2A', fontSize: 13, fontWeight: '700' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#DDE5E0',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 11,
    fontWeight: '800',
    color: '#8A998E',
    letterSpacing: 0.5,
  },
  visitorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E8F5E9',
    borderWidth: 1.5,
    borderColor: '#A3D9A5',
  },
  visitorBtnText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#2D6A4F',
  },
  visitorSubtext: {
    fontSize: 11,
    color: '#76877B',
    marginTop: 8,
    textAlign: 'center',
  },
  footer: { marginTop: 28, alignItems: 'center' },
  offlineNotice: { fontSize: 12.5, fontWeight: '600', color: '#213B2A', marginBottom: 6 },
  helpText: { fontSize: 11.5, color: '#7E8F83', textAlign: 'center', lineHeight: 16 },
});
