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
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import LeafLogo from '../src/components/LeafLogo';

// Computer LAN IP running the backend
const API_BASE_URL = 'http://172.17.97.165:3000';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerated, setIsGenerated] = useState(false);

  // Generate a random temporary password (alphanumeric + safe symbols)
  const generateRandomPassword = (length = 9): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789#$!';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleGenerateTempPassword = async () => {
    const cleanId = identifier.trim();
    if (!cleanId) {
      Toast.show({
        type: 'error',
        text1: 'Input Required',
        text2: 'Please enter your Staff ID or registered email.',
      });
      return;
    }

    setIsLoading(true);

    try {
      const newPassword = generateRandomPassword(9);

      const response = await fetch(`${API_BASE_URL}/api/auth/temp-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: cleanId,
          tempPassword: newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update temporary password on server.');
      }

      setTempPassword(newPassword);
      setIsGenerated(true);

      Toast.show({
        type: 'success',
        text1: 'Temporary Password Set',
        text2: 'Updated in database. Tap the box below to copy.',
      });
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Connection Error',
        text2: error.message || 'Could not connect to backend server.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyPassword = async () => {
    if (!tempPassword) return;

    await Clipboard.setStringAsync(tempPassword);

    Toast.show({
      type: 'success',
      text1: 'Copied to Clipboard',
      text2: 'Temporary password copied. Paste it into the login screen.',
      position: 'bottom',
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Dual-Leaf Emblem */}
          <LeafLogo width={110} height={70} marginBottom={14} />

          <Text style={styles.title}>Reset Password</Text>

          {!isGenerated ? (
            <>
              <Text style={styles.subtitle}>
                Enter your registered Staff ID or email to generate a temporary one-time access password.
              </Text>

              <View style={styles.form}>
                <Text style={styles.label}>Staff ID or email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. sfc.botanist@sarawakforestry.com"
                  placeholderTextColor="#8C9A91"
                  value={identifier}
                  onChangeText={setIdentifier}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <TouchableOpacity
                  style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
                  activeOpacity={0.85}
                  onPress={handleGenerateTempPassword}
                  disabled={isLoading}
                >
                  <Text style={styles.primaryBtnText}>
                    {isLoading ? 'Connecting to server...' : 'Generate temporary password'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.backLinkBtn}
                  onPress={() => router.back()}
                >
                  <Text style={styles.backLinkText}>Back to login</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.footer}>
                <Text style={styles.footerNotice}>
                  Temporary passwords expire after your next successful login.
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.successCard}>
              <View style={styles.iconCircle}>
                <Text style={{ fontSize: 32 }}>🔑</Text>
              </View>

              <Text style={styles.successHeading}>Temporary Password Ready</Text>
              <Text style={styles.successSub}>
                Issued for account:{'\n'}
                <Text style={styles.highlightEmail}>{identifier}</Text>
              </Text>

              {/* Password Display Box with Tap-to-Copy */}
              <TouchableOpacity
                style={styles.passwordDisplayBox}
                activeOpacity={0.7}
                onPress={handleCopyPassword}
              >
                <Text style={styles.passwordDisplayLabel}>TEMPORARY ACCESS CODE</Text>
                <Text style={styles.passwordCodeText}>
                  {tempPassword}
                </Text>
                <Text style={styles.copyHint}>📋 Tap anywhere in this box to copy</Text>
              </TouchableOpacity>

              <View style={styles.infoNotice}>
                <Text style={styles.infoNoticeText}>
                  ✓ Updated directly in database{'\n'}
                  ✓ Update your permanent password once signed in
                </Text>
              </View>

              <TouchableOpacity
                style={styles.primaryBtn}
                activeOpacity={0.85}
                onPress={() => router.replace('/')}
              >
                <Text style={styles.primaryBtnText}>Proceed to Log In</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.resendBtn}
                onPress={() => {
                  setIsGenerated(false);
                  setTempPassword('');
                }}
              >
                <Text style={styles.resendBtnText}>Generate a different code</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#213B2A',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13.5,
    color: '#68776D',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 26,
    paddingHorizontal: 6,
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#213B2A',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#FFFFFF',
    height: 50,
    borderRadius: 25,
    paddingHorizontal: 18,
    fontSize: 14,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: '#213B2A',
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 12,
    width: '100%',
  },
  btnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  backLinkBtn: {
    alignSelf: 'center',
    paddingVertical: 10,
  },
  backLinkText: {
    color: '#213B2A',
    fontSize: 13.5,
    fontWeight: '700',
  },
  footer: {
    marginTop: 28,
    alignItems: 'center',
  },
  footerNotice: {
    fontSize: 12,
    color: '#88988D',
    textAlign: 'center',
  },
  successCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    padding: 22,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E6EFE9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  successHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#213B2A',
    marginBottom: 6,
    textAlign: 'center',
  },
  successSub: {
    fontSize: 13,
    color: '#68776D',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  highlightEmail: {
    fontWeight: '700',
    color: '#213B2A',
  },
  passwordDisplayBox: {
    width: '100%',
    backgroundColor: '#F1F6F2',
    borderWidth: 1.5,
    borderColor: '#213B2A',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  passwordDisplayLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#5C7163',
    letterSpacing: 1,
    marginBottom: 6,
  },
  passwordCodeText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#213B2A',
    letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  copyHint: {
    fontSize: 12,
    color: '#284632',
    fontWeight: '600',
    marginTop: 8,
  },
  infoNotice: {
    backgroundColor: '#F9FAF9',
    borderRadius: 14,
    padding: 12,
    marginBottom: 18,
    width: '100%',
  },
  infoNoticeText: {
    fontSize: 12,
    color: '#4B5E51',
    lineHeight: 18,
    textAlign: 'center',
  },
  resendBtn: {
    marginTop: 6,
    paddingVertical: 8,
  },
  resendBtnText: {
    color: '#213B2A',
    fontSize: 13,
    fontWeight: '700',
  },
});

