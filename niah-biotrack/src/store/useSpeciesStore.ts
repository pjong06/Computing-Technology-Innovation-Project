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
} from '../api/species';

import {
  cachePrimarySpeciesImage,
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

  imageUrisBySpeciesId:
    Record<
      string,
      string
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

        imageUrisBySpeciesId: {},


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


            const previousIds =
              new Set(
                previousSpecies.map(
                  (item) =>
                    item.id
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
                        !previousIds.has(
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
               * loadSpeciesDetail() already avoids downloading
               * details again when the cached copy is less than
               * 24 hours old.
               *
               * This replaces the old manual
               * "Download for offline use" button.
               */
              for (
                const item of list
              ) {
                void get()
                  .loadSpeciesDetail(
                    item.id
                  );
              }

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


              let imageUri =
                get()
                  .imageUrisBySpeciesId[
                  id
                ];


              try {
                imageUri =
                  (
                    await cachePrimarySpeciesImage(
                      detail
                    )
                  ) ??
                  imageUri;
              } catch {
                /*
                 * Text reference remains usable if a
                 * species image cannot be cached.
                 */
              }


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

                  imageUrisBySpeciesId:
                    imageUri
                      ? {
                          ...state
                            .imageUrisBySpeciesId,

                          [id]:
                            imageUri,
                        }
                      : state
                          .imageUrisBySpeciesId,
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

            imageUrisBySpeciesId:
              state.imageUrisBySpeciesId,
          }),
      }
    )
  );