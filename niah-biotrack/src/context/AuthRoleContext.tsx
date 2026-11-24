import React, { createContext, useContext, useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { signOutOnThisPhone } from '../lib/auth';
import { useRecordStore } from '../store/useRecordStore';
import { useProposalStore } from '../store/useProposalStore';
import { useIotTaskStore } from '../store/useIotTaskStore';
import { clearSavedPlantList } from '../store/usePlantListStore';
import { deleteAllStoredPhotos } from '../utils/photoStorage';

// 'pending': signed in, but the account isn't active (waiting for an officer to
// activate it, or suspended) or has no staff role. Such accounts can't use anything.
export type UserRole = 'botanist' | 'officer' | 'researcher' | 'visitor' | 'pending';

// Roles the server accepts (backend STAFF_ROLES, minus admin which the app doesn't use).
const STAFF_ROLES = new Set(['botanist', 'officer', 'researcher']);
const AUTH_IDENTITY_CACHE_KEY = 'niah-verified-auth-identity';

interface CachedAuthIdentity {
  userId: string;
  role: UserRole;
  userName: string;
}

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
  checkUserRole: () => Promise<UserRole>;
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
  checkUserRole: async () => 'visitor',
  logout: async () => {},
});

export function AuthRoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<UserRole>('visitor');
  const [userName, setUserName] = useState<string>('Visitor');
  const [isGuest, setIsGuest] = useState<boolean>(false);

  const restoreCachedIdentity = async (expectedUserId?: string): Promise<UserRole | null> => {
    try {
      const raw = await AsyncStorage.getItem(AUTH_IDENTITY_CACHE_KEY);
      if (!raw) return null;

      const cached = JSON.parse(raw) as CachedAuthIdentity;
      if (
        !cached.userId ||
        !cached.userName ||
        !['botanist', 'officer', 'researcher', 'visitor', 'pending'].includes(cached.role) ||
        (expectedUserId && cached.userId !== expectedUserId)
      ) {
        return null;
      }

      setRole(cached.role);
      setUserName(cached.userName);
      setIsGuest(false);
      return cached.role;
    } catch {
      return null;
    }
  };

  const saveVerifiedIdentity = async (identity: CachedAuthIdentity) => {
    try {
      await AsyncStorage.setItem(AUTH_IDENTITY_CACHE_KEY, JSON.stringify(identity));
    } catch {
      console.error('Unable to save the verified account for offline use.');
    }
  };

  const clearCachedIdentity = async () => {
    try {
      await AsyncStorage.removeItem(AUTH_IDENTITY_CACHE_KEY);
    } catch {
      console.error('Unable to clear the saved offline account.');
    }
  };

  const useVisitorIdentity = async () => {
    setRole('visitor');
    setUserName('Park Visitor');
    setIsGuest(false);
    await clearCachedIdentity();
    return 'visitor' as const;
  };

  // Verify the role online. When the network is unavailable, restore only the
  // last identity that this phone previously verified successfully.
  const checkUserRole = async () => {
    try {
      const storedGuest = await AsyncStorage.getItem('niah_is_guest_visitor');
      if (storedGuest === 'true') {
        setRole('visitor');
        setUserName('Park Visitor');
        setIsGuest(true);
        return 'visitor';
      }
      setIsGuest(false);

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const sessionUserId = sessionData.session?.user.id;

      if (sessionError) {
        if (isAuthRetryableFetchError(sessionError)) {
          return (await restoreCachedIdentity(sessionUserId)) ?? useVisitorIdentity();
        }
        return useVisitorIdentity();
      }

      if (!sessionData.session) return useVisitorIdentity();

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) {
        if (isAuthRetryableFetchError(authError)) {
          return (await restoreCachedIdentity(sessionUserId)) ?? useVisitorIdentity();
        }
        return useVisitorIdentity();
      }

      if (authData?.user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('full_name, role, account_status')
          .eq('id', authData.user.id)
          .maybeSingle();

        // A failed profile request while offline must not turn a verified botanist
        // into a visitor. The cached identity is written only after online verification.
        if (profileError) {
          return (await restoreCachedIdentity(authData.user.id)) ?? useVisitorIdentity();
        }

        if (profile && profile.account_status === 'active' && STAFF_ROLES.has(profile.role)) {
          const activeRole = profile.role as UserRole;
          const verifiedName = profile.full_name || authData.user.email || '';
          setRole(activeRole);
          setUserName(verifiedName);
          await saveVerifiedIdentity({
            userId: authData.user.id,
            role: activeRole,
            userName: verifiedName,
          });
          return activeRole;
        } else if (profile && profile.account_status === 'active' && profile.role === 'visitor') {
          // A visitor account ("Create a free account"): the visitor experience, signed in.
          const verifiedName = profile.full_name || authData.user.email || '';
          setRole('visitor');
          setUserName(verifiedName);
          await saveVerifiedIdentity({
            userId: authData.user.id,
            role: 'visitor',
            userName: verifiedName,
          });
          return 'visitor';
        } else {
          // Never default to botanist: a pending, suspended or role-less account gets
          // the "Account awaiting approval" screen (the server refuses it anyway).
          const verifiedName = profile?.full_name || authData.user.email || '';
          setRole('pending');
          setUserName(verifiedName);
          await saveVerifiedIdentity({
            userId: authData.user.id,
            role: 'pending',
            userName: verifiedName,
          });
          return 'pending';
        }
      } else {
        return useVisitorIdentity();
      }
    } catch {
      return (await restoreCachedIdentity()) ?? useVisitorIdentity();
    }
  };

  useEffect(() => {
    checkUserRole().catch((error: unknown) => {
      console.error('Unable to check user role', error);
      setRole('visitor');
      setUserName('Park Visitor');
    });
  }, []);

  // "Continue as guest" on the login screen. Any saved login is removed first, so a guest never
  // sends a token: every server call is either public or refused before it's sent.
  const setVisitorMode = async () => {
    await signOutOnThisPhone();
    await clearCachedIdentity();
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
    try {
      await useProposalStore.getState().clearProposals();
      await useIotTaskStore.getState().clearTasks();
      await useRecordStore.getState().clearAllData(); // records, routes, draft route
      await clearSavedPlantList(); // other plants' coordinates kept for offline "Find plant"
      await deleteAllStoredPhotos();
      await AsyncStorage.removeItem('niah_is_guest_visitor');
      await clearCachedIdentity();
    } catch {
      console.error('Unable to clear local data while signing out.');
    }
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
