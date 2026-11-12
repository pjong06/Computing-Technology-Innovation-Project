import React, { createContext, useContext, useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { signOutOnThisPhone } from '../lib/auth';
import { useRecordStore } from '../store/useRecordStore';
import { useProposalStore } from '../store/useProposalStore';
import { deleteAllStoredPhotos } from '../utils/photoStorage';

// 'pending': signed in, but the account isn't active (waiting for an officer to
// activate it, or suspended) or has no staff role. Such accounts can't use anything.
export type UserRole = 'botanist' | 'officer' | 'researcher' | 'visitor' | 'pending';

// Roles the server accepts (backend STAFF_ROLES, minus admin which the app doesn't use).
const STAFF_ROLES = new Set(['botanist', 'officer', 'researcher']);

interface AuthRoleContextType {
  role: UserRole;
  isVisitor: boolean;
  // Exploring without an account: no login, no token, nothing sent to the server as
  // any role. (isVisitor is also true for a signed-in account whose role is visitor.)
  isGuest: boolean;
  // Signed in, but not an active staff account: show "Account awaiting approval".
  isPending: boolean;
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
  isPending: false,
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
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('full_name, role, account_status')
          .eq('id', authData.user.id)
          .maybeSingle();

        // Couldn't read the profile (e.g. no signal): keep the role we already have
        // rather than guessing, so offline staff aren't locked out or promoted.
        if (profileError) return;

        if (profile && profile.account_status === 'active' && STAFF_ROLES.has(profile.role)) {
          setRole(profile.role as UserRole);
          setUserName(profile.full_name || authData.user.email || '');
        } else if (profile && profile.account_status === 'active' && profile.role === 'visitor') {
          // A visitor account ("Create a free account"): the visitor experience, signed in.
          setRole('visitor');
          setUserName(profile.full_name || authData.user.email || '');
        } else {
          // Never default to botanist: a pending, suspended or role-less account gets
          // the "Account awaiting approval" screen (the server refuses it anyway).
          setRole('pending');
          setUserName(profile?.full_name || authData.user.email || '');
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
    checkUserRole().catch((error: unknown) => {
      console.error('Unable to check user role', error);
      setRole('visitor');
      setUserName('Park Visitor');
    });
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
    await useProposalStore.getState().clearProposals();
    useRecordStore.getState().clearAllData(); // records, routes, draft route
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
  const isPending = role === 'pending';
  const canEdit = !isVisitor && !isPending;

  return (
    <AuthRoleContext.Provider
      value={{
        role,
        isVisitor,
        isGuest,
        isPending,
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
  const { canEdit } = useAuthRole();
  const blocked = !canEdit;
  const router = useRouter();

  useEffect(() => {
    if (blocked) {
      Alert.alert('Account required', 'Log in with a botanist account to use this part of the app.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/home') },
      ]);
    }
  }, [blocked]);

  return blocked;
}
