import { AppState } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { supabase } from '../lib/supabase';
import { useRecordStore } from '../store/useRecordStore';
import { useProposalStore } from '../store/useProposalStore';
import { listenForSyncRetry } from './syncRetry';
import { getNextOutboxRetryAt } from './offlineDatabase';

let autoSyncRunning = false;

function isOnline(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

async function triggerAutoSync(): Promise<boolean> {
  if (autoSyncRunning) return false;

  // Set the guard before the first await so two network/app events cannot
  // start overlapping sync runs.
  autoSyncRunning = true;

  try {
    const { data } = await supabase.auth.getSession();

    // Visitors and signed-out users have no authenticated sync session.
    if (!data.session) return false;

    await useRecordStore.getState().syncAll();
    await useProposalStore.getState().syncAllProposals();
    return true;
  } catch (error) {
    // A failed automatic attempt never removes local SQLite/outbox data.
    // The next reconnect, foreground event, or manual Sync now can retry it.
    console.warn('Automatic sync did not complete:', error);
    return false;
  } finally {
    autoSyncRunning = false;
  }
}

export function startAutoSync(): () => void {
  let stopped = false;
  let initialized = false;
  let wasOnline = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let scheduleVersion = 0;

  const cancel = () => {
    generation += 1;
    scheduleVersion += 1;
    clearTimeout(timer);
    timer = undefined;
  };

  const schedule = async () => {
    if (stopped || !wasOnline) return;
    const version = ++scheduleVersion;
    const next = await getNextOutboxRetryAt().catch(() => null);
    if (stopped || !wasOnline || version !== scheduleVersion) return;
    clearTimeout(timer);
    timer = undefined;
    if (next === null) return;
    const delay = Math.min(2_147_483_647, Math.max(1_000, next - Date.now()));
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delay);
  };

  const run = async () => {
    if (stopped || !wasOnline || autoSyncRunning) return;
    const current = generation;
    const hasSession = await triggerAutoSync();
    if (hasSession && current === generation) void schedule();
  };

  const stopRetryRequests = listenForSyncRetry(() => {
    // A running automatic sync schedules its own retry when it finishes.
    if (!autoSyncRunning) void schedule();
  });

  const startCycle = () => {
    if (autoSyncRunning) return;
    clearTimeout(timer);
    timer = undefined;
    void run();
  };

  const checkCurrentNetworkAndSync = async (): Promise<void> => {
    const state = await NetInfo.fetch().catch(() => null);
    if (!state) return;
    if (stopped) return;

    const online = isOnline(state);
    wasOnline = online;
    initialized = true;

    if (online) startCycle();
  };

  // Retry pending work once at app startup.
  void checkCurrentNetworkAndSync();

  const unsubscribeNetwork = NetInfo.addEventListener((state) => {
    if (stopped) return;

    const online = isOnline(state);

    if (!initialized) {
      initialized = true;
      wasOnline = online;
      if (online) startCycle();
      return;
    }

    const reconnected = online && !wasOnline;
    wasOnline = online;

    if (!online) cancel();
    if (reconnected) startCycle();
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
    if (event === 'SIGNED_OUT') {
      cancel();
      return;
    }
    if (
      !stopped &&
      session &&
      (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')
    ) {
      // Run outside Supabase's auth callback to avoid blocking its internal lock.
      setTimeout(() => {
        if (!stopped) void checkCurrentNetworkAndSync();
      }, 0);
    }
  });

  return () => {
    stopped = true;
    cancel();
    stopRetryRequests();
    unsubscribeNetwork();
    appStateSubscription.remove();
    authListener.subscription.unsubscribe();
  };
}
