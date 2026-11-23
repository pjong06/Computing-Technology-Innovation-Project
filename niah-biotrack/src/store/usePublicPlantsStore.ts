import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPublicPlants, type PublicPlantSummary } from '../services/tagLookup';
import { isRestrictedForVisitors } from '../utils/conservationStatus';

interface LoadPublicPlantsOptions {
  silent?: boolean;
}

interface PublicPlantsState {
  plants: PublicPlantSummary[];
  lastUpdated: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  loadPublicPlants: (options?: LoadPublicPlantsOptions) => Promise<void>;
}

function filterVisitorPlants(list: PublicPlantSummary[]): PublicPlantSummary[] {
  return list.filter((plant) => !isRestrictedForVisitors(plant.conservationStatus));
}

export const usePublicPlantsStore = create<PublicPlantsState>()(
  persist(
    (set, get) => ({
      plants: [],
      lastUpdated: null,
      loading: false,
      refreshing: false,
      error: null,

      loadPublicPlants: async (options = {}) => {
        if (get().refreshing) return;

        set({
          refreshing: true,
          error: null,
          ...(options.silent ? {} : { loading: true }),
        });

        try {
          const list = await fetchPublicPlants();
          set({
            plants: filterVisitorPlants(list),
            lastUpdated: new Date().toISOString(),
            loading: false,
            refreshing: false,
            error: null,
          });
        } catch (err) {
          set({
            loading: false,
            refreshing: false,
            error: err instanceof Error ? err.message : 'Could not load plants',
          });
        }
      },
    }),
    {
      name: 'niah-public-plants-cache',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        plants: state.plants,
        lastUpdated: state.lastUpdated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && Array.isArray(state.plants)) {
          state.plants = filterVisitorPlants(state.plants);
        }
      },
    }
  )
);