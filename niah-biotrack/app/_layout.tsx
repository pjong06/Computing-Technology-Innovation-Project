import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import Toast from 'react-native-toast-message';

export default function RootLayout() {
  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor="#F6F8F6" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F6F8F6' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="change-password" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="new-record" />
        <Stack.Screen name="save-confirm" />
        <Stack.Screen name="scan-qr" />
        <Stack.Screen name="manual-qr" />
        <Stack.Screen name="plant-qr" />
        <Stack.Screen name="plant-detail" />
      </Stack>
      <Toast />
    </>
  );
}