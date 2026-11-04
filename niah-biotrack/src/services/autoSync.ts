import NetInfo from '@react-native-community/netinfo';

import { supabase } from '../lib/supabase';
import { useRecordStore } from '../store/useRecordStore';

let autoSyncRunning = false;

async function triggerAutoSync() {
  if (autoSyncRunning) {
    return;
  }

  const { data } = await supabase.auth.getSession();

  // Visitors / signed-out users have nothing to upload.
  if (!data.session) {
    return;
  }

  autoSyncRunning = true;

  try {
    await useRecordStore.getState().syncAll();
  } catch (error) {
    // Auto-sync is intentionally silent.
    // Pending local data remains safe for the next reconnect
    // or the manual "Sync now" button.
    console.warn('Automatic sync did not complete:', error);
  } finally {
    autoSyncRunning = false;
  }
}

export function startAutoSync(): () => void {
  let initialized = false;
  let wasOnline = false;

  const unsubscribe = NetInfo.addEventListener((state) => {
    const online =
      state.isConnected === true &&
      state.isInternetReachable !== false;

    // First network state after app launch:
    // also retry anything left pending from a previous session.
    if (!initialized) {
      initialized = true;
      wasOnline = online;

      if (online) {
        void triggerAutoSync();
      }

      return;
    }

    const reconnected =
      online && !wasOnline;

    wasOnline = online;

    if (reconnected) {
      void triggerAutoSync();
    }
  });

  return unsubscribe;
}