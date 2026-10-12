import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import LeafLogo from '../src/components/LeafLogo';
import FormScrollView from '../src/components/FormScrollView';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        <LeafLogo width={100} height={64} marginBottom={14} />

        <Text style={styles.title}>Reset Password</Text>

        {!sent ? (
          <>
            <Text style={styles.subtitle}>
              Enter your registered email. We'll send a link to reset your password.
            </Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. sfc.botanist@sarawakforestry.com"
              placeholderTextColor="#8C9A91"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="done"
            />

            <TouchableOpacity style={styles.primaryBtn} onPress={() => setSent(true)}>
              <Text style={styles.primaryBtnText}>Send reset link</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Text style={styles.backBtnText}>Back to login</Text>
            </TouchableOpacity>

            <Text style={styles.footerNotice}>Needs an internet connection.</Text>
          </>
        ) : (
          <View style={styles.sentCard}>
            <View style={styles.mailCircle}>
              <Text style={{ fontSize: 32 }}>✉️</Text>
            </View>
            <Text style={styles.sentHeading}>Check your inbox</Text>
            <Text style={styles.sentSub}>
              We've sent a reset link to{'\n'}
              <Text style={{ fontWeight: '700', color: '#1E2B22' }}>{email || 'sfc.botanist@sarawakforestry.com'}</Text>
            </Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/')}>
              <Text style={styles.primaryBtnText}>Back to login</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.resendBtn} onPress={() => setSent(false)}>
              <Text style={styles.resendBtnText}>Didn't get it? Resend link</Text>
            </TouchableOpacity>
          </View>
        )}
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 32, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#213B2A', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 13.5, color: '#68776D', textAlign: 'center', marginBottom: 24, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '700', color: '#213B2A', marginBottom: 6 },
  input: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 18 },
  primaryBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  primaryBtnText: { color: '#FFF', fontSize: 14.5, fontWeight: '700' },
  backBtn: { alignSelf: 'center', paddingVertical: 10 },
  backBtnText: { color: '#213B2A', fontSize: 13.5, fontWeight: '700' },
  footerNotice: { textAlign: 'center', fontSize: 12, color: '#88988D', marginTop: 24 },
  sentCard: { alignItems: 'center', marginTop: 12 },
  mailCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E4EDE7', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  sentHeading: { fontSize: 20, fontWeight: '800', color: '#1E2B22', marginBottom: 6 },
  sentSub: { fontSize: 13, color: '#68776D', textAlign: 'center', lineHeight: 18, marginBottom: 24 },
  resendBtn: { paddingVertical: 10 },
  resendBtnText: { color: '#213B2A', fontSize: 13, fontWeight: '700' },
});