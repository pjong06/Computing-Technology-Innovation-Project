import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { signOutOnThisPhone } from '../lib/auth';
import { useRecordStore } from '../store/useRecordStore';
import { deleteAllStoredPhotos } from '../utils/photoStorage';

export type UserRole = 'botanist' | 'officer' | 'visitor';

interface AuthRoleContextType {
  role: UserRole;
  isVisitor: boolean;
  canEdit: boolean;
  userName: string;
  setVisitorMode: () => Promise<void>;
  checkUserRole: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthRoleContext = createContext<AuthRoleContextType>({
  role: 'visitor',
  isVisitor: true,
  canEdit: false,
  userName: 'Visitor',
  setVisitorMode: async () => {},
  checkUserRole: async () => {},
  logout: async () => {},
});

export function AuthRoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<UserRole>('visitor');
  const [userName, setUserName] = useState<string>('Visitor');

  // Verify Supabase authenticated user role or fall back to stored guest status
  const checkUserRole = async () => {
    try {
      const storedGuest = await AsyncStorage.getItem('niah_is_guest_visitor');
      if (storedGuest === 'true') {
        setRole('visitor');
        setUserName('Park Visitor');
        return;
      }

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

  const setVisitorMode = async () => {
    await AsyncStorage.setItem('niah_is_guest_visitor', 'true');
    setRole('visitor');
    setUserName('Park Visitor');
  };

  // Every logout path (Profile, Home's "Staff Sign In", leaving visitor mode) comes
  // here, so the phone is always cleared: otherwise the next person to log in would
  // see the previous user's records and photos (and could upload them as their own).
  // Screens must warn about unsynced data BEFORE calling this; it deletes it.
  const logout = async () => {
    useRecordStore.getState().clearAllData(); // records, routes, draft route
    deleteAllStoredPhotos();
    await AsyncStorage.removeItem('niah_is_guest_visitor');
    // Works offline too, and forgets the cached account details.
    await signOutOnThisPhone();
    setRole('visitor');
    setUserName('Visitor');
  };

  // Required context computed properties
  const isVisitor = role === 'visitor';
  const canEdit = !isVisitor;

  return (
    <AuthRoleContext.Provider
      value={{
        role,
        isVisitor,
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