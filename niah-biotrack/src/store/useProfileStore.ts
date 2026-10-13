import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchMe, type Me } from '../api/me';
import { ApiError } from '../api/client';

interface ProfileState {
  me: Me | null;          // cached account details
  loading: boolean;
  error: string | null;
  loadMe: () => Promise<void>;
  clear: () => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      me: null,
      loading: false,
      error: null,

      loadMe: async () => {
        set({ loading: true, error: null });
        try {
          const me = await fetchMe();
          set({ me, loading: false });
        } catch (e) {
          // Keep the cached details - Profile still works offline.
          let message = 'Could not load account details';
          if (e instanceof ApiError) {
            if (e.status === 0)
              message = get().me
                ? 'Offline - showing saved details'
                : "Can't reach the server. Details will appear once you're online.";
            else if (e.status === 401 || e.status === 403)
              message = 'Your account is not active. Contact your Conservation Officer.';
          }
          set({ loading: false, error: message });
        }
      },

      clear: () => set({ me: null, error: null }),
    }),
    {
      name: 'niah-profile-cache',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ me: state.me }), // only save the details
    }
  )
);