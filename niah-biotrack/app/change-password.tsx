import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, SafeAreaView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import FormScrollView from '../src/components/FormScrollView';
import { supabase } from '../src/lib/supabase';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const prepare = async (url: string | null) => {
      try {
        if (url && url.startsWith('niahbiotrack://change-password')) {
          const fragment = url.split('#')[1] || '';
          const query = url.split('?')[1]?.split('#')[0] || '';
          const params = new URLSearchParams(fragment || query);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token && refresh_token) {
            const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
            if (sessionError) throw sessionError;
          } else if (params.get('error')) {
            throw new Error('This recovery link is invalid or expired. Request a new link.');
          }
        }
        const { data, error: userError } = await supabase.auth.getUser();
        if (userError || !data.user) throw new Error('Open a valid recovery link from your email.');
        if (active) { setError(''); setReady(true); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not verify recovery link.');
      }
    };
    Linking.getInitialURL().then(prepare).catch(() => setError('Could not open the recovery link.'));
    const subscription = Linking.addEventListener('url', ({ url }) => prepare(url));
    return () => { active = false; subscription.remove(); };
  }, []);

  const save = async () => {
    if (saving) return;
    if (password.length < 8 || !/\d/.test(password) || password !== confirm) {
      setError('Use at least 8 characters and a number, and make both entries match.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError('Could not update password. Request a new link and try again.');
      return;
    }
    setPassword('');
    setConfirm('');
    await supabase.auth.signOut({ scope: 'local' });
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Set new password</Text>
        {!ready && !error ? <ActivityIndicator color="#213B2A" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {ready ? <>
          <TextInput style={styles.input} secureTextEntry placeholder="New password" value={password}
            onChangeText={setPassword} autoComplete="new-password" />
          <TextInput style={styles.input} secureTextEntry placeholder="Confirm password" value={confirm}
            onChangeText={setConfirm} autoComplete="new-password" />
          <TouchableOpacity style={styles.button} onPress={save} disabled={saving}>
            <Text style={styles.buttonText}>{saving ? 'Saving...' : 'Update password'}</Text>
          </TouchableOpacity>
        </> : <TouchableOpacity onPress={() => router.replace('/forgot-password')}>
          <Text style={styles.link}>Request a new link</Text>
        </TouchableOpacity>}
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#213B2A', textAlign: 'center', marginBottom: 20 },
  input: { backgroundColor: '#fff', height: 50, borderRadius: 25, paddingHorizontal: 18, marginBottom: 12 },
  error: { color: '#9B1C1C', textAlign: 'center', marginBottom: 16 },
  button: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  link: { color: '#213B2A', textAlign: 'center', marginTop: 16 },
});
