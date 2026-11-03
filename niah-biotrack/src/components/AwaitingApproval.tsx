import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthRole } from '../context/AuthRoleContext';

// Shown instead of the app for a signed-in account that isn't active yet (or has been
// suspended, or has no staff role). New sign-ups start like this until an officer
// activates them; the server refuses every request from such an account anyway.
export default function AwaitingApproval() {
  const router = useRouter();
  const { userName, checkUserRole, logout } = useAuthRole();
  const [checking, setChecking] = useState(false);

  // The officer may have activated the account since: look again.
  const checkAgain = async () => {
    setChecking(true);
    await checkUserRole();
    setChecking(false);
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.icon}>⏳</Text>
        <Text style={styles.title}>Account awaiting approval</Text>
        {userName ? <Text style={styles.name}>{userName}</Text> : null}
        <Text style={styles.body}>
          An officer from Sarawak Forestry Corporation needs to activate this account before it can be
          used. If it was active before, it may have been suspended. Contact the officer if you think
          this is a mistake.
        </Text>

        <TouchableOpacity style={styles.primaryBtn} onPress={checkAgain} disabled={checking}>
          {checking ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Check again</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleLogout}>
          <Text style={styles.secondaryBtnText}>Log out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, padding: 28, justifyContent: 'center', alignItems: 'center' },
  icon: { fontSize: 44, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#213B2A', textAlign: 'center' },
  name: { fontSize: 14, color: '#526659', marginTop: 4 },
  body: { fontSize: 14, color: '#4E6254', textAlign: 'center', lineHeight: 20, marginTop: 14, marginBottom: 28 },
  primaryBtn: { backgroundColor: '#213B2A', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch', marginTop: 12, borderWidth: 1.2, borderColor: '#213B2A', backgroundColor: '#FFFFFF' },
  secondaryBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 15 },
});
