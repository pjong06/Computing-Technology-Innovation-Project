import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

import { apiFetch, ApiError } from '../api/client';
import { useProfileStore } from './useProfileStore';

import {
  getObservationMetadataSyncStatus,
  getPlantMetadataSyncStatus,
  loadOrMigrateRecords,
  persistObservation,
  persistRecordSnapshot,
} from '../services/offlineRecordRepository';

import { syncPlantPhotos } from '../services/plantPhotoSync';

import {
  clearOfflineDatabase,
  deletePlantLocallyAndQueueServerDelete,
} from '../services/offlineDatabase';

import { deleteStoredPhoto } from '../utils/photoStorage';
import { runOutboxSync } from '../services/syncEngine';

export enum SyncStatus {
  UPLOADED = 'Uploaded',
  NOT_UPLOADED = 'Not uploaded',
  FAILED = 'Upload failed',
  LOCAL_ONLY = 'Local only',
}

export enum RecordStatus {
  DRAFT = 'draft',
  COMPLETE = 'complete',
}

export enum IdentificationStatus {
  PENDING = 'pending',
  IDENTIFIED = 'identified',
}

export enum ReviewStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export type HealthStatus =
  | 'Healthy'
  | 'Stressed'
  | 'Diseased'
  | 'Damaged'
  | 'Dead';

export type LifeStage =
  | 'Bud'
  | 'Flowering'
  | 'Vegetative'
  | 'Fruiting'
  | 'Seedling'
  | 'Sapling'
  | 'Pole'
  | 'Mature'
  | 'Senescent';

export type PlantPhotoType =
  | 'whole_plant'
  | 'leaf'
  | 'flower'
  | 'bark';

export interface PlantPhotoEntry {
  id: string;
  uri: string;
  photoType: PlantPhotoType;
  syncStatus: SyncStatus;
  serverId?: string;
  lastError?: string;
}

export interface ObservationVisit {
  id: string;
  date: string;
  observedAt?: string;

  recordedBy: string;

  health?: HealthStatus;
  stage?: LifeStage;

  measurement: string;

  heightCm?: number;
  diameterCm?: number;

  photoUris?: string[];

  notes: string;

  syncStatus: SyncStatus;

  serverId?: string;
  rowVersion?: number;

  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number | null;

  submittedForReview?: boolean;
}

export interface PlantRecord {
  id: string;

  serverId?: string;
  rowVersion?: number;

  tagCode: string | null;

  scientificName: string;
  speciesId: string | null;

  commonName: string;
  family: string;

  height?: string;
  morphology?: string;
  description?: string;

  locationName: string;

  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number | null;

  gpsCoordination: string;

  photoUris: string[];
  photoEntries?: PlantPhotoEntry[];

  recordStatus: RecordStatus;
  identificationStatus: IdentificationStatus;
  syncStatus: SyncStatus;

  reviewStatus: ReviewStatus;
  reviewComment?: string | null;

  createdAt: string;
  createdAtIso?: string;

  conservationStatus?: 'EN' | 'VU' | 'LC' | 'CR';

  routeLength?: string;
  walkingTime?: string;

  observations: ObservationVisit[];
}

export interface RecordedRoute {
  id: string;

  distanceMeters: number;
  durationSeconds: number;

  endGps: string;

  linkedPlantId?: string;

  createdAt: string;
}

export type SyncResult =
  | {
      ok: true;
      submittedForReview: boolean;
    }
  | {
      ok: false;
      reason: string;
    };

function isUploadable(
  record: PlantRecord
): boolean {
  return (
    record.syncStatus !== SyncStatus.LOCAL_ONLY &&
    record.recordStatus === RecordStatus.COMPLETE &&
    record.identificationStatus ===
      IdentificationStatus.IDENTIFIED &&
    Boolean(record.speciesId)
  );
}

function isFullySubmitted(
  record: PlantRecord | undefined
): boolean {
  return (
    record?.reviewStatus === ReviewStatus.PENDING &&
    record.observations.length > 0 &&
    record.observations.every(
      (observation) =>
        observation.submittedForReview
    )
  );
}

export interface SyncAllResult {
  uploaded: number;
  failed: number;
  skipped: number;
}

export type SubmitResult =
  | {
      ok: true;
      sync: SyncResult;
    }
  | {
      ok: false;
      reason: string;
    };

const uploadsInProgress =
  new Set<string>();

