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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import LeafLogo from '../src/components/LeafLogo';
import FormScrollView from '../src/components/FormScrollView';
import KeyboardDoneBar from '../src/components/KeyboardDoneBar';

import { API_BASE_URL } from '../src/config/api';

const DONE_BAR_ID = 'forgot-password-done';

export default function ForgotPasswordScreen() {
  const router = useRouter();

  // Wizard Steps (1: Enter Email/Staff ID, 2: Enter Code & New Password, 3: Success)
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [identifier, setIdentifier] = useState('');
  const [resolvedEmail, setResolvedEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // STEP 1: Request 6-digit code sent to Gmail
  const handleSendCode = async () => {
    const cleanId = identifier.trim();
    if (!cleanId) {
      Toast.show({
        type: 'error',
        text1: 'Input Required',
        text2: 'Enter your Staff ID or registered email.',
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/send-reset-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanId }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send verification code.');
      }

      setResolvedEmail(data.email || cleanId);
      setStep(2);

      Toast.show({
        type: 'success',
        text1: 'Verification Code Sent',
        text2: `A 6-digit code was sent to ${data.email || cleanId}.`,
      });
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Request Failed',
        text2: error.message || 'Could not connect to backend server.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // STEP 2: Verify 6-digit code and apply new password
  const handleVerifyAndChangePassword = async () => {
    const cleanCode = verificationCode.trim();
    const cleanPass = newPassword.trim();

    if (!cleanCode || cleanCode.length < 6) {
      Toast.show({
        type: 'error',
        text1: 'Invalid Code',
        text2: 'Enter the full 6-digit code sent to your Gmail.',
      });
      return;
    }

    if (cleanPass.length < 8) {
      Toast.show({
        type: 'error',
        text1: 'Password Too Short',
        text2: 'New password must be at least 8 characters long.',
      });
      return;
    }

    if (cleanPass !== confirmPassword.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Passwords Do Not Match',
        text2: 'Ensure both password inputs match exactly.',
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/verify-and-change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: resolvedEmail,
          code: cleanCode,
          newPassword: cleanPass,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update password.');
      }

      setStep(3);

      Toast.show({
        type: 'success',
        text1: 'Password Updated',
        text2: 'Your account password has been reset successfully.',
      });
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Reset Failed',
        text2: error.message || 'Verification code failed or expired.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      {/* Shared form scroller: keyboard avoidance on Android too (it had none here). */}
      <FormScrollView contentContainerStyle={styles.scrollContainer}>
        <LeafLogo width={100} height={64} marginBottom={12} />

        {/* STEP 1: Enter Identifier */}
        {step === 1 && (
          <>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Enter your registered Staff ID or Gmail to receive a 6-digit verification code.
            </Text>

            <View style={styles.form}>
              <Text style={styles.label}>Staff ID or Email</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. botanistb@gmail.com or SFC-BOT-002"
                placeholderTextColor="#8C9A91"
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <TouchableOpacity
                style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
                activeOpacity={0.85}
                onPress={handleSendCode}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Send Verification Code</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backLinkBtn}
                onPress={() => router.back()}
              >
                <Text style={styles.backLinkText}>Back to login</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* STEP 2: Code Verification & New Password */}
        {step === 2 && (
          <View style={styles.formCard}>
            <View style={styles.headerBadge}>
              <Ionicons name="mail-open-outline" size={20} color="#2D6A4F" />
              <Text style={styles.headerBadgeText}>Code Sent</Text>
            </View>

            <Text style={styles.cardHeading}>Enter Verification Code</Text>
            <Text style={styles.cardSub}>
              We sent a 6-digit code to:{'\n'}
              <Text style={styles.highlightText}>{resolvedEmail}</Text>
            </Text>

            {/* 6-Digit OTP Input */}
            <Text style={styles.label}>6-Digit Verification Code</Text>
            <TextInput
              style={styles.otpInput}
              placeholder="123456"
              placeholderTextColor="#A8B7AC"
              value={verificationCode}
              onChangeText={setVerificationCode}
              keyboardType="number-pad"
              maxLength={6}
              inputAccessoryViewID={DONE_BAR_ID}
              autoFocus
            />

            {/* New Password */}
            <Text style={styles.label}>New Password (min 8 chars)</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter new password"
                placeholderTextColor="#8C9A91"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.eyeIconBtn}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color="#5C7163"
                />
              </TouchableOpacity>
            </View>

            {/* Confirm Password */}
            <Text style={styles.label}>Confirm New Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Re-enter new password"
              placeholderTextColor="#8C9A91"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
              activeOpacity={0.85}
              onPress={handleVerifyAndChangePassword}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>Change Password</Text>
              )}
            </TouchableOpacity>

            <View style={styles.cardActionRow}>
              <TouchableOpacity onPress={handleSendCode} disabled={isLoading}>
                <Text style={styles.actionText}>Resend Code</Text>
              </TouchableOpacity>
              <Text style={styles.actionDivider}>•</Text>
              <TouchableOpacity onPress={() => setStep(1)}>
                <Text style={styles.actionText}>Change Email</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* STEP 3: Success Screen */}
        {step === 3 && (
          <View style={styles.successCard}>
            <View style={styles.iconCircle}>
              <Ionicons name="checkmark-circle" size={48} color="#2D6A4F" />
            </View>
            <Text style={styles.cardHeading}>Password Changed</Text>
            <Text style={styles.cardSub}>
              Your password has been successfully updated in the system. You can now log in with your new credentials.
            </Text>

            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={() => router.replace('/')}
            >
              <Text style={styles.primaryBtnText}>Proceed to Login</Text>
            </TouchableOpacity>
          </View>
        )}
      </FormScrollView>
      <KeyboardDoneBar nativeID={DONE_BAR_ID} />
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
    paddingHorizontal: 22,
    paddingVertical: 24,
  },
  title: {
    fontSize: 25,
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
    marginBottom: 24,
    paddingHorizontal: 10,
  },
  form: {
    width: '100%',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    width: '100%',
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    marginBottom: 10,
  },
  headerBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2D6A4F',
  },
  cardHeading: {
    fontSize: 21,
    fontWeight: '800',
    color: '#213B2A',
    textAlign: 'center',
    marginBottom: 6,
  },
  cardSub: {
    fontSize: 13,
    color: '#68776D',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
  },
  highlightText: {
    fontWeight: '800',
    color: '#213B2A',
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#213B2A',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F9FAF9',
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E2E8E4',
    marginBottom: 14,
  },
  otpInput: {
    backgroundColor: '#F0F5F2',
    height: 52,
    borderRadius: 14,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '900',
    color: '#213B2A',
    letterSpacing: 6,
    borderWidth: 1.5,
    borderColor: '#2D6A4F',
    marginBottom: 16,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAF9',
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: '#E2E8E4',
    marginBottom: 14,
  },
  passwordInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#1E2B22',
  },
  eyeIconBtn: {
    paddingHorizontal: 14,
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
  cardActionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D6A4F',
  },
  actionDivider: {
    color: '#A8B7AC',
  },
  successCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    width: '100%',
  },
  iconCircle: {
    marginBottom: 12,
  },
});

