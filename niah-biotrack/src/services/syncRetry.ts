import NetInfo from '@react-native-community/netinfo';

let listener: (() => void) | undefined;

export function listenForSyncRetry(callback: () => void): () => void {
  listener = callback;
  return () => {
    if (listener === callback) listener = undefined;
  };
}

export function requestSyncRetry(): void {
  listener?.();
}
export async function isSyncOffline(): Promise<boolean> {
  const state = await NetInfo.fetch().catch(() => null);
  return state?.isConnected === false || state?.isInternetReachable === false;
}