function buildRegistrationVisit(
  record: PlantRecord
): ObservationVisit {
  const created =
    record.createdAtIso
      ? new Date(record.createdAtIso)
      : null;

  const me =
    useProfileStore.getState().me;

  return {
    id: randomUUID(),

    date: created
      ? `${created.toLocaleDateString(
          'en-GB',
          {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }
        )} · ${created.toLocaleTimeString(
          'en-US',
          {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }
        )}`
      : record.createdAt,

    observedAt: record.createdAtIso,

    recordedBy:
      me?.full_name ||
      me?.email ||
      'Field Staff',

    measurement: record.height
      ? `${record.height} m`
      : 'Not recorded',

    notes:
      record.description?.trim() ||
      'Registration visit (added on submit).',

    syncStatus:
      SyncStatus.NOT_UPLOADED,
  };
}

interface RecordState {
  records: PlantRecord[];

  routes: RecordedRoute[];

  activeDraftRoute:
    | RecordedRoute
    | null;

  addRecord: (
    record: Omit<
      PlantRecord,
      | 'id'
      | 'tagCode'
      | 'createdAt'
      | 'createdAtIso'
      | 'observations'
      | 'reviewStatus'
      | 'reviewComment'
    >
  ) => Promise<PlantRecord>;

  updateRecord: (
    id: string,
    updates: Pick<
      PlantRecord,
      | 'scientificName'
      | 'speciesId'
      | 'commonName'
      | 'family'
      | 'height'
      | 'morphology'
      | 'description'
      | 'locationName'
      | 'latitude'
      | 'longitude'
      | 'gpsAccuracyM'
      | 'gpsCoordination'
      | 'photoUris'
      | 'photoEntries'
      | 'recordStatus'
      | 'identificationStatus'
      | 'syncStatus'
    >
  ) => Promise<PlantRecord | null>;

  addObservation: (
    plantRecordId: string,
    observation: Omit<
      ObservationVisit,
      'id' | 'syncStatus' | 'observedAt'
    > & {
      observedAt: string;
    }
  ) => Promise<ObservationVisit | null>;

  syncRecord: (
    id: string
  ) => Promise<SyncResult>;

  syncAll: () =>
    Promise<SyncAllResult>;

  submitForReview: (
    id: string
  ) => Promise<SubmitResult>;

  deleteRecord: (
    id: string
  ) => Promise<
    | {
        ok: true;
        queuedForServer: boolean;
      }
    | {
        ok: false;
        reason: string;
      }
  >;

  findByTag: (
    tagCode: string
  ) => PlantRecord | undefined;

  attachTag: (
    recordId: string,
    tagCode: string
  ) => Promise<
    | {
        ok: true;
      }
    | {
        ok: false;
        reason: string;
      }
  >;

  hydrateOfflineRecords:
    () => Promise<void>;

  saveRoute: (
    route: Omit<
      RecordedRoute,
      'id' | 'createdAt'
    >
  ) => RecordedRoute;

  clearActiveDraftRoute:
    () => void;

  clearAllData:
    () => Promise<void>;
}

