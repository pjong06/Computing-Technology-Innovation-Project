import React, { useRef, useState, useEffect } from 'react';
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
import Toast from 'react-native-toast-message';
import LeafLogo from '../src/components/LeafLogo';
import FormScrollView from '../src/components/FormScrollView';
import { supabase } from '../src/lib/supabase';
import { useProfileStore } from '../src/store/useProfileStore';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const confirmRef = useRef<any>(null);

  const me = useProfileStore((state) => state.me);

  useEffect(() => {
    if (me?.email) {
      setUserEmail(me.email);
    } else {
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.email) {
          setUserEmail(data.user.email);
        }
      });
    }
  }, [me]);

  const hasLength = password.length >= 8;
  const hasNumber = /\d/.test(password);

  const handleReset = async () => {
    if (!hasLength || !hasNumber) {
      Toast.show({
        type: 'error',
        text1: 'Password Requirements',
        text2: 'Password must be at least 8 characters and include a number.',
      });
      return;
    }

    if (password !== confirmPassword) {
      Toast.show({
        type: 'error',
        text1: 'Passwords Do Not Match',
        text2: 'Ensure both password inputs match.',
      });
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        throw error;
      }

      Toast.show({
        type: 'success',
        text1: 'Password Updated',
        text2: 'Your permanent password has been saved.',
      });

      router.replace('/(tabs)/home' as any);
    } catch (err: any) {
      Toast.show({
        type: 'error',
        text1: 'Update Failed',
        text2: err.message || 'Could not update password on server.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <FormScrollView contentContainerStyle={styles.container}>
        <LeafLogo width={100} height={64} marginBottom={14} />

        <Text style={styles.title}>Set new password</Text>
        <Text style={styles.subtitle}>
          {userEmail ? `For ${userEmail}` : 'Enter your new account password'}
        </Text>

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

        <TouchableOpacity
          style={[styles.primaryBtn, isLoading && { opacity: 0.7 }]}
          onPress={handleReset}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Reset password</Text>
          )}
        </TouchableOpacity>
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
  container: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 32, justifyContent: 'center' },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#213B2A',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: { fontSize: 13, color: '#68776D', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '700', color: '#213B2A', marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: '#FFFFFF',
    height: 50,
    borderRadius: 25,
    paddingHorizontal: 18,
    fontSize: 14,
    color: '#1E2B22',
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 10,
  },
  criteriaRow: { marginBottom: 14, paddingHorizontal: 4 },
  criteriaText: { fontSize: 12, color: '#88988D', marginVertical: 2 },
  criteriaActive: { color: '#215A36', fontWeight: '700' },
  primaryBtn: {
    backgroundColor: '#213B2A',
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 14,
  },
  primaryBtnText: { color: '#FFF', fontSize: 14.5, fontWeight: '700' },
});