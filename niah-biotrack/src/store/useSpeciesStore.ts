import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchSpecies,
  fetchSpeciesDetail,
  type Species,
  type SpeciesDetail,
} from '../api/species';
import { cachePrimarySpeciesImage } from '../services/speciesImageCache';

interface SpeciesState {
  species: Species[];
  lastUpdated: string | null;
  loading: boolean;
  error: string | null;

  detailsById: Record<string, SpeciesDetail>;
  detailUpdatedAt: Record<string, string>;
  detailLoadingById: Record<string, boolean>;
  detailErrorById: Record<string, string | null>;
  imageUrisBySpeciesId: Record<string, string>;

  offlinePackDownloading: boolean;
  offlinePackProcessed: number;
  offlinePackTotal: number;
  offlinePackDetailFailures: number;
  offlinePackPhotoFailures: number;
  offlinePackLastCompletedAt: string | null;
  offlinePackError: string | null;

  loadSpecies: () => Promise<void>;
  loadSpeciesDetail: (
    id: string,
    forceRefresh?: boolean
  ) => Promise<SpeciesDetail | null>;
  downloadOfflineReference: () => Promise<void>;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const useSpeciesStore = create<SpeciesState>()(
  persist(
    (set, get) => ({
      species: [],
      lastUpdated: null,
      loading: false,
      error: null,

      detailsById: {},
      detailUpdatedAt: {},
      detailLoadingById: {},
      detailErrorById: {},
      imageUrisBySpeciesId: {},

      offlinePackDownloading: false,
      offlinePackProcessed: 0,
      offlinePackTotal: 0,
      offlinePackDetailFailures: 0,
      offlinePackPhotoFailures: 0,
      offlinePackLastCompletedAt: null,
      offlinePackError: null,

      loadSpecies: async () => {
        set({ loading: true, error: null });

        try {
          const list = await fetchSpecies();
          set({
            species: list,
            lastUpdated: new Date().toISOString(),
            loading: false,
            error: null,
          });
        } catch (error) {
          // Never erase the previously downloaded catalogue on a network failure.
          set({
            loading: false,
            error: errorMessage(error, 'Could not load species'),
          });
        }
      },

      loadSpeciesDetail: async (id, forceRefresh = false) => {
        const cachedDetail = get().detailsById[id] ?? null;
        const cachedAt = get().detailUpdatedAt[id];
        const cacheAge = cachedAt
          ? Date.now() - new Date(cachedAt).getTime()
          : Number.POSITIVE_INFINITY;

        // Avoid a network request on every open. The user can still press Refresh.
        if (cachedDetail && !forceRefresh && cacheAge < 24 * 60 * 60 * 1000) {
          return cachedDetail;
        }

        // A cached detail appears immediately in the UI while this refresh runs.
        set((state) => ({
          detailLoadingById: {
            ...state.detailLoadingById,
            [id]: true,
          },
          detailErrorById: {
            ...state.detailErrorById,
            [id]: null,
          },
        }));

        try {
          const detail = await fetchSpeciesDetail(id);
          let imageUri = get().imageUrisBySpeciesId[id];

          try {
            imageUri = (await cachePrimarySpeciesImage(detail)) ?? imageUri;
          } catch {
            // Text reference data remains usable when a photo cannot be cached.
          }

          set((state) => ({
            detailsById: {
              ...state.detailsById,
              [id]: detail,
            },
            detailUpdatedAt: {
              ...state.detailUpdatedAt,
              [id]: new Date().toISOString(),
            },
            detailLoadingById: {
              ...state.detailLoadingById,
              [id]: false,
            },
            detailErrorById: {
              ...state.detailErrorById,
              [id]: null,
            },
            imageUrisBySpeciesId: imageUri
              ? {
                  ...state.imageUrisBySpeciesId,
                  [id]: imageUri,
                }
              : state.imageUrisBySpeciesId,
          }));

          return detail;
        } catch (error) {
          set((state) => ({
            detailLoadingById: {
              ...state.detailLoadingById,
              [id]: false,
            },
            detailErrorById: {
              ...state.detailErrorById,
              [id]: errorMessage(error, 'Could not load species detail'),
            },
          }));

          return cachedDetail;
        }
      },

      downloadOfflineReference: async () => {
        if (get().offlinePackDownloading) return;

        set({
          offlinePackDownloading: true,
          offlinePackProcessed: 0,
          offlinePackTotal: 0,
          offlinePackDetailFailures: 0,
          offlinePackPhotoFailures: 0,
          offlinePackError: null,
        });

        let catalogue = get().species;
        let catalogueWarning: string | null = null;

        try {
          catalogue = await fetchSpecies();
          set({
            species: catalogue,
            lastUpdated: new Date().toISOString(),
            error: null,
          });
        } catch (error) {
          catalogueWarning = errorMessage(
            error,
            'Could not refresh the species catalogue'
          );

          // A previously downloaded list can still be used as the work queue.
          if (catalogue.length === 0) {
            set({
              offlinePackDownloading: false,
              offlinePackError: catalogueWarning,
            });
            return;
          }
        }

        set({ offlinePackTotal: catalogue.length });

        let detailFailures = 0;
        let photoFailures = 0;

        for (let index = 0; index < catalogue.length; index += 1) {
          const item = catalogue[index];

          try {
            // Refresh each detail while online. Each completed item is persisted
            // immediately, so an interrupted run does not erase earlier work.
            const detail = await fetchSpeciesDetail(item.id);
            let imageUri = get().imageUrisBySpeciesId[item.id];

            if (detail.species_media.length > 0) {
              try {
                imageUri =
                  (await cachePrimarySpeciesImage(detail)) ?? imageUri;
              } catch {
                photoFailures += 1;
              }
            }

            set((state) => ({
              detailsById: {
                ...state.detailsById,
                [item.id]: detail,
              },
              detailUpdatedAt: {
                ...state.detailUpdatedAt,
                [item.id]: new Date().toISOString(),
              },
              detailErrorById: {
                ...state.detailErrorById,
                [item.id]: null,
              },
              imageUrisBySpeciesId: imageUri
                ? {
                    ...state.imageUrisBySpeciesId,
                    [item.id]: imageUri,
                  }
                : state.imageUrisBySpeciesId,
            }));
          } catch (error) {
            detailFailures += 1;
            set((state) => ({
              detailErrorById: {
                ...state.detailErrorById,
                [item.id]: errorMessage(
                  error,
                  'Could not download species detail'
                ),
              },
            }));
          }

          set({
            offlinePackProcessed: index + 1,
            offlinePackDetailFailures: detailFailures,
            offlinePackPhotoFailures: photoFailures,
          });
        }

        set({
          offlinePackDownloading: false,
          offlinePackLastCompletedAt: new Date().toISOString(),
          offlinePackError: catalogueWarning,
        });
      },
    }),
    {
      name: 'niah-species-cache',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        species: state.species,
        lastUpdated: state.lastUpdated,
        detailsById: state.detailsById,
        detailUpdatedAt: state.detailUpdatedAt,
        imageUrisBySpeciesId: state.imageUrisBySpeciesId,
        offlinePackLastCompletedAt: state.offlinePackLastCompletedAt,
      }),
    }
  )
);
