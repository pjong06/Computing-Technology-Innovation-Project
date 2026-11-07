import { AppState } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { supabase } from '../lib/supabase';
import { useRecordStore } from '../store/useRecordStore';

let autoSyncRunning = false;

function isOnline(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

async function triggerAutoSync(): Promise<void> {
  if (autoSyncRunning) return;

  // Set the guard before the first await so two network/app events cannot
  // start overlapping sync runs.
  autoSyncRunning = true;

  try {
    const { data } = await supabase.auth.getSession();

    // Visitors and signed-out users have no authenticated sync session.
    if (!data.session) return;

    await useRecordStore.getState().syncAll();
  } catch (error) {
    // A failed automatic attempt never removes local SQLite/outbox data.
    // The next reconnect, foreground event, or manual Sync now can retry it.
    console.warn('Automatic sync did not complete:', error);
  } finally {
    autoSyncRunning = false;
  }
}

export function startAutoSync(): () => void {
  let stopped = false;
  let initialized = false;
  let wasOnline = false;

  const checkCurrentNetworkAndSync = async (): Promise<void> => {
    const state = await NetInfo.fetch();
    if (stopped) return;

    const online = isOnline(state);
    wasOnline = online;
    initialized = true;

    if (online) await triggerAutoSync();
  };

  // Retry pending work once at app startup.
  void checkCurrentNetworkAndSync();

  const unsubscribeNetwork = NetInfo.addEventListener((state) => {
    if (stopped) return;

    const online = isOnline(state);

    if (!initialized) {
      initialized = true;
      wasOnline = online;
      if (online) void triggerAutoSync();
      return;
    }

    const reconnected = online && !wasOnline;
    wasOnline = online;

    if (reconnected) void triggerAutoSync();
  });

  // Android can miss a useful reconnect event while the app is backgrounded.
  // Recheck when the botanist returns to the app.
  const appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (!stopped && nextState === 'active') {
      void checkCurrentNetworkAndSync();
    }
  });

  // A session may become available after the startup network event.
  const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
    if (
      !stopped &&
      session &&
      (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')
    ) {
      // Run outside Supabase's auth callback to avoid blocking its internal lock.
      setTimeout(() => {
        if (!stopped) void checkCurrentNetworkAndSync();
      }, 0);
    }
  });

  return () => {
    stopped = true;
    unsubscribeNetwork();
    appStateSubscription.remove();
    authListener.subscription.unsubscribe();
  };
}
