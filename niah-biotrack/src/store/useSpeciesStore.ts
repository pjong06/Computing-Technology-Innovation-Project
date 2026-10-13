import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchSpecies, type Species } from '../api/species';

interface SpeciesState {
  species: Species[];          // the cached list
  lastUpdated: string | null;  // when it was last downloaded
  loading: boolean;
  error: string | null;
  loadSpecies: () => Promise<void>;
}

export const useSpeciesStore = create<SpeciesState>()(
  persist(
    (set) => ({
      species: [],
      lastUpdated: null,
      loading: false,
      error: null,

      loadSpecies: async () => {
        set({ loading: true, error: null });
        try {
          const list = await fetchSpecies();
          set({ species: list, lastUpdated: new Date().toISOString(), loading: false });
        } catch (e) {
          // Keep the old list - the app still works offline with the cached species.
          set({ loading: false, error: e instanceof Error ? e.message : 'Could not load species' });
        }
      },
    }),
    {
      name: 'niah-species-cache',
      storage: createJSONStorage(() => AsyncStorage),
      // Only save the list and the date - not "loading" or "error".
      partialize: (state) => ({ species: state.species, lastUpdated: state.lastUpdated }),
    }
  )
);