export const useRecordStore =
  create<RecordState>()(
    persist(
      (set, get) => ({
        records: [],

        routes: [],

        activeDraftRoute: null,

        addRecord: async (
          recordData
        ) => {
          const now =
            new Date();

          const newRecord: PlantRecord =
            {
              ...recordData,

              id: randomUUID(),

              tagCode: null,

              reviewStatus:
                ReviewStatus.DRAFT,

              reviewComment: null,

              createdAt:
                now.toLocaleDateString(
                  'en-GB',
                  {
                    day: 'numeric',
                    month: 'short',
                  }
                ),

              createdAtIso:
                now.toISOString(),

              observations: [],
            };

          await persistRecordSnapshot(
            newRecord,
            {
              queuePlant: true,
            }
          );

          set((state) => ({
            records: [
              newRecord,
              ...state.records,
            ],
          }));

          return newRecord;
        },

        updateRecord: async (
          id,
          updates
        ) => {
          const current =
            get().records.find(
              (record) =>
                record.id === id
            );

          if (!current) {
            return null;
          }

          if (
            current.reviewStatus !==
              ReviewStatus.DRAFT &&
            current.reviewStatus !==
              ReviewStatus.REJECTED
          ) {
            return null;
          }

          const updated = {
            ...current,
            ...updates,
          };

          await persistRecordSnapshot(
            updated,
            {
              queuePlant: true,

              queueObservationIds:
                updated.observations
                  .filter(
                    (observation) =>
                      observation.syncStatus !==
                      SyncStatus.UPLOADED
                  )
                  .map(
                    (observation) =>
                      observation.id
                  ),
            }
          );

          set((state) => ({
            records:
              state.records.map(
                (record) =>
                  record.id === id
                    ? updated
                    : record
              ),
          }));

          return updated;
        },

        addObservation: async (
          plantRecordId,
          observationData
        ) => {
          const record =
            get().records.find(
              (item) =>
                item.id ===
                plantRecordId
            );

          if (!record) {
            return null;
          }

          const newObservation:
            ObservationVisit = {
            ...observationData,

            id: randomUUID(),

            syncStatus:
              SyncStatus.NOT_UPLOADED,
          };

          const updatedRecord:
            PlantRecord = {
            ...record,

            observations: [
              newObservation,
              ...record.observations,
            ],

            syncStatus:
              record.syncStatus ===
              SyncStatus.UPLOADED
                ? SyncStatus.NOT_UPLOADED
                : record.syncStatus,
          };

          await persistObservation(
            updatedRecord,
            newObservation,
            isUploadable(
              updatedRecord
            )
          );

          await persistRecordSnapshot(
            updatedRecord
          );

          set((state) => ({
            records:
              state.records.map(
                (item) =>
                  item.id ===
                  plantRecordId
                    ? updatedRecord
                    : item
              ),
          }));

          return newObservation;
        },

        syncRecord: async (
          id
        ) => {
          const record =
            get().records.find(
              (item) =>
                item.id === id
            );

          if (!record) {
            return {
              ok: false,
              reason:
                'Record not found',
            };
          }

          if (
            !isUploadable(
              record
            )
          ) {
            return {
              ok: false,

              reason:
                'Confirm an approved species and complete this draft before uploading it.',
            };
          }

          if (
            uploadsInProgress.has(
              id
            )
          ) {
            return {
              ok: false,

              reason:
                'This record is already uploading',
            };
          }

          uploadsInProgress.add(
            id
          );

          try {
            const plantMetadataStatus =
              await getPlantMetadataSyncStatus(
                id
              );

            const queueObservationIds:
              string[] = [];

            for (
              const observation of
              record.observations
            ) {
              const status =
                await getObservationMetadataSyncStatus(
                  observation.id
                );

              if (
                status === null ||
                status ===
                  'local_only'
              ) {
                queueObservationIds.push(
                  observation.id
                );
              }
            }

            await persistRecordSnapshot(
              record,
              {
                queuePlant:
                  plantMetadataStatus ===
                    null ||
                  plantMetadataStatus ===
                    'local_only',

                queueObservationIds,
              }
            );

            const run =
              await runOutboxSync();

            let refreshedRecords =
              await loadOrMigrateRecords(
                get().records
              );

            set({
              records:
                refreshedRecords,
            });

            let refreshed =
              refreshedRecords.find(
                (item) =>
                  item.id === id
              );

            if (!refreshed) {
              return {
                ok: false,

                reason:
                  'Record not found after synchronization',
              };
            }

            if (run.error) {
              return {
                ok: false,
                reason: run.error,
              };
            }

            const plantStatus =
              await getPlantMetadataSyncStatus(
                id
              );

            const observationStatuses =
              await Promise.all(
                refreshed.observations.map(
                  (observation) =>
                    getObservationMetadataSyncStatus(
                      observation.id
                    )
                )
              );

            const hasConflict =
              plantStatus ===
                'conflict' ||
              observationStatuses.some(
                (status) =>
                  status ===
                  'conflict'
              );

            const hasFailure =
              plantStatus ===
                'failed' ||
              observationStatuses.some(
                (status) =>
                  status ===
                  'failed'
              );

            if (
              hasConflict ||
              hasFailure
            ) {
              return {
                ok: false,

                reason:
                  hasConflict
                    ? 'A newer server version exists. This record needs conflict review.'
                    : 'The server rejected part of this record. Review it and try again.',
              };
            }

            const metadataReady =
              plantStatus ===
                'uploaded' &&
              observationStatuses.every(
                (status) =>
                  status ===
                  'uploaded'
              );

            if (!metadataReady) {
              return {
                ok: false,

                reason:
                  'Some metadata operations are still waiting to upload.',
              };
            }

            const photoRun =
              await syncPlantPhotos(
                refreshed
              );

            refreshed =
              photoRun.record;

            await persistRecordSnapshot(
              refreshed
            );

            set((state) => ({
              records:
                state.records.map(
                  (item) =>
                    item.id === id
                      ? refreshed!
                      : item
                ),
            }));

            refreshedRecords =
              await loadOrMigrateRecords(
                get().records
              );

            set({
              records:
                refreshedRecords,
            });

            refreshed =
              refreshedRecords.find(
                (item) =>
                  item.id === id
              );

            if (!refreshed) {
              return {
                ok: false,

                reason:
                  'Record not found after photo synchronization',
              };
            }

            if (
              photoRun.error
            ) {
              return {
                ok: false,
                reason:
                  photoRun.error,
              };
            }

            if (
              refreshed.reviewStatus ===
              ReviewStatus.PENDING
            ) {
              const submittedIds =
                new Set<string>();

              for (
                const observation of [
                  ...refreshed.observations,
                ].reverse()
              ) {
                if (
                  !observation.serverId ||
                  observation.submittedForReview
                ) {
                  continue;
                }

                await apiFetch(
                  `/api/observations/${observation.serverId}/submit`,
                  {
                    method:
                      'PATCH',
                  }
                );

                submittedIds.add(
                  observation.id
                );
              }

              if (
                submittedIds.size >
                0
              ) {
                refreshed = {
                  ...refreshed,

                  observations:
                    refreshed.observations.map(
                      (
                        observation
                      ) =>
                        submittedIds.has(
                          observation.id
                        )
                          ? {
                              ...observation,

                              submittedForReview:
                                true,
                            }
                          : observation
                    ),
                };

                set((state) => ({
                  records:
                    state.records.map(
                      (item) =>
                        item.id ===
                        id
                          ? refreshed!
                          : item
                    ),
                }));

                await persistRecordSnapshot(
                  refreshed
                );
              }
            }

            const photosUploaded =
              (
                refreshed.photoEntries ??
                []
              ).every(
                (photo) =>
                  photo.syncStatus ===
                  SyncStatus.UPLOADED
              );

            const completelyUploaded =
              refreshed.syncStatus ===
                SyncStatus.UPLOADED &&
              refreshed.observations.every(
                (observation) =>
                  observation.syncStatus ===
                  SyncStatus.UPLOADED
              ) &&
              photosUploaded;

            return completelyUploaded
              ? {
                  ok: true,

                  submittedForReview:
                    isFullySubmitted(
                      refreshed
                    ),
                }
              : {
                  ok: false,

                  reason:
                    'Some operations are still waiting to upload.',
                };
          } catch (error) {
            const reason =
              error instanceof
              ApiError
                ? error.message
                : 'Upload failed unexpectedly. Please try again.';

            return {
              ok: false,
              reason,
            };
          } finally {
            uploadsInProgress.delete(
              id
            );
          }
        },

        syncAll: async () => {
          /*
           * Process SQLite outbox first.
           *
           * This is important for delete operations because
           * deleted records are already removed from records[].
           */
          await runOutboxSync();

          const refreshedRecords =
            await loadOrMigrateRecords(
              get().records
            );

          set({
            records:
              refreshedRecords,
          });

          const ids =
            refreshedRecords
              .filter(
                (record) =>
                  isUploadable(
                    record
                  ) &&
                  (
                    record.syncStatus !==
                      SyncStatus.UPLOADED ||
                    (
                      record.reviewStatus ===
                        ReviewStatus.PENDING &&
                      !isFullySubmitted(
                        record
                      )
                    )
                  )
              )
              .map(
                (record) =>
                  record.id
              );

          let uploaded = 0;
          let failed = 0;
          let skipped = 0;

          for (
            const id of ids
          ) {
            if (
              uploadsInProgress.has(
                id
              )
            ) {
              skipped += 1;
              continue;
            }

            const result =
              await get().syncRecord(
                id
              );

            if (result.ok) {
              uploaded += 1;
            } else {
              failed += 1;
            }
          }

          return {
            uploaded,
            failed,
            skipped,
          };
        },

        submitForReview:
          async (id) => {
            const record =
              get().records.find(
                (item) =>
                  item.id === id
              );

            if (!record) {
              return {
                ok: false,
                reason:
                  'Record not found',
              };
            }

            if (
              record.reviewStatus !==
                ReviewStatus.DRAFT &&
              record.reviewStatus !==
                ReviewStatus.REJECTED
            ) {
              return {
                ok: false,

                reason:
                  'This record has already been submitted',
              };
            }

            if (
              !isUploadable(
                record
              )
            ) {
              return {
                ok: false,

                reason:
                  'Confirm an approved species and complete this draft before submitting it.',
              };
            }

            const registrationVisit =
              record.observations
                .length === 0
                ? buildRegistrationVisit(
                    record
                  )
                : null;

            set((state) => ({
              records:
                state.records.map(
                  (item) =>
                    item.id === id
                      ? {
                          ...item,

                          reviewStatus:
                            ReviewStatus.PENDING,

                          syncStatus:
                            SyncStatus.NOT_UPLOADED,

                          observations:
                            registrationVisit
                              ? [
                                  registrationVisit,
                                ]
                              : item.observations,
                        }
                      : item
                ),
            }));

            const sync =
              await get().syncRecord(
                id
              );

            return {
              ok: true,
              sync,
            };
          },

        deleteRecord:
          async (id) => {
            const record =
              get().records.find(
                (item) =>
                  item.id === id
              );

            if (!record) {
              return {
                ok: false,

                reason:
                  'Plant record not found',
              };
            }

            /*
             * Botanists may delete records they are still
             * working on, or records returned by the officer.
             *
             * Pending / approved records stay protected.
             */
            if (
              record.reviewStatus !==
                ReviewStatus.DRAFT &&
              record.reviewStatus !==
                ReviewStatus.REJECTED
            ) {
              return {
                ok: false,

                reason:
                  'Records waiting for review or already approved cannot be deleted by the Botanist.',
              };
            }

            if (
              uploadsInProgress.has(
                id
              )
            ) {
              return {
                ok: false,

                reason:
                  'This record is currently synchronizing. Try deleting it again after the upload finishes.',
              };
            }

            try {
              const deletion =
                await deletePlantLocallyAndQueueServerDelete(
                  {
                    clientRecordId:
                      record.id,

                    serverId:
                      record.serverId,

                    rowVersion:
                      record.rowVersion,

                    observationIds:
                      record.observations.map(
                        (
                          observation
                        ) =>
                          observation.id
                      ),
                  }
                );

              /*
               * Remove from UI immediately.
               *
               * If the user is offline, the server-delete
               * operation remains safely inside SQLite outbox.
               */
              set((state) => ({
                records:
                  state.records.filter(
                    (item) =>
                      item.id !== id
                  ),
              }));

              /*
               * Delete local permanent plant photos.
               */
              for (
                const uri of
                record.photoUris ??
                []
              ) {
                deleteStoredPhoto(
                  uri
                );
              }

              /*
               * Delete local observation photos too.
               */
              for (
                const observation of
                record.observations
              ) {
                for (
                  const uri of
                  observation.photoUris ??
                  []
                ) {
                  deleteStoredPhoto(
                    uri
                  );
                }
              }

              /*
               * If the plant already exists on Supabase,
               * try the delete immediately.
               *
               * If offline, the outbox remains pending/retry
               * and reconnect auto-sync will finish it later.
               */
              if (
                deletion.queuedForServer
              ) {
                void runOutboxSync();
              }

              return {
                ok: true,

                queuedForServer:
                  deletion.queuedForServer,
              };
            } catch (error) {
              return {
                ok: false,

                reason:
                  error instanceof
                  Error
                    ? error.message
                    : 'Could not delete this plant record.',
              };
            }
          },

        findByTag: (
          tagCode
        ) =>
          get().records.find(
            (record) =>
              record.tagCode ===
              tagCode
          ),

        attachTag: async (
          recordId,
          tagCode
        ) => {
          const existing =
            get().findByTag(
              tagCode
            );

          if (
            existing &&
            existing.id !==
              recordId
          ) {
            return {
              ok: false,

              reason:
                `This tag is already attached to ${
                  existing.scientificName ||
                  'an identification-pending record'
                }`,
            };
          }

          const current =
            get().records.find(
              (record) =>
                record.id ===
                recordId
            );

          if (!current) {
            return {
              ok: false,

              reason:
                'Plant record not found',
            };
          }

          const updated = {
            ...current,
            tagCode,
          };

          await persistRecordSnapshot(
            updated,
            {
              queuePlant: true,
            }
          );

          set((state) => ({
            records:
              state.records.map(
                (record) =>
                  record.id ===
                  recordId
                    ? updated
                    : record
              ),
          }));

          return {
            ok: true,
          };
        },

        saveRoute: (
          routeData
        ) => {
          const route:
            RecordedRoute = {
            ...routeData,

            id: `route-${Date.now()}`,

            createdAt:
              new Date().toISOString(),
          };

          set((state) => ({
            routes: [
              route,
              ...state.routes,
            ],

            activeDraftRoute:
              route,
          }));

          return route;
        },

        hydrateOfflineRecords:
          async () => {
            const records =
              await loadOrMigrateRecords(
                get().records
              );

            set({
              records,
            });
          },

        clearActiveDraftRoute:
          () =>
            set({
              activeDraftRoute:
                null,
            }),

        clearAllData:
          async () => {
            await clearOfflineDatabase();

            set({
              records: [],
              routes: [],
              activeDraftRoute:
                null,
            });
          },
      }),

      {
        name:
          'niah-ground-truth-store',

        storage:
          createJSONStorage(
            () =>
              AsyncStorage
          ),

        version: 9,

        migrate: (
          persistedState,
          version
        ) => {
          const state =
            persistedState as {
              records?: Record<
                string,
                unknown
              >[];
            };

          if (
            version < 1 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                ({
                  recordId:
                    _discarded,
                  ...record
                }) => ({
                  ...record,
                  tagCode: null,
                })
              );
          }

          if (
            version < 2 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (record) => ({
                  ...record,

                  status:
                    SyncStatus.NOT_UPLOADED,

                  observations:
                    Array.isArray(
                      record.observations
                    )
                      ? (
                          record.observations as Record<
                            string,
                            unknown
                          >[]
                        ).map(
                          (
                            observation
                          ) => ({
                            ...observation,

                            status:
                              SyncStatus.NOT_UPLOADED,
                          })
                        )
                      : [],
                })
              );
          }

          if (
            version < 3 &&
            Array.isArray(
              state.records
            )
          ) {
            const toSync = (
              old: unknown
            ) =>
              old === 'Synced' ||
              old === 'Uploaded'
                ? SyncStatus.UPLOADED
                : old ===
                      'Failed' ||
                    old ===
                      'Upload failed'
                  ? SyncStatus.FAILED
                  : SyncStatus.NOT_UPLOADED;

            state.records =
              state.records.map(
                ({
                  status,
                  ...record
                }) => ({
                  ...record,

                  syncStatus:
                    toSync(
                      status
                    ),

                  observations:
                    Array.isArray(
                      record.observations
                    )
                      ? (
                          record.observations as Record<
                            string,
                            unknown
                          >[]
                        ).map(
                          ({
                            status:
                              observationStatus,
                            ...observation
                          }) => ({
                            ...observation,

                            syncStatus:
                              toSync(
                                observationStatus
                              ),
                          })
                        )
                      : [],
                })
              );
          }

          if (
            version < 4 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (record) => ({
                  ...record,

                  reviewStatus:
                    ReviewStatus.DRAFT,

                  reviewComment:
                    null,
                })
              );
          }

          if (
            version < 5 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (record) => ({
                  ...record,

                  speciesId:
                    null,
                })
              );
          }

          if (
            version < 6 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (record) => ({
                  ...record,

                  observations:
                    Array.isArray(
                      record.observations
                    )
                      ? (
                          record.observations as Record<
                            string,
                            unknown
                          >[]
                        ).map(
                          (
                            observation
                          ) =>
                            typeof observation.id ===
                              'string' &&
                            observation.id.startsWith(
                              'obs-'
                            )
                              ? {
                                  ...observation,

                                  id: randomUUID(),
                                }
                              : observation
                        )
                      : [],
                })
              );
          }

          if (
            version < 8 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (record) =>
                  record.reviewStatus ===
                    ReviewStatus.PENDING &&
                  record.syncStatus ===
                    SyncStatus.UPLOADED
                    ? {
                        ...record,

                        syncStatus:
                          SyncStatus.NOT_UPLOADED,
                      }
                    : record
              );
          }

          if (
            version < 9 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (record) => {
                  if (
                    record.recordStatus !==
                      undefined &&
                    record.identificationStatus !==
                      undefined
                  ) {
                    return record;
                  }

                  const hasName =
                    typeof record.scientificName ===
                      'string' &&
                    record.scientificName.trim() !==
                      '';

                  return {
                    ...record,

                    recordStatus:
                      hasName
                        ? RecordStatus.COMPLETE
                        : RecordStatus.DRAFT,

                    identificationStatus:
                      hasName
                        ? IdentificationStatus.IDENTIFIED
                        : IdentificationStatus.PENDING,

                    syncStatus:
                      hasName
                        ? record.syncStatus
                        : SyncStatus.LOCAL_ONLY,
                  };
                }
              );
          }

          return state as unknown as RecordState;
        },
      }
    )
  );