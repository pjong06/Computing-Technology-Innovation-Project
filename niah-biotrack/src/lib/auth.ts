import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { supabase } from './supabase';

// True if this phone has a saved login, even when offline.
export async function hasSavedSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  if (data.session) return true;
  // Offline with an expired token: the login is still saved, it just
  // couldn't be renewed. Let them in; it renews when back online.
  return isAuthRetryableFetchError(error);
}

// Remove the login from this phone, online or offline.
export async function signOutOnThisPhone(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    // Supabase couldn't finish (e.g. offline + expired token), so remove
    // the saved login ourselves. Supabase stores it as "sb-<project>-auth-token".
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(
      keys.filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    );
  }
}