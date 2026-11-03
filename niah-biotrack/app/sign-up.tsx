import React, { useState } from 'react';
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
import type { TextInputInstance } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LeafLogo from '../src/components/LeafLogo';
import FormScrollView from '../src/components/FormScrollView';
import { supabase } from '../src/lib/supabase';
import { useAuthRole } from '../src/context/AuthRoleContext';

// Returns what's wrong with the password, or '' when it meets the rule:
// at least 12 characters with an upper-case letter, a lower-case letter and a number.
function passwordProblem(password: string): string {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (!/[A-Z]/.test(password)) return 'Add an upper-case letter.';
  if (!/[a-z]/.test(password)) return 'Add a lower-case letter.';
  if (!/[0-9]/.test(password)) return 'Add a number.';
  return '';
}

// "Create a free account": a visitor account. The database gives every account made
// here the visitor role (source 'app'); nothing sent from the phone can change that.
export default function SignUpScreen() {
  const router = useRouter();
  const { checkUserRole } = useAuthRole();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // True when Supabase wants the email confirmed before the first login.
  const [checkEmail, setCheckEmail] = useState(false);

  const emailRef = React.useRef<TextInputInstance>(null);
  const passwordRef = React.useRef<TextInputInstance>(null);
  const confirmRef = React.useRef<TextInputInstance>(null);

  const handleSignUp = async () => {
    if (loading) return;
    const name = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!name || !cleanEmail || !password || !confirm) {
      setError('Fill in every field.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords are not the same.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Leaving guest mode: the new account replaces it.
      await AsyncStorage.removeItem('niah_is_guest_visitor');
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { source: 'app', name } },
      });

      if (signUpError) {
        if (signUpError.name === 'AuthRetryableFetchError' || signUpError.status === 0) {
          setError("Can't reach the server. Check your connection and try again.");
        } else if (/already registered|already exists/i.test(signUpError.message)) {
          setError('An account with this email already exists. Try logging in.');
        } else {
          setError(signUpError.message || 'Could not create the account. Please try again.');
        }
        return;
      }

      setPassword('');
      setConfirm('');
      if (data.session) {
        // Signed in straight away: load the visitor role and go to Home.
        await checkUserRole();
        router.replace('/(tabs)/home');
      } else {
        // "Confirm email" is on in Supabase: the first login waits for the link.
        setCheckEmail(true);
      }
    } catch {
      setError('Could not create the account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (checkEmail) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.container, styles.centered]}>
          <LeafLogo width={100} height={64} marginBottom={14} />
          <Text style={styles.title}>Check your email to confirm your account</Text>
          <Text style={styles.subtitle}>
            We sent a link to {email.trim().toLowerCase()}. Open it, then log in with your email and password.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/')}>
            <Text style={styles.primaryBtnText}>Back to log in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        <LeafLogo width={100} height={64} marginBottom={14} />
        <Text style={styles.title}>Create a free account</Text>

        <Text style={styles.label}>Full name</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
          placeholderTextColor="#8C9A91"
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          ref={emailRef}
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          placeholderTextColor="#8C9A91"
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordWrapper}>
          <TextInput
            ref={passwordRef}
            style={styles.passwordInput}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
            <Text style={styles.showText}>{showPassword ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>At least 12 characters, with an upper-case letter, a lower-case letter and a number.</Text>

        <Text style={styles.label}>Confirm password</Text>
        <TextInput
          ref={confirmRef}
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={handleSignUp}
        />

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity style={[styles.primaryBtn, loading && styles.disabled]} onPress={handleSignUp} disabled={loading}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Create account</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()} style={styles.linkBtn}>
          <Text style={styles.linkText}>Already have an account? Log in</Text>
        </TouchableOpacity>
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 28, justifyContent: 'center' },
  centered: { alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#213B2A', textAlign: 'center', marginBottom: 18 },
  subtitle: { fontSize: 14, color: '#4E6254', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '700', color: '#213B2A', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 8 },
  passwordWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, borderWidth: 1.2, borderColor: '#E6ECE8' },
  passwordInput: { flex: 1, fontSize: 14, color: '#1E2B22' },
  showText: { fontSize: 13, fontWeight: '700', color: '#526659', marginLeft: 8 },
  hint: { fontSize: 11.5, color: '#68776D', marginTop: 6, marginBottom: 4, lineHeight: 16 },
  errorText: { color: '#9B1C1C', fontSize: 12.5, marginTop: 8 },
  primaryBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginTop: 16, alignSelf: 'stretch' },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  linkBtn: { alignSelf: 'center', marginTop: 16 },
  linkText: { color: '#213B2A', fontSize: 13, fontWeight: '700' },
});
