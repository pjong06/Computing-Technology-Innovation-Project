import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import LeafLogo from '../src/components/LeafLogo';
import FormScrollView from '../src/components/FormScrollView';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const confirmRef = useRef<TextInput>(null);

  const hasLength = password.length >= 8;
  const hasNumber = /\d/.test(password);

  const handleReset = () => {
    if (!hasLength || !hasNumber || password !== confirmPassword) {
      Toast.show({
        type: 'error',
        text1: 'Password Error',
        text2: 'Please satisfy all password criteria.',
      });
      return;
    }

    Toast.show({
      type: 'success',
      text1: 'Password Reset',
      text2: 'Your password has been updated.',
    });
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        <LeafLogo width={100} height={64} marginBottom={14} />

        <Text style={styles.title}>Set new password</Text>
        <Text style={styles.subtitle}>For sfc.botanist@sarawakforestry.com</Text>

        <Text style={styles.label}>New password</Text>
        <TextInput
          style={styles.input}
          secureTextEntry
          placeholder="••••••••••"
          placeholderTextColor="#8C9A91"
          value={password}
          onChangeText={setPassword}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />

        <View style={styles.criteriaRow}>
          <Text style={[styles.criteriaText, hasLength && styles.criteriaActive]}>
            {hasLength ? '☑' : '☐'} At least 8 characters
          </Text>
          <Text style={[styles.criteriaText, hasNumber && styles.criteriaActive]}>
            {hasNumber ? '☑' : '☐'} Includes a number
          </Text>
        </View>

        <Text style={styles.label}>Confirm password</Text>
        <TextInput
          ref={confirmRef}
          style={styles.input}
          secureTextEntry
          placeholder="••••••••••"
          placeholderTextColor="#8C9A91"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          returnKeyType="done"
          onSubmitEditing={handleReset}
        />

        <TouchableOpacity style={styles.primaryBtn} onPress={handleReset}>
          <Text style={styles.primaryBtnText}>Reset password</Text>
        </TouchableOpacity>
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 32, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#213B2A', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#68776D', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '700', color: '#213B2A', marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 10 },
  criteriaRow: { marginBottom: 14, paddingHorizontal: 4 },
  criteriaText: { fontSize: 12, color: '#88988D', marginVertical: 2 },
  criteriaActive: { color: '#215A36', fontWeight: '700' },
  primaryBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginTop: 14 },
  primaryBtnText: { color: '#FFF', fontSize: 14.5, fontWeight: '700' },
});