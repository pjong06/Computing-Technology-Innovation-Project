import React from 'react';
import { Tabs } from 'expo-router';
import { Text, Platform, StyleSheet } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#213B2A',
        tabBarInactiveTintColor: '#88988D',
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🏠</Text> }} />
      <Tabs.Screen name="records" options={{ title: 'My Records', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📋</Text> }} />
      <Tabs.Screen name="species" options={{ title: 'Species', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🌿</Text> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>👤</Text> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: { backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E6ECE8', height: Platform.OS === 'ios' ? 84 : 64, paddingBottom: Platform.OS === 'ios' ? 24 : 8, paddingTop: 8 },
  tabLabel: { fontSize: 11, fontWeight: '700' },
});