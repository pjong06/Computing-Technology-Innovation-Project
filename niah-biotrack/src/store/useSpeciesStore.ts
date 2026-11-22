import { create } from 'zustand';
import {
  persist,
  createJSONStorage,
} from 'zustand/middleware';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchSpecies,
  fetchSpeciesDetail,
  type Species,
  type SpeciesDetail,
  type PlantPhoto,
} from '../api/species';

import {
  cachePlantPhoto,
  removeCachedPlantPhoto,
  removeLegacySpeciesImages,
  type CachedPlantPhoto,
} from '../services/speciesImageCache';


interface LoadSpeciesOptions {
  /*
   * Silent refresh is used by the automatic background
   * catalogue refresh so the UI does not show a loading
   * spinner every 30 seconds.
   */
  silent?: boolean;
}


interface SpeciesUpdateNotice {
  count: number;

  names: string[];
}


interface SpeciesState {
  species: Species[];

  lastUpdated:
    | string
    | null;

  /*
   * loading:
   * visible refresh state used by the UI.
   *
   * refreshing:
   * prevents duplicate network refreshes, including silent
   * automatic refreshes.
   */
  loading: boolean;

  refreshing: boolean;

  error:
    | string
    | null;


  detailsById:
    Record<
      string,
      SpeciesDetail
    >;

  detailUpdatedAt:
    Record<
      string,
      string
    >;

  detailLoadingById:
    Record<
      string,
      boolean
    >;

  detailErrorById:
    Record<
      string,
      string | null
    >;

  /*
   * The photo shown for each species: the primary photo of one of its plants
   * (with the plant's tag for the caption "From plant <tag>"), saved on the phone.
   * Only staff get these; species reference photos are not shown any more.
   */
  plantPhotosBySpeciesId:
    Record<
      string,
      CachedPlantPhoto
    >;


  /*
   * Temporary notification state.
   *
   * This is NOT persisted.
   * RootLayout shows a Toast and then clears it.
   */
  speciesUpdateNotice:
    | SpeciesUpdateNotice
    | null;


  loadSpecies: (
    options?: LoadSpeciesOptions
  ) => Promise<void>;


  loadSpeciesDetail: (
    id: string,
    forceRefresh?: boolean
  ) => Promise<
    SpeciesDetail | null
  >;


  clearSpeciesUpdateNotice:
    () => void;
}


const errorMessage = (
  error: unknown,
  fallback: string
) =>
  error instanceof Error
    ? error.message
    : fallback;


// Plant photos being downloaded, so two refreshes don't fetch the same one twice.
const plantPhotoDownloads = new Set<string>();

