import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import LeafLogo from '../src/components/LeafLogo';
import FormScrollView from '../src/components/FormScrollView';
import { BASE_URL } from '../src/api/client';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const requestReset = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (!BASE_URL) throw new Error('The recovery service is not configured.');
      const response = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      if (response.status === 429) throw new Error('Too many requests. Please try again later.');
      if (!response.ok) throw new Error('Password recovery is unavailable. Please try again later.');
      setMessage('If an account exists for that email, a reset link will be sent. Check your inbox and spam folder.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request a reset link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        <LeafLogo width={110} height={70} marginBottom={14} />
        <Text style={styles.title}>Forgot password</Text>
        <Text style={styles.subtitle}>Enter your registered email. We will send a link to set a new password.</Text>
        <Text style={styles.label}>Email</Text>
        <TextInput style={styles.input} value={email} onChangeText={setEmail}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
          autoComplete="email" placeholder="you@example.com" />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={requestReset} disabled={loading || !!message}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send reset link</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/')}>
          <Text style={styles.back}>Back to login</Text>
        </TouchableOpacity>
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: '#213B2A', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#68776D', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '700', color: '#213B2A', marginBottom: 6 },
  input: { backgroundColor: '#fff', height: 50, borderRadius: 25, paddingHorizontal: 18, marginBottom: 12 },
  error: { color: '#9B1C1C', marginBottom: 12 },
  message: { color: '#215A36', marginBottom: 12 },
  button: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  back: { textAlign: 'center', color: '#213B2A', marginTop: 20 },
});
