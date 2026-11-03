import React, { createContext, useContext, useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { signOutOnThisPhone } from '../lib/auth';
import { useRecordStore } from '../store/useRecordStore';
import { useProposalStore } from '../store/useProposalStore';
import { deleteAllStoredPhotos } from '../utils/photoStorage';

export type UserRole = 'botanist' | 'officer' | 'visitor';

interface AuthRoleContextType {
  role: UserRole;
  isVisitor: boolean;
  // Exploring without an account: no login, no token, nothing sent to the server as
  // any role. (isVisitor is also true for a signed-in account whose role is visitor.)
  isGuest: boolean;
  canEdit: boolean;
  userName: string;
  setVisitorMode: () => Promise<void>;
  checkUserRole: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthRoleContext = createContext<AuthRoleContextType>({
  role: 'visitor',
  isVisitor: true,
  isGuest: false,
  canEdit: false,
  userName: 'Visitor',
  setVisitorMode: async () => {},
  checkUserRole: async () => {},
  logout: async () => {},
});

export function AuthRoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<UserRole>('visitor');
  const [userName, setUserName] = useState<string>('Visitor');
  const [isGuest, setIsGuest] = useState<boolean>(false);

  // Verify Supabase authenticated user role or fall back to stored guest status
  const checkUserRole = async () => {
    try {
      const storedGuest = await AsyncStorage.getItem('niah_is_guest_visitor');
      if (storedGuest === 'true') {
        setRole('visitor');
        setUserName('Park Visitor');
        setIsGuest(true);
        return;
      }
      setIsGuest(false);

      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', authData.user.id)
          .maybeSingle();

        if (profile?.role === 'visitor') {
          setRole('visitor');
          setUserName(profile.full_name || 'Park Visitor');
        } else {
          setRole((profile?.role as UserRole) || 'botanist');
          setUserName(profile?.full_name || 'Botanist');
        }
      } else {
        setRole('visitor');
        setUserName('Park Visitor');
      }
    } catch {
      setRole('visitor');
      setUserName('Park Visitor');
    }
  };

  useEffect(() => {
    checkUserRole();
  }, []);

  // "Explore without an account". Any saved login is removed first, so a guest never
  // sends a token: every server call is either public or refused before it's sent.
  const setVisitorMode = async () => {
    await signOutOnThisPhone();
    await AsyncStorage.setItem('niah_is_guest_visitor', 'true');
    setRole('visitor');
    setUserName('Park Visitor');
    setIsGuest(true);
  };

  // Every logout path (Profile, Home's "Staff Sign In", leaving visitor mode) comes
  // here, so the phone is always cleared: otherwise the next person to log in would
  // see the previous user's records and photos (and could upload them as their own).
  // Screens must warn about unsynced data BEFORE calling this; it deletes it.
  const logout = async () => {
    useRecordStore.getState().clearAllData(); // records, routes, draft route
    useProposalStore.getState().clearProposals(); // species proposals
    deleteAllStoredPhotos();
    await AsyncStorage.removeItem('niah_is_guest_visitor');
    // Works offline too, and forgets the cached account details.
    await signOutOnThisPhone();
    setRole('visitor');
    setUserName('Visitor');
    setIsGuest(false);
  };

  // Required context computed properties
  const isVisitor = role === 'visitor';
  const canEdit = !isVisitor;

  return (
    <AuthRoleContext.Provider
      value={{
        role,
        isVisitor,
        isGuest,
        canEdit,
        userName,
        setVisitorMode,
        checkUserRole,
        logout,
      }}
    >
      {children}
    </AuthRoleContext.Provider>
  );
}

export const useAuthRole = () => useContext(AuthRoleContext);

// For botanist-only screens (New Record, Attach Tag, Link Route...). Guests and
// visitors are sent back to Home. Returns true while blocked: the screen should call
// this before any early return and render nothing when it's true.
export function useStaffOnly(): boolean {
  const { isVisitor } = useAuthRole();
  const router = useRouter();

  useEffect(() => {
    if (isVisitor) {
      Alert.alert('Account required', 'Log in with a botanist account to use this part of the app.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/home') },
      ]);
    }
  }, [isVisitor]);

  return isVisitor;
}