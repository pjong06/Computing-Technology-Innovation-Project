import React from 'react';
import { Tabs } from 'expo-router';
import { Text, Platform, StyleSheet } from 'react-native';
import { useAuthRole } from '../../src/context/AuthRoleContext';
import AwaitingApproval from '../../src/components/AwaitingApproval';

export default function TabLayout() {
  // Guests and visitors: Home, Plants, Scan, Profile (the visitor Plant guide, no Records).
  // Staff: Home, Species, Scan, Records, Profile. href: null hides a tab (Expo Router).
  const { isVisitor, isPending } = useAuthRole();

  // Signed in but not an active staff account: nothing in the app is usable yet.
  if (isPending) return <AwaitingApproval />;

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
      <Tabs.Screen
        name="species"
        options={{
          title: 'Species',
          href: isVisitor ? null : undefined,
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🌿</Text>,
        }}
      />
      <Tabs.Screen
        name="plants"
        options={{
          title: 'Plants',
          href: isVisitor ? undefined : null,
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🌿</Text>,
        }}
      />
      <Tabs.Screen name="scan" options={{ title: 'Scan', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📷</Text> }} />
      <Tabs.Screen
        name="records"
        options={{
          title: 'Records',
          href: isVisitor ? null : undefined,
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📋</Text>,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>👤</Text> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E6ECE8',
    height: Platform.OS === 'ios' ? 86 : 64,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 8,
  },
  tabLabel: { fontSize: 11, fontWeight: '700' },
});