export const useSpeciesStore =
  create<SpeciesState>()(
    persist(
      (
        set,
        get
      ) => ({
        species: [],

        lastUpdated: null,

        loading: false,

        refreshing: false,

        error: null,


        detailsById: {},

        detailUpdatedAt: {},

        detailLoadingById: {},

        detailErrorById: {},

        plantPhotosBySpeciesId: {},


        speciesUpdateNotice:
          null,


        /* =====================================================
           LOAD / REFRESH SPECIES CATALOGUE
           ===================================================== */

        loadSpecies:
          async (
            options = {}
          ) => {

            /*
             * Prevent two automatic/manual refreshes running
             * at the same time.
             */
            if (
              get().refreshing
            ) {
              return;
            }


            const previousSpecies =
              get().species;


            /*
             * Do not notify the user when the app downloads
             * the catalogue for the very first time.
             *
             * Only notify when there was already a catalogue
             * and genuinely new approved species appear.
             */
            const hadExistingCatalogue =
              previousSpecies.length >
                0 ||
              get().lastUpdated !==
                null;


            const previousById =
              new Map(
                previousSpecies.map(
                  (item) => [
                    item.id,
                    item,
                  ]
                )
              );


            set({
              refreshing: true,

              error: null,

              ...(
                options.silent
                  ? {}
                  : {
                      loading:
                        true,
                    }
              ),
            });


            try {
              const list =
                await fetchSpecies();


              const addedSpecies =
                hadExistingCatalogue
                  ? list.filter(
                      (item) =>
                        !previousById.has(
                          item.id
                        )
                    )
                  : [];


              set({
                species:
                  list,

                lastUpdated:
                  new Date()
                    .toISOString(),

                loading:
                  false,

                refreshing:
                  false,

                error:
                  null,

                ...(
                  addedSpecies.length >
                  0
                    ? {
                        speciesUpdateNotice:
                          {
                            count:
                              addedSpecies.length,

                            names:
                              addedSpecies
                                .map(
                                  (
                                    item
                                  ) =>
                                    item
                                      .scientific_name
                                )
                                .slice(
                                  0,
                                  3
                                ),
                          },
                      }
                    : {}
                ),
              });


              /*
               * Automatically maintain the offline reference.
               *
               * Force-refresh details when a species is new or its
               * public plant photo / summary changed; otherwise keep
               * the 24-hour cached copy.
               */
              for (
                const item of list
              ) {
                const prev =
                  previousById.get(
                    item.id
                  );

                const changed =
                  !prev ||
                  prev.public_photo?.url !==
                    item.public_photo?.url ||
                  prev.common_name !==
                    item.common_name ||
                  prev.scientific_name !==
                    item.scientific_name ||
                  prev.conservation_status !==
                    item.conservation_status ||
                  prev.description !==
                    item.description;

                void get()
                  .loadSpeciesDetail(
                    item.id,
                    changed
                  );
              }

              /*
               * Keep each species' plant photo in step with the list: download a new
               * one, and drop it when the species no longer has one (or this user
               * may not see plant photos, e.g. after signing out).
               */
              removeLegacySpeciesImages();
              void syncPlantPhotos(
                list.map((item) => [item.id, item.plant_photo ?? null])
              );

            } catch (error) {

              /*
               * IMPORTANT:
               *
               * Never erase the previously cached catalogue
               * when the network/backend is unavailable.
               */
              set({
                loading:
                  false,

                refreshing:
                  false,

                error:
                  errorMessage(
                    error,
                    'Could not load species'
                  ),
              });
            }
          },


        /* =====================================================
           LOAD SPECIES DETAIL
           ===================================================== */

        loadSpeciesDetail:
          async (
            id,
            forceRefresh =
              false
          ) => {

            const cachedDetail =
              get()
                .detailsById[
                id
              ] ?? null;


            const cachedAt =
              get()
                .detailUpdatedAt[
                id
              ];


            const cacheAge =
              cachedAt
                ? Date.now() -
                  new Date(
                    cachedAt
                  ).getTime()
                : Number
                    .POSITIVE_INFINITY;


            /*
             * Cached details remain valid for 24 hours.
             *
             * This avoids downloading the same species
             * information every 30 seconds.
             */
            if (
              cachedDetail &&
              !forceRefresh &&
              cacheAge <
                24 *
                  60 *
                  60 *
                  1000
            ) {
              return cachedDetail;
            }


            set(
              (
                state
              ) => ({
                detailLoadingById:
                  {
                    ...state
                      .detailLoadingById,

                    [id]:
                      true,
                  },

                detailErrorById:
                  {
                    ...state
                      .detailErrorById,

                    [id]:
                      null,
                  },
              })
            );


            try {
              const detail =
                await fetchSpeciesDetail(
                  id
                );


              void syncPlantPhotos([
                [id, detail.plant_photo ?? null],
              ]);


              set(
                (
                  state
                ) => ({
                  detailsById:
                    {
                      ...state
                        .detailsById,

                      [id]:
                        detail,
                    },

                  detailUpdatedAt:
                    {
                      ...state
                        .detailUpdatedAt,

                      [id]:
                        new Date()
                          .toISOString(),
                    },

                  detailLoadingById:
                    {
                      ...state
                        .detailLoadingById,

                      [id]:
                        false,
                    },

                  detailErrorById:
                    {
                      ...state
                        .detailErrorById,

                      [id]:
                        null,
                    },

                })
              );


              return detail;

            } catch (error) {

              set(
                (
                  state
                ) => ({
                  detailLoadingById:
                    {
                      ...state
                        .detailLoadingById,

                      [id]:
                        false,
                    },

                  detailErrorById:
                    {
                      ...state
                        .detailErrorById,

                      [id]:
                        errorMessage(
                          error,
                          'Could not load species detail'
                        ),
                    },
                })
              );


              /*
               * If online refresh fails, continue using
               * the last cached detail.
               */
              return cachedDetail;
            }
          },


        /* =====================================================
           NOTIFICATION
           ===================================================== */

        clearSpeciesUpdateNotice:
          () => {
            set({
              speciesUpdateNotice:
                null,
            });
          },
      }),
      {
        name:
          'niah-species-cache',

        storage:
          createJSONStorage(
            () =>
              AsyncStorage
          ),

        /*
         * Only real offline-reference data is persisted.
         *
         * Loading flags and notification state must not
         * survive an app restart.
         */
        partialize:
          (
            state
          ) => ({
            species:
              state.species,

            lastUpdated:
              state.lastUpdated,

            detailsById:
              state.detailsById,

            detailUpdatedAt:
              state.detailUpdatedAt,

            plantPhotosBySpeciesId:
              state.plantPhotosBySpeciesId,
          }),
      }
    )
  );

/*
 * Brings the saved plant photos in line with what the server sent: [speciesId, photo|null].
 * A new photo is downloaded (one at a time); a species without one loses its saved photo.
 * A download that fails keeps the previous photo, so the catalogue still works offline.
 */
async function syncPlantPhotos(
  entries: [string, PlantPhoto | null][]
): Promise<void> {
  for (const [speciesId, photo] of entries) {
    const current = useSpeciesStore.getState().plantPhotosBySpeciesId[speciesId];

    if (!photo || !photo.url) {
      if (current) {
        removeCachedPlantPhoto(speciesId, current.photoId);
        useSpeciesStore.setState((state) => {
          const next = { ...state.plantPhotosBySpeciesId };
          delete next[speciesId];
          return { plantPhotosBySpeciesId: next };
        });
      }
      continue;
    }

    if (current && current.photoId === String(photo.id)) {
      if (current.tag !== (photo.tag ?? null)) {
        useSpeciesStore.setState((state) => ({
          plantPhotosBySpeciesId: {
            ...state.plantPhotosBySpeciesId,
            [speciesId]: { ...current, tag: photo.tag ?? null },
          },
        }));
      }
      continue;
    }

    const key = `${speciesId}:${photo.id}`;
    if (plantPhotoDownloads.has(key)) continue;
    plantPhotoDownloads.add(key);
    try {
      const saved = await cachePlantPhoto(speciesId, photo);
      if (current) removeCachedPlantPhoto(speciesId, current.photoId);
      useSpeciesStore.setState((state) => ({
        plantPhotosBySpeciesId: { ...state.plantPhotosBySpeciesId, [speciesId]: saved },
      }));
    } catch {
      // The text reference stays usable without the photo.
    } finally {
      plantPhotoDownloads.delete(key);
    }
  }
}