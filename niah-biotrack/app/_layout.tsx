import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import Toast from 'react-native-toast-message';
import { AuthRoleProvider } from '../src/context/AuthRoleContext';
import { initializeOfflineDatabase } from '../src/services/offlineDatabase';
import { useRecordStore } from '../src/store/useRecordStore';

export default function RootLayout() {
  useEffect(() => {
    const initializeOfflineData = async () => {
      await initializeOfflineDatabase();

      if (!useRecordStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsubscribe = useRecordStore.persist.onFinishHydration(() => {
            unsubscribe();
            resolve();
          });
        });
      }

      await useRecordStore.getState().hydrateOfflineRecords();
    };

    void initializeOfflineData().catch((error) => {
      console.error('Could not initialize offline data:', error);
    });
  }, []);

  return (
    <AuthRoleProvider>
      <StatusBar barStyle="dark-content" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#F6F8F6' },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="change-password" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="new-record" />
        <Stack.Screen name="save-confirm" />
        <Stack.Screen name="plant-detail" />
        <Stack.Screen name="species-reference/index" />
        <Stack.Screen name="species-reference/[id]" />
        <Stack.Screen name="attach-tag" />
        <Stack.Screen name="add-observation" />
        <Stack.Screen name="record-route" />
        <Stack.Screen name="link-route" />
        <Stack.Screen name="offline-map" />
        <Stack.Screen name="manual-qr" />
      </Stack>
      <Toast />
    </AuthRoleProvider>
  );
}
