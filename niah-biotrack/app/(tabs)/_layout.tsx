import React from 'react';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthRole } from '../../src/context/AuthRoleContext';
import AwaitingApproval from '../../src/components/AwaitingApproval';

export default function TabLayout() {
  const { isVisitor, isPending, role } = useAuthRole();

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
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Ionicons name="home-outline" size={22} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="plants"
        options={{
          title: 'Plants',
          href: isVisitor ? undefined : null,
          tabBarIcon: ({ color }) => (
            <Ionicons name="leaf-outline" size={22} color={color as string} />
          ),
        }}
      />
      {/* Staff: Plants = one row per plant (route "records"); visits are in Plant detail and
          species proposals are on Home. Visitors have their own Plants tab above. */}
      <Tabs.Screen
        name="records"
        options={{
          title: 'Plants',
          href: isVisitor ? null : undefined,
          tabBarIcon: ({ color }) => (
            <Ionicons name="leaf-outline" size={22} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color }) => (
            <Ionicons name="scan-outline" size={22} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          href: role === 'botanist' ? undefined : null,
          tabBarIcon: ({ color }) => (
            <Ionicons name="alert-circle-outline" size={22} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <Ionicons name="person-outline" size={22} color={color as string} />
          ),
        }}
      />
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
