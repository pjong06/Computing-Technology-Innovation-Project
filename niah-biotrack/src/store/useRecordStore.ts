import { create } from 'zustand';
import {
  persist,
  createJSONStorage,
} from 'zustand/middleware';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';

import {
  apiFetch,
  apiUpload,
  ApiError,
} from '../api/client';

import { useProfileStore } from './useProfileStore';

import {
  getObservationMetadataSyncStatus,
  getPlantMetadataSyncStatus,
  loadOrMigrateRecords,
  persistObservation,
  persistRecordSnapshot,
} from '../services/offlineRecordRepository';

import {
  syncPlantPhotos,
} from '../services/plantPhotoSync';

import {
  clearOfflineDatabase,
  deletePlantLocallyAndQueueServerDelete,
} from '../services/offlineDatabase';

import {
  deleteStoredPhoto,
  resolveStoredPhotoUri,
} from '../utils/photoStorage';

import {
  runOutboxSync,
  isRetryableStatus,
  type SyncRunResult,
} from '../services/syncEngine';
import { requestSyncRetry } from '../services/syncRetry';
import type { ServerPlantDetails } from '../utils/plantDetails';
import { TAG_PROBLEM_REASON, type TagProblemCode } from '../utils/plantStatusLine';

const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
import { uploadablePhotoFile } from '../services/uploadablePhoto';
import {
  applyServerReview,
  isPhotoLockFinal,
  oversizedPhotoMessage,
} from '../utils/submissionState';

import {
  checkDiameterCm,
  checkHeightMetres,
  metresToCm,
} from '../utils/units';

import {
  buildRouteUpload,
  linkedPlantServerId,
  migrateRoutesToV10,
  routesToUpload,
  type RouteSyncStatus,
} from '../utils/routeSync';

/* =========================================================
 * ENUMS
 * ======================================================= */

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

/* =========================================================
 * TYPES
 * ======================================================= */

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

/*
 * MAIN photo metadata.
 *
 * Used by Plant Detail to show:
 * - uploaded
 * - too large
 * - locked
 * - missing
 */
export interface PhotoUpload {
  id: string;

  type?: PlantPhotoType;

  uploaded: boolean;

  problem?:
    | 'too_large'
    | 'locked'
    | 'missing';
}

/*
 * KAI / OFFLINE-SYNC plant-photo entry.
 *
 * This is persisted in SQLite and gives every
 * plant photo its own durable sync state.
 */
export interface PlantPhotoEntry {
  id: string;

  uri: string;

  photoType:
    PlantPhotoType;

  syncStatus:
    SyncStatus;

  serverId?: string;

  lastError?: string;
}

export const MAX_PHOTO_BYTES =
  5 * 1024 * 1024;

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

  /*
   * Observation photos.
   */
  photoUris?: string[];

  photoMeta?: Record<
    string,
    PhotoUpload
  >;

  notes: string;

  syncStatus:
    SyncStatus;

  serverId?: string;

  rowVersion?: number;

  latitude?: number;

  longitude?: number;

  gpsAccuracyM?:
    | number
    | null;

  submissionRequested?: boolean;

  submittedForReview?:
    boolean;

  /*
   * The officer's decision on this visit, read back
   * from the server by refreshReviewStatuses.
   */
  reviewStatus?:
    ReviewStatus;

  /*
   * The officer's reason, when rejected.
   */
  reviewComment?:
    | string
    | null;

  /*
   * Why this visit could not be sent for review
   * (the server's refusal, or a photo over 5 MB),
   * in plain words. Cleared once it is submitted.
   */
  submitError?:
    | string
    | null;
}

/*
 * Why the server refused this plant's tag:
 * in_use = another plant already has it;
 * not_yours = it isn't one of this botanist's reserved tags;
 * already_set = the plant already has a physical tag on the server;
 * locked = the plant can't be changed any more (a change other than the tag).
 * Rebuilt from the SQLite outbox on every load.
 */
export type TagProblem = TagProblemCode;

export interface PlantRecord {
  syncError?: string;
  /*
   * Stable local UUID.
   */
  id: string;

  /*
   * Supabase/server identity.
   */
  serverId?: string;
  plantName?: string;
  rowVersion?: number;

  /*
   * Another botanist's approved plant, kept on the phone after a tag scan
   * (src/services/tagLookup.ts). Not counted as "My plants" unless this
   * botanist has added visits to it.
   */
  otherBotanist?: boolean;

  /*
   * For a plant this botanist didn't register (another botanist's or an imported one) that
   * is on the public QR page: the address of its public stripped photo ("/p/<tag>/photo",
   * from the tag lookup). Shown when the phone has no photo of the plant itself.
   */
  publicPhotoUrl?: string | null;

  /*
   * The server's "This plant" details of an approved plant (location, location note,
   * morphology, notes, latest approved observation), from the tag lookup. Shown for plants
   * someone else registered; for the botanist's own plants only where the phone has nothing
   * (src/utils/plantDetails.ts).
   */
  serverDetails?: ServerPlantDetails | null;

  tagCode:
    | string
    | null;

  tagProblem?:
    | TagProblem
    | null;

  scientificName: string;

  speciesId:
    | string
    | null;

  commonName: string;

  family: string;

  height?: string;

  diameter?: string;

  morphology?: string;

  description?: string;

  locationName: string;

  latitude?: number;

  longitude?: number;

  gpsAccuracyM?:
    | number
    | null;

  gpsCoordination: string;

  /*
   * Compatibility list used throughout UI.
   */
  photoUris: string[];

  /*
   * MAIN metadata.
   */
  photoMeta?: Record<
    string,
    PhotoUpload
  >;

  /*
   * KAI SQLite/offline metadata.
   */
  photoEntries?:
    PlantPhotoEntry[];

  recordStatus:
    RecordStatus;

  identificationStatus:
    IdentificationStatus;

  syncStatus:
    SyncStatus;

  reviewStatus:
    ReviewStatus;

  reviewComment?:
    | string
    | null;

  createdAt: string;

  createdAtIso?: string;

  conservationStatus?:
    | 'EN'
    | 'VU'
    | 'LC'
    | 'CR';

  routeLength?: string;

  walkingTime?: string;

  observations:
    ObservationVisit[];
}

export interface RoutePoint {
  latitude: number;

  longitude: number;

  timestamp: number;

  accuracy:
    | number
    | null;
}

export interface RouteWaypoint {
  id: string;

  number: number;

  label: string;
  description?: string;
  latitude: number;

  longitude: number;

  timeString: string;
}

export interface RecordedRoute {
  id: string;

  distanceMeters: number;

  durationSeconds: number;

  startDescription?: string;

  endDescription?: string;
  
  endGps: string;

  endLatitude?: number;

  endLongitude?: number;

  endAccuracyM?:
    | number
    | null;

  breadcrumbs?:
    RoutePoint[];

  waypoints?:
    RouteWaypoint[];

  linkedPlantId?: string;

  createdAt: string;

  /*
   * Route upload (separate from the plant/visit
   * sync; see src/utils/routeSync.ts).
   * clientRouteId never changes, so a repeated
   * upload finds the same server row.
   */
  clientRouteId?: string;

  syncStatus?: RouteSyncStatus;

  serverId?: string;

  /*
   * Plain reason when the last upload failed.
   */
  syncError?: string | null;
}

export type SyncResult =
  (
    | {
        ok: true;

        submittedForReview:
          boolean;
      }
    | {
        ok: false;

        reason: string;
      }
  ) & {
    retryable?: boolean;
    photosUploaded?:
      number;

    photoProblems?:
      number;
  };

export interface SyncAllResult {
  retryable: boolean;
  uploaded: number;

  failed: number;

  skipped: number;

  photosUploaded: number;

  photoProblems: number;
}

export type SubmitResult =
  | {
      ok: true;

      sync:
        SyncResult;
    }
  | {
      ok: false;

      reason: string;
    };

/* =========================================================
 * HELPERS
 * ======================================================= */

/*
 * One route upload run at a time (Sync now and the
 * automatic sync can both start one).
 */
let routeSyncRunning = false;

/*
 * Plain reason for a route that did not upload.
 */
function routeUploadProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return 'No connection to the server. It will upload on the next sync.';
    }
    if (error.status === 401) {
      return 'You are signed out. Sign in, then sync again.';
    }
    if (isRetryableStatus(error.status)) {
      return 'The server could not save the route right now. Please try again.';
    }
    // 400/403 from POST /api/routes carry a plain message.
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : 'The route could not be uploaded. Please try again.';
}

const uploadsInProgress =
  new Set<string>();

function formatRouteLength(
  meters: number
): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }

  return `${Math.round(meters)} m`;
}

function formatWalkingTime(
  seconds: number
): string {
  const mins = Math.max(
    1,
    Math.round(seconds / 60)
  );

  return `${mins} min`;
}

function isUploadable(
  record: PlantRecord
): boolean {
  if (record.serverId) {
    return record.recordStatus ===
      RecordStatus.COMPLETE;
  }

  return (
    record.syncStatus !==
      SyncStatus.LOCAL_ONLY &&
    record.recordStatus ===
      RecordStatus.COMPLETE &&
    record.identificationStatus ===
      IdentificationStatus.IDENTIFIED &&
    Boolean(
      record.speciesId
    )
  );
}

function isFullySubmitted(
  record:
    | PlantRecord
    | undefined
): boolean {
  return Boolean(
    record &&
    record.observations.length > 0 &&
    record.observations.every(
      (observation) =>
        observation.submittedForReview ||
        observation.reviewStatus ===
          ReviewStatus.PENDING ||
        observation.reviewStatus ===
          ReviewStatus.APPROVED
    )
  );
}

function hasPendingPhotos(
  record: PlantRecord
): boolean {
  const plantPending =
    (
      record.photoEntries ??
      []
    ).some(
      (photo) =>
        photo.syncStatus !==
        SyncStatus.UPLOADED
    );

  const observationPending =
    record.observations.some(
      (observation) =>
        (
          observation.photoUris ??
          []
        ).some(
          (uri) =>
            !observation
              .photoMeta?.[
                uri
              ]?.uploaded &&
            observation
              .photoMeta?.[
                uri
              ]?.problem !==
              'locked'
        )
    );

  return (
    plantPending ||
    observationPending
  );
}

/*
 * MAIN's maximum-size check.
 */
function photoFileFor(
  uri: string
):
  | {
      file: File;
    }
  | {
      problem:
        | 'too_large'
        | 'missing';
    } {
  const file =
    new File(
      resolveStoredPhotoUri(
        uri
      )
    );

  if (!file.exists) {
    return {
      problem: 'missing',
    };
  }

  if (
    file.size >
    MAX_PHOTO_BYTES
  ) {
    return {
      problem:
        'too_large',
    };
  }

  return {
    file,
  };
}

/*
 * Turn plantPhotoSync error text into the same
 * UI problem values main uses.
 */
function inferPhotoProblem(
  message?: string
):
  | PhotoUpload['problem']
  | undefined {
  if (!message) {
    return undefined;
  }

  const lower =
    message.toLowerCase();

  if (
    lower.includes(
      '5 mb'
    ) ||
    lower.includes(
      'too large'
    ) ||
    lower.includes(
      '413'
    )
  ) {
    return 'too_large';
  }

  if (
    lower.includes(
      "can't be added after submission"
    ) ||
    lower.includes(
      'photos_locked'
    )
  ) {
    return 'locked';
  }

  if (
    lower.includes(
      'no longer available'
    ) ||
    lower.includes(
      'not available on this phone'
    )
  ) {
    return 'missing';
  }

  return undefined;
}

/*
 * Keep main's photoMeta synchronized with
 * our durable photoEntries.
 */
function mirrorPlantPhotoMeta(
  record: PlantRecord
): PlantRecord {
  const nextMeta: Record<
    string,
    PhotoUpload
  > = {
    ...(record.photoMeta ??
      {}),
  };

  for (
    const photo of
    record.photoEntries ??
    []
  ) {
    const previous =
      nextMeta[photo.uri];

    nextMeta[photo.uri] = {
      ...previous,

      id: photo.id,

      type:
        photo.photoType,

      uploaded:
        photo.syncStatus ===
        SyncStatus.UPLOADED,

      problem:
        photo.syncStatus ===
        SyncStatus.FAILED
          ? inferPhotoProblem(
              photo.lastError
            )
          : undefined,
    };
  }

  return {
    ...record,
    photoMeta:
      nextMeta,
  };
}

function buildRegistrationVisit(
  record: PlantRecord
): ObservationVisit {
  const created =
    record.createdAtIso
      ? new Date(
          record.createdAtIso
        )
      : null;

  const me =
    useProfileStore.getState()
      .me;

  return {
    id: randomUUID(),

    date: created
      ? `${created.toLocaleDateString(
          'en-GB',
          {
            day: 'numeric',
            month: 'short',
            year:
              'numeric',
          }
        )} · ${created.toLocaleTimeString(
          'en-US',
          {
            hour:
              'numeric',
            minute:
              '2-digit',
            hour12:
              true,
          }
        )}`
      : record.createdAt,

    observedAt:
      record.createdAtIso,

    recordedBy:
      me?.full_name ||
      me?.email ||
      'Field Staff',

    measurement:
      record.height
        ? `${record.height} m`
        : 'Not recorded',

    /*
     * The plant's typed height (m) and diameter (cm),
     * stored in cm like every other visit.
     */
    heightCm: (() => {
      const height = checkHeightMetres(record.height);
      return height.ok ? metresToCm(height.value) : undefined;
    })(),

    diameterCm: (() => {
      const diameter = checkDiameterCm(record.diameter);
      return diameter.ok ? diameter.value : undefined;
    })(),

    notes:
      record.description?.trim() ||
      'Registration observation (added on submit).',

    syncStatus:
      SyncStatus.NOT_UPLOADED,
  };
}

/* =========================================================
 * STORE INTERFACE
 * ======================================================= */

interface RecordState {
  records:
    PlantRecord[];

  routes:
    RecordedRoute[];

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
      | 'diameter'
      | 'morphology'
      | 'description'
      | 'locationName'
      | 'latitude'
      | 'longitude'
      | 'gpsAccuracyM'
      | 'gpsCoordination'
      | 'photoUris'
      | 'photoMeta'
      | 'photoEntries'
      | 'recordStatus'
      | 'identificationStatus'
      | 'syncStatus'
      | 'reviewStatus'
      | 'observations'
    >
  ) =>
    Promise<
      | PlantRecord
      | null
    >;

  cacheServerRecord: (
    record: PlantRecord
  ) => Promise<PlantRecord>;

  addObservation: (
    plantRecordId:
      string,

    observation:
      Omit<
        ObservationVisit,
        | 'id'
        | 'syncStatus'
        | 'observedAt'
      > & {
        observedAt:
          string;
      }
  ) =>
    Promise<
      | ObservationVisit
      | null
    >;

  syncRecord: (
    id: string,
    outboxRun?: SyncRunResult
  ) =>
    Promise<SyncResult>;

  syncAll:
    () =>
      Promise<SyncAllResult>;

  /*
   * Read-only: picks up the officer's decisions
   * for submitted visits.
   */
  refreshReviewStatuses:
    () => Promise<void>;

  /*
   * MAIN photo problem removal.
   */
  removePhoto: (
    recordId:
      string,

    uri: string,

    obsId?: string
  ) => Promise<void>;

  submitForReview: (
    id: string
  ) =>
    Promise<SubmitResult>;

  /*
   * KAI offline delete.
   */
  deleteRecord: (
    id: string
  ) =>
    Promise<
      | {
          ok: true;

          queuedForServer:
            boolean;
        }
      | {
          ok: false;

          reason: string;
        }
    >;

  findByTag: (
    tagCode: string
  ) =>
    | PlantRecord
    | undefined;

  attachTag: (
    recordId:
      string,

    tagCode:
      string,

    /*
     * Set when the server already saved this tag
     * (POST /api/plants/:id/attach-tag): the plant's
     * row_version after that write.
     */
    options?: {
      serverRowVersion?: number;
    }
  ) =>
    Promise<
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
      | 'id'
      | 'createdAt'
    >
  ) => RecordedRoute;

  linkRouteToPlant: (
    routeId: string,
    plantId: string
  ) => Promise<void>;

  /*
   * Uploads saved routes with POST /api/routes,
   * one at a time. Separate from syncAll(): it
   * never touches plant records or the outbox.
   */
  syncRoutes: () => Promise<{
    uploaded: number;
    failed: number;
  }>;

  discardDraftRoute:
    () => void;

  clearActiveDraftRoute:
    () => void;

  clearAllData:
    () => Promise<void>;
}

/* =========================================================
 * STORE
 * ======================================================= */

export const useRecordStore =
  create<RecordState>()(
    persist(
      (
        set,
        get
      ) => ({
        records: [],

        routes: [],

        activeDraftRoute:
          null,

        /* -------------------------------------------------
         * ADD PLANT
         * ------------------------------------------------ */

        addRecord:
          async (
            recordData
          ) => {
            const now =
              new Date();

            const newRecord:
              PlantRecord = {
              ...recordData,

              id:
                randomUUID(),

              tagCode:
                null,

              reviewComment:
                null,

              createdAt:
                now.toLocaleDateString(
                  'en-GB',
                  {
                    day:
                      'numeric',

                    month:
                      'short',
                  }
                ),

              createdAtIso:
                now.toISOString(),

            };

            /*
             * CRITICAL:
             *
             * SQLite is written BEFORE React UI state.
             * This is our local-first guarantee.
             */
            await persistRecordSnapshot(
              newRecord,
              {
                queuePlant:
                  true,

                queueObservationIds:
                  newRecord.observations
                    .filter(
                      (observation) =>
                        newRecord.syncStatus !== SyncStatus.LOCAL_ONLY &&
                        observation.syncStatus !== SyncStatus.UPLOADED
                    )
                    .map((observation) => observation.id),
              }
            );

            set(
              (state) => ({
                records: [
                  newRecord,
                  ...state.records,
                ],
              })
            );

            return newRecord;
          },

        /* -------------------------------------------------
         * UPDATE PLANT
         * ------------------------------------------------ */

        updateRecord:
          async (
            id,
            updates
          ) => {
            const current =
              get().records.find(
                (record) =>
                  record.id ===
                  id
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

            const updated:
              PlantRecord = {
              ...current,
              ...updates,
            };

            await persistRecordSnapshot(
              updated,
              {
                queuePlant:
                  true,

                queueObservationIds:
                  updated.observations
                    .filter(
                      (
                        observation
                      ) =>
                        observation
                          .syncStatus !==
                        SyncStatus.UPLOADED
                    )
                    .map(
                      (
                        observation
                      ) =>
                        observation.id
                    ),
              }
            );

            set(
              (state) => ({
                records:
                  state.records.map(
                    (
                      record
                    ) =>
                      record.id ===
                      id
                        ? updated
                        : record
                  ),
              })
            );

            return updated;
          },

        cacheServerRecord:
          async (record) => {
            const existing =
              get().records.find(
                (item) =>
                  item.serverId === record.serverId ||
                  (record.tagCode !== null &&
                    item.tagCode === record.tagCode)
              );

            if (existing) {
              // Someone else's plant already on the phone: keep its server details current
              // (they may have been empty when it was first opened).
              if (existing.otherBotanist && record.serverDetails) {
                const refreshed: PlantRecord = {
                  ...existing,
                  serverDetails: record.serverDetails,
                  publicPhotoUrl: record.publicPhotoUrl ?? existing.publicPhotoUrl,
                };
                await persistRecordSnapshot(refreshed);
                set((state) => ({
                  records: state.records.map((item) => (item.id === existing.id ? refreshed : item)),
                }));
                return refreshed;
              }
              return existing;
            }

            await persistRecordSnapshot(record);

            set((state) => ({
              records: state.records.some(
                (item) =>
                  item.serverId === record.serverId ||
                  (record.tagCode !== null &&
                    item.tagCode === record.tagCode)
              )
                ? state.records
                : [record, ...state.records],
            }));

            return (
              get().records.find(
                (item) =>
                  item.serverId === record.serverId ||
                  (record.tagCode !== null &&
                    item.tagCode === record.tagCode)
              ) ?? record
            );
          },

        /* -------------------------------------------------
         * ADD OBSERVATION
         * ------------------------------------------------ */

        addObservation:
          async (
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

            /*
             * Give every observation photo a stable UUID
             * immediately.
             */
            const photoMeta:
              Record<
                string,
                PhotoUpload
              > = {
              ...(observationData
                .photoMeta ??
                {}),
            };

            for (
              const uri of
              observationData
                .photoUris ??
              []
            ) {
              if (
                !photoMeta[
                  uri
                ]
              ) {
                photoMeta[
                  uri
                ] = {
                  id:
                    randomUUID(),

                  uploaded:
                    false,
                };
              }
            }

            const newObservation:
              ObservationVisit =
              {
                ...observationData,

                photoMeta,

                id:
                  randomUUID(),

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

            /*
             * SQLite observation first.
             */
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

            set(
              (state) => ({
                records:
                  state.records.map(
                    (
                      item
                    ) =>
                      item.id ===
                      plantRecordId
                        ? updatedRecord
                        : item
                  ),
              })
            );

            return newObservation;
          },

        /* -------------------------------------------------
         * SYNC ONE RECORD
         * ------------------------------------------------ */

        syncRecord:
          async (
            id,
            outboxRun
          ) => {
            const original =
              get().records.find(
                (item) =>
                  item.id ===
                  id
              );

            if (!original) {
              return {
                ok: false,

                reason:
                  'Record not found',
              };
            }

            if (
              !isUploadable(
                original
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

            let photosUploaded =
              0;

            let photoProblems =
              0;

            try {
              /* =========================================
               * 1. QUEUE METADATA
               * ======================================= */

              const plantMetadataStatus =
                await getPlantMetadataSyncStatus(
                  id
                );

              const queueObservationIds:
                string[] = [];

              for (
                const observation of
                original.observations
              ) {
                const status =
                  await getObservationMetadataSyncStatus(
                    observation.id
                  );

                if (
                  status ===
                    null ||
                  status ===
                    'local_only'
                ) {
                  queueObservationIds.push(
                    observation.id
                  );
                }
              }

              await persistRecordSnapshot(
                original,
                {
                  queuePlant:
                    plantMetadataStatus ===
                      null ||
                    plantMetadataStatus ===
                      'local_only',

                  queueObservationIds,
                }
              );

              /* =========================================
               * 2. RUN SQLITE OUTBOX
               * ======================================= */

              const run =
                outboxRun && plantMetadataStatus !== null &&
                  plantMetadataStatus !== 'local_only' && queueObservationIds.length === 0
                  ? outboxRun
                  : await runOutboxSync();

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
                  (
                    item
                  ) =>
                    item.id ===
                    id
                );

              if (!refreshed) {
                return {
                  ok: false,

                  reason:
                    'Record not found after syncing',
                };
              }

              /* =========================================
               * 3. CHECK METADATA RESULT
               * ======================================= */

              const plantStatus =
                await getPlantMetadataSyncStatus(
                  id
                );

              const observationStatuses =
                await Promise.all(
                  refreshed.observations.map(
                    (
                      observation
                    ) =>
                      getObservationMetadataSyncStatus(
                        observation.id
                      )
                  )
                );

              const hasConflict =
                plantStatus ===
                  'conflict' ||
                observationStatuses.some(
                  (
                    status
                  ) =>
                    status ===
                    'conflict'
                );

              const hasFailure =
                plantStatus ===
                  'failed' ||
                observationStatuses.some(
                  (
                    status
                  ) =>
                    status ===
                    'failed'
                );

              if (
                hasConflict ||
                hasFailure
              ) {
                return {
                  ok: false,

                  /*
                   * A refused tag is not a version conflict:
                   * say what is actually wrong.
                   */
                  reason:
                    refreshed.tagProblem
                      ? upperFirst(TAG_PROBLEM_REASON[refreshed.tagProblem])
                      : hasConflict
                      ? 'A newer server version exists. This record needs conflict review.'
                      : refreshed.syncError ?? 'The server rejected part of this record. Review it and try again.',

                  photosUploaded,

                  photoProblems,
                };
              }

              const metadataReady =
                plantStatus ===
                  'uploaded' &&
                observationStatuses.every(
                  (
                    status
                  ) =>
                    status ===
                    'uploaded'
                );

              if (
                !metadataReady
              ) {
                return {
                  ok: false,

                  reason:
                    refreshed.syncError ?? run.error ?? 'Some changes are still waiting to upload.',
                  retryable: run.remaining,

                  photosUploaded,

                  photoProblems,
                };
              }

              /* =========================================
               * 4. PLANT PHOTOS
               *
               * Uses our already-tested
               * plantPhotoSync service.
               * ======================================= */

              const beforePlantPhotos =
                new Map(
                  (
                    refreshed.photoEntries ??
                    []
                  ).map(
                    (
                      photo
                    ) => [
                      photo.id,

                      photo.syncStatus,
                    ]
                  )
                );

              const photoRun =
                await syncPlantPhotos(
                  refreshed
                );

              refreshed =
                mirrorPlantPhotoMeta(
                  photoRun.record
                );

              for (
                const photo of
                refreshed.photoEntries ??
                []
              ) {
                const before =
                  beforePlantPhotos.get(
                    photo.id
                  );

                if (
                  before !==
                    SyncStatus.UPLOADED &&
                  photo.syncStatus ===
                    SyncStatus.UPLOADED
                ) {
                  photosUploaded +=
                    1;
                }

                if (
                  photo.syncStatus ===
                    SyncStatus.FAILED &&
                  inferPhotoProblem(
                    photo.lastError
                  ) ===
                    'too_large'
                ) {
                  photoProblems +=
                    1;
                }
              }

              await persistRecordSnapshot(
                refreshed
              );

              set(
                (state) => ({
                  records:
                    state.records.map(
                      (
                        item
                      ) =>
                        item.id ===
                        id
                          ? refreshed!
                          : item
                    ),
                })
              );

              if (
                photoRun.error
              ) {
                if (photoRun.retryable) requestSyncRetry();
                return {
                  ok: false,

                  reason:
                    photoRun.error,
                  retryable: photoRun.retryable,

                  photosUploaded,

                  photoProblems,
                };
              }

              /* =========================================
               * 5. OBSERVATION PHOTOS
               *
               * This is teammate/main functionality.
               *
               * Photos must upload BEFORE the visit
               * is submitted for officer review.
               * ======================================= */

              const saveObservationPhotoMeta =
                async (
                  observationId:
                    string,

                  uri: string,

                  nextMeta:
                    PhotoUpload
                ) => {
                  refreshed =
                    {
                      ...refreshed!,

                      observations:
                        refreshed!.observations.map(
                          (
                            observation
                          ) =>
                            observation.id ===
                            observationId
                              ? {
                                  ...observation,

                                  photoMeta:
                                    {
                                      ...(observation.photoMeta ??
                                        {}),

                                      [uri]:
                                        nextMeta,
                                    },
                                }
                              : observation
                        ),
                    };

                  await persistRecordSnapshot(
                    refreshed
                  );

                  set(
                    (state) => ({
                      records:
                        state.records.map(
                          (
                            item
                          ) =>
                            item.id ===
                            id
                              ? refreshed!
                              : item
                        ),
                    })
                  );
                };

              for (
                const observationSnapshot of [
                  ...refreshed.observations,
                ].reverse()
              ) {
                if (
                  !observationSnapshot.serverId ||
                  !observationSnapshot
                    .photoUris
                    ?.length
                ) {
                  continue;
                }

                for (
                  const uri of
                  observationSnapshot.photoUris
                ) {
                  const currentObservation =
                    refreshed.observations.find(
                      (
                        observation
                      ) =>
                        observation.id ===
                        observationSnapshot.id
                    );

                  if (
                    !currentObservation
                  ) {
                    continue;
                  }

                  let meta =
                    currentObservation
                      .photoMeta?.[
                        uri
                      ];

                  if (!meta) {
                    meta = {
                      id:
                        randomUUID(),

                      uploaded:
                        false,
                    };

                    await saveObservationPhotoMeta(
                      currentObservation.id,
                      uri,
                      meta
                    );
                  }

                  /*
                   * "Locked" is final only once the visit is waiting
                   * for review or approved. A photo marked locked while
                   * the visit is still a draft (or sent back) is tried
                   * again (older app versions marked any refusal locked).
                   */
                  if (
                    meta.uploaded ||
                    (meta.problem ===
                      'locked' &&
                      isPhotoLockFinal(
                        currentObservation.reviewStatus
                      ))
                  ) {
                    continue;
                  }

                  const read =
                    photoFileFor(
                      uri
                    );

                  if (
                    'problem' in
                    read
                  ) {
                    const nextMeta:
                      PhotoUpload =
                      {
                        ...meta,

                        uploaded:
                          false,

                        problem:
                          read.problem,
                      };

                    await saveObservationPhotoMeta(
                      currentObservation.id,
                      uri,
                      nextMeta
                    );

                    if (
                      read.problem ===
                      'too_large'
                    ) {
                      photoProblems +=
                        1;
                    }

                    continue;
                  }

                  try {
                    /*
                     * The backend takes JPEG/PNG/WebP only: an iPhone
                     * library photo saved as HEIC is converted to a
                     * JPEG copy first (the saved original stays).
                     */
                    const uploadFile =
                      await uploadablePhotoFile(
                        read.file
                      );

                    await apiUpload(
                      `/api/observations/${currentObservation.serverId}/photo`,

                      {
                        client_photo_id:
                          meta.id,
                      },

                      uploadFile
                    );

                    await saveObservationPhotoMeta(
                      currentObservation.id,

                      uri,

                      {
                        ...meta,

                        uploaded:
                          true,

                        problem:
                          undefined,
                      }
                    );

                    photosUploaded +=
                      1;
                  } catch (error) {
                    if (
                      error instanceof
                        ApiError &&
                      error.code ===
                        'photos_locked'
                    ) {
                      await saveObservationPhotoMeta(
                        currentObservation.id,

                        uri,

                        {
                          ...meta,

                          uploaded:
                            false,

                          problem:
                            'locked',
                        }
                      );

                      continue;
                    }

                    if (
                      error instanceof
                        ApiError &&
                      error.status ===
                        413
                    ) {
                      await saveObservationPhotoMeta(
                        currentObservation.id,

                        uri,

                        {
                          ...meta,

                          uploaded:
                            false,

                          problem:
                            'too_large',
                        }
                      );

                      photoProblems +=
                        1;

                      continue;
                    }

                    throw error;
                  }
                }
              }

              /*
               * Same behaviour as main:
               * oversized evidence blocks officer submission
               * until the Botanist removes it.
               */
              if (
                photoProblems >
                0
              ) {
                /*
                 * Tell the botanist on each affected visit
                 * (Records and Home show it), so the
                 * skipped submit is never silent.
                 */
                const oversizedByVisit =
                  new Map<string, number>();
                for (const observation of refreshed.observations) {
                  const count = Object.values(
                    observation.photoMeta ?? {}
                  ).filter(
                    (meta) =>
                      !meta.uploaded &&
                      meta.problem === 'too_large'
                  ).length;
                  if (count > 0) {
                    oversizedByVisit.set(observation.id, count);
                  }
                }
                if (oversizedByVisit.size > 0) {
                  refreshed = {
                    ...refreshed,
                    observations:
                      refreshed.observations.map(
                        (observation) =>
                          oversizedByVisit.has(observation.id)
                            ? {
                                ...observation,
                                submitError:
                                  oversizedPhotoMessage(
                                    oversizedByVisit.get(observation.id)!
                                  ),
                              }
                            : observation
                      ),
                  };
                  await persistRecordSnapshot(
                    refreshed
                  );
                  set(
                    (state) => ({
                      records:
                        state.records.map(
                          (item) =>
                            item.id === id
                              ? refreshed!
                              : item
                        ),
                    })
                  );
                }

                return {
                  ok: false,

                  reason:
                    `${photoProblems} ${
                      photoProblems ===
                      1
                        ? 'photo is'
                        : 'photos are'
                    } over 5 MB and cannot be uploaded. Remove ${
                      photoProblems ===
                      1
                        ? 'it'
                        : 'them'
                    } on the plant page, then retry.`,

                  photosUploaded,

                  photoProblems,
                };
              }

              /* =========================================
               * 6. SUBMIT VISITS FOR REVIEW
               * ======================================= */

              if (
                refreshed.reviewStatus === ReviewStatus.PENDING ||
                refreshed.observations.some(
                  (observation) =>
                    observation.submissionRequested
                )
              ) {
                const submittedIds =
                  new Set<string>();

                /*
                 * Visits the server refused to send for
                 * review (4xx), with its message. They stay
                 * "Not submitted yet" and are tried again on
                 * the next sync. Network and server errors
                 * still fail the whole sync, as before.
                 */
                const refusedById =
                  new Map<string, string>();

                for (
                  const observation of [
                    ...refreshed.observations,
                  ].reverse()
                ) {
                  if (
                    !observation.serverId
                  ) {
                    continue;
                  }

                  if (
                    observation.submittedForReview
                  ) {
                    continue;
                  }

                  if (
                    observation.reviewStatus === ReviewStatus.PENDING ||
                    observation.reviewStatus === ReviewStatus.APPROVED
                  ) {
                    if (observation.submissionRequested) {
                      submittedIds.add(observation.id);
                    }
                    continue;
                  }

                  try {
                    await apiFetch(
                      `/api/observations/${observation.serverId}/submit`,
                      {
                        method:
                          'PATCH',
                      }
                    );
                  } catch (error) {
                    if (
                      error instanceof ApiError &&
                      !isRetryableStatus(error.status) &&
                      error.status !== 401
                    ) {
                      refusedById.set(
                        observation.id,
                        error.message
                      );
                      continue;
                    }
                    throw error;
                  }

                  submittedIds.add(
                    observation.id
                  );
                }

                if (
                  submittedIds.size >
                    0 ||
                  refusedById.size >
                    0
                ) {
                  refreshed =
                    {
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

                                  submissionRequested:
                                    false,

                                  submitError:
                                    null,

                                  /*
                                   * The server has it as pending now
                                   * (a refresh may have said draft).
                                   */
                                  reviewStatus:
                                    observation.reviewStatus ===
                                      ReviewStatus.DRAFT
                                      ? ReviewStatus.PENDING
                                      : observation.reviewStatus,
                                }
                              : refusedById.has(
                                    observation.id
                                  )
                                ? {
                                    ...observation,

                                    submittedForReview:
                                      false,

                                    submissionRequested:
                                      true,

                                    submitError:
                                      refusedById.get(
                                        observation.id
                                      ),
                                  }
                                : observation
                        ),
                    };

                  await persistRecordSnapshot(
                    refreshed
                  );

                  set(
                    (state) => ({
                      records:
                        state.records.map(
                          (
                            item
                          ) =>
                            item.id ===
                            id
                              ? refreshed!
                              : item
                        ),
                    })
                  );
                }
              }

              const refusal =
                refreshed.observations.find(
                  (observation) =>
                    observation.submitError &&
                    !observation.submittedForReview
                )?.submitError;

              /* =========================================
               * 7. FINAL RESULT
               * ======================================= */

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
                  (
                    item
                  ) =>
                    item.id ===
                    id
                );

              if (!refreshed) {
                return {
                  ok: false,

                  reason:
                    'Record not found after the final sync.',

                  photosUploaded,

                  photoProblems,
                };
              }

              /*
               * loadOrMigrateRecords reads plant-photo
               * status from SQLite, but main photoMeta
               * is also retained inside the snapshots.
               */
              const plantPhotosReady =
                (
                  refreshed.photoEntries ??
                  []
                ).every(
                  (
                    photo
                  ) =>
                    photo.syncStatus ===
                    SyncStatus.UPLOADED
                );

              const observationPhotosReady =
                refreshed.observations.every(
                  (
                    observation
                  ) =>
                    (
                      observation.photoUris ??
                      []
                    ).every(
                      (
                        uri
                      ) => {
                        const meta =
                          observation
                            .photoMeta?.[
                              uri
                            ];

                        return (
                          meta?.uploaded ===
                            true ||
                          meta?.problem ===
                            'locked' ||
                          meta?.problem ===
                            'missing'
                        );
                      }
                    )
                );

              const metadataCompletelyUploaded =
                refreshed.syncStatus ===
                  SyncStatus.UPLOADED &&
                refreshed.observations.every(
                  (
                    observation
                  ) =>
                    observation.syncStatus ===
                    SyncStatus.UPLOADED
                );

              const completelyUploaded =
                metadataCompletelyUploaded &&
                plantPhotosReady &&
                observationPhotosReady;

              /*
               * Everything uploaded, but the server refused
               * to send a visit for review: say so (Sync now
               * and Retry show this reason).
               */
              if (
                completelyUploaded &&
                refusal
              ) {
                return {
                  ok: false,

                  reason:
                    `Uploaded, but not sent for review: ${refusal}`,

                  photosUploaded,

                  photoProblems,
                };
              }

              if (
                completelyUploaded
              ) {
                return {
                  ok: true,

                  submittedForReview:
                    isFullySubmitted(
                      refreshed
                    ),

                  photosUploaded,

                  photoProblems,
                };
              }

              return {
                ok: false,

                reason:
                  'Some operations are still waiting to upload.',

                photosUploaded,

                photoProblems,
              };
            } catch (error) {
              const retryable = error instanceof ApiError && isRetryableStatus(error.status);
              if (retryable) requestSyncRetry();
              const reason =
                error instanceof
                  ApiError
                  ? error.message
                  : error instanceof
                        Error
                    ? error.message
                    : 'Upload failed unexpectedly. Please try again.';

              return {
                ok: false,

                reason,
                retryable,

                photosUploaded,

                photoProblems,
              };
            } finally {
              uploadsInProgress.delete(
                id
              );
            }
          },

        /* -------------------------------------------------
         * REMOVE PHOTO
         * ------------------------------------------------ */

        removePhoto:
          async (
            recordId,
            uri,
            obsId
          ) => {
            const record =
              get().records.find(
                (
                  item
                ) =>
                  item.id ===
                  recordId
              );

            if (!record) {
              return;
            }

            /*
             * OBSERVATION PHOTO
             */
            if (obsId) {
              const observation =
                record.observations.find(
                  (
                    item
                  ) =>
                    item.id ===
                    obsId
                );

              if (
                !observation ||
                observation
                  .photoMeta?.[
                    uri
                  ]?.uploaded
              ) {
                return;
              }

              const nextPhotoMeta =
                {
                  ...(observation.photoMeta ??
                    {}),
                };

              delete nextPhotoMeta[
                uri
              ];

              const updated:
                PlantRecord = {
                ...record,

                observations:
                  record.observations.map(
                    (
                      item
                    ) =>
                      item.id ===
                      obsId
                        ? {
                            ...item,

                            photoUris:
                              (
                                item.photoUris ??
                                []
                              ).filter(
                                (
                                  photoUri
                                ) =>
                                  photoUri !==
                                  uri
                              ),

                            photoMeta:
                              nextPhotoMeta,
                          }
                        : item
                  ),
              };

              await persistRecordSnapshot(
                updated
              );

              set(
                (state) => ({
                  records:
                    state.records.map(
                      (
                        item
                      ) =>
                        item.id ===
                        recordId
                          ? updated
                          : item
                    ),
                })
              );

              deleteStoredPhoto(
                uri
              );

              return;
            }

            /*
             * PLANT PHOTO
             */
            const entry =
              record.photoEntries?.find(
                (
                  photo
                ) =>
                  photo.uri ===
                  uri
              );

            const mainMeta =
              record.photoMeta?.[
                uri
              ];

            /*
             * Never delete a photo confirmed on server.
             */
            if (
              entry?.syncStatus ===
                SyncStatus.UPLOADED ||
              mainMeta?.uploaded
            ) {
              return;
            }

            const nextMeta =
              {
                ...(record.photoMeta ??
                  {}),
              };

            delete nextMeta[
              uri
            ];

            const updated:
              PlantRecord = {
              ...record,

              photoUris:
                record.photoUris.filter(
                  (
                    photoUri
                  ) =>
                    photoUri !==
                    uri
                ),

              photoEntries:
                (
                  record.photoEntries ??
                  []
                ).filter(
                  (
                    photo
                  ) =>
                    photo.uri !==
                    uri
                ),

              photoMeta:
                nextMeta,
            };

            await persistRecordSnapshot(
              updated
            );

            set(
              (state) => ({
                records:
                  state.records.map(
                    (
                      item
                    ) =>
                      item.id ===
                      recordId
                        ? updated
                        : item
                  ),
              })
            );

            deleteStoredPhoto(
              uri
            );
          },

        /* -------------------------------------------------
         * SYNC ALL
         * ------------------------------------------------ */

        syncAll:
          async () => {
            /*
             * VERY IMPORTANT:
             *
             * Run SQLite outbox FIRST.
             *
             * Deleted records are already gone from
             * records[], but their delete operation
             * still exists in the outbox.
             */
            const outboxRun = await runOutboxSync();
            let retryable = outboxRun.remaining;

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
                  (
                    record
                  ) =>
                    isUploadable(
                      record
                    ) &&
                    (
                      record.syncStatus !==
                        SyncStatus.UPLOADED ||
                      hasPendingPhotos(
                        record
                      ) ||
                      (
                        record.reviewStatus ===
                          ReviewStatus.PENDING &&
                        !isFullySubmitted(
                          record
                        )
                      ) ||
                      record.observations.some(
                        (observation) =>
                          observation.submissionRequested &&
                          !observation.submittedForReview &&
                          observation.reviewStatus !== ReviewStatus.PENDING &&
                          observation.reviewStatus !== ReviewStatus.APPROVED
                      )
                    )
                )
                .map(
                  (
                    record
                  ) =>
                    record.id
                );

            let uploaded =
              0;

            let failed =
              0;

            let skipped =
              0;

            let photosUploaded =
              0;

            let photoProblems =
              0;

            for (
              const id of
              ids
            ) {
              if (
                uploadsInProgress.has(
                  id
                )
              ) {
                skipped +=
                  1;

                continue;
              }

              const result =
                await get().syncRecord(
                  id,
                  outboxRun
                );
              retryable ||= result.retryable === true;

              if (
                result.ok
              ) {
                uploaded +=
                  1;
              } else {
                failed +=
                  1;
              }

              photosUploaded +=
                result.photosUploaded ??
                0;

              photoProblems +=
                result.photoProblems ??
                0;
            }

            /*
             * Then pick up the officer's decisions
             * (read-only).
             */
            await get().refreshReviewStatuses();

            return {
              retryable,
              uploaded,

              failed,

              skipped,

              photosUploaded,

              photoProblems,
            };
          },

        /* -------------------------------------------------
         * REVIEW RESULTS
         * ------------------------------------------------ */

        refreshReviewStatuses:
          async () => {
            /*
             * Visits the server has and the officer
             * may have reviewed.
             */
            const ids = get()
              .records.flatMap(
                (record) =>
                  record.observations
              )
              .filter(
                (observation) =>
                  /*
                   * Every visit the server has, including
                   * drafts, so the phone learns the real
                   * status (e.g. a submit that never happened).
                   */
                  Boolean(observation.serverId)
              )
              .map(
                (observation) =>
                  observation.serverId as string
              );

            if (ids.length === 0) {
              return;
            }

            type ReviewRow = {
              id: string;
              review_status: string;
              rejection_comment:
                | string
                | null;
            };

            const byServerId =
              new Map<string, ReviewRow>();

            try {
              /*
               * The route takes at most 100 IDs
               * per request.
               */
              for (
                let i = 0;
                i < ids.length;
                i += 100
              ) {
                const response =
                  await apiFetch<{
                    data: ReviewRow[];
                  }>(
                    `/api/observations/review-status?ids=${ids
                      .slice(i, i + 100)
                      .join(',')}`
                  );

                for (const row of response.data) {
                  byServerId.set(
                    row.id,
                    row
                  );
                }
              }
            } catch {
              /*
               * Offline or server error:
               * keep what the phone shows.
               */
              return;
            }

            const changedRecords:
              PlantRecord[] = [];

            /*
             * Work from the latest records: a sync may
             * have finished while the request was out.
             */
            for (const record of get().records) {
              let changed = false;

              const observations =
                record.observations.map(
                  (observation) => {
                    const row =
                      observation.serverId
                        ? byServerId.get(
                            observation.serverId
                          )
                        : undefined;

                    if (!row) {
                      return observation;
                    }

                    // Rules in src/utils/submissionState.ts (tested there).
                    const next =
                      applyServerReview(
                        observation,
                        row.review_status,
                        row.rejection_comment
                      ) as ObservationVisit;

                    if (next !== observation) {
                      changed = true;
                    }
                    return next;
                  }
                );

              if (!changed) {
                continue;
              }

              /*
               * The record's status follows its visits.
               * Drafts (never submitted on the phone) are
               * left alone, and so is a resubmission that
               * hasn't uploaded yet.
               */
              let reviewStatus =
                record.reviewStatus;

              let reviewComment =
                record.reviewComment ??
                null;

              const reviewed =
                observations.filter(
                  (observation) =>
                    observation.serverId &&
                    observation.reviewStatus &&
                    observation.reviewStatus !==
                      ReviewStatus.DRAFT
                );

              const resubmitting =
                record.reviewStatus ===
                  ReviewStatus.PENDING &&
                observations.some(
                  (observation) =>
                    observation.serverId &&
                    !observation.submittedForReview
                );

              if (
                record.reviewStatus !==
                  ReviewStatus.DRAFT &&
                !resubmitting &&
                reviewed.length > 0
              ) {
                const rejected =
                  reviewed.find(
                    (observation) =>
                      observation.reviewStatus ===
                      ReviewStatus.REJECTED
                  );

                if (rejected) {
                  reviewStatus =
                    ReviewStatus.REJECTED;

                  reviewComment =
                    rejected.reviewComment ??
                    null;
                } else if (
                  reviewed.every(
                    (observation) =>
                      observation.reviewStatus ===
                      ReviewStatus.APPROVED
                  )
                ) {
                  reviewStatus =
                    ReviewStatus.APPROVED;

                  reviewComment = null;
                } else {
                  reviewStatus =
                    ReviewStatus.PENDING;

                  reviewComment = null;
                }
              }

              changedRecords.push({
                ...record,
                observations,
                reviewStatus,
                reviewComment,
              });
            }

            if (changedRecords.length === 0) {
              return;
            }

            /*
             * SQLite first, then the UI, like every
             * other change. Nothing is queued: the
             * decision came from the server.
             */
            for (const record of changedRecords) {
              await persistRecordSnapshot(
                record
              );
            }

            const byId = new Map(
              changedRecords.map(
                (record) => [
                  record.id,
                  record,
                ]
              )
            );

            set((state) => ({
              records:
                state.records.map(
                  (record) =>
                    byId.get(record.id) ??
                    record
                ),
            }));
          },

        /* -------------------------------------------------
         * SUBMIT FOR REVIEW
         * ------------------------------------------------ */

        submitForReview:
          async (
            id
          ) => {
            const record =
              get().records.find(
                (
                  item
                ) =>
                  item.id ===
                  id
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

            /*
             * Server reviews observations.
             *
             * If the plant has no observation yet,
             * create a registration visit.
             */
            const registrationVisit =
              record.observations
                .length ===
              0
                ? buildRegistrationVisit(
                    record
                  )
                : null;

            const pendingRecord:
              PlantRecord = {
              ...record,

              reviewStatus:
                ReviewStatus.PENDING,

              syncStatus:
                SyncStatus.NOT_UPLOADED,

              observations:
                registrationVisit
                  ? [
                      registrationVisit,
                    ]
                  : record.observations,
            };

            /*
             * Persist the user's manual Submit decision
             * BEFORE network work.
             *
             * Therefore an offline submit survives:
             * - force close
             * - restart
             * - reconnect
             */
            await persistRecordSnapshot(
              pendingRecord,
              {
                queuePlant:
                  true,

                queueObservationIds:
                  pendingRecord.observations
                    .filter(
                      (
                        observation
                      ) =>
                        observation
                          .syncStatus !==
                        SyncStatus.UPLOADED
                    )
                    .map(
                      (
                        observation
                      ) =>
                        observation.id
                    ),
              }
            );

            set(
              (state) => ({
                records:
                  state.records.map(
                    (
                      item
                    ) =>
                      item.id ===
                      id
                        ? pendingRecord
                        : item
                  ),
              })
            );

            const sync =
              await get().syncRecord(
                id
              );

            return {
              ok: true,

              sync,
            };
          },

        /* -------------------------------------------------
         * DELETE RECORD
         * ------------------------------------------------ */

        deleteRecord:
          async (
            id
          ) => {
            const record =
              get().records.find(
                (
                  item
                ) =>
                  item.id ===
                  id
              );

            if (!record) {
              return {
                ok: false,

                reason:
                  'Plant record not found',
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
                  'This record is currently syncing. Try deleting it again after the upload finishes.',
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
               * Remove immediately from UI.
               */
              set(
                (state) => ({
                  records:
                    state.records.filter(
                      (
                        item
                      ) =>
                        item.id !==
                        id
                    ),
                })
              );

              /*
               * Delete plant photos from phone.
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
               * Delete observation photos from phone.
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
               * Online:
               * try remote delete immediately.
               *
               * Offline:
               * SQLite outbox keeps it until reconnect.
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

        /* -------------------------------------------------
         * TAG
         * ------------------------------------------------ */

        findByTag:
          (
            tagCode
          ) =>
            get().records.find(
              (
                record
              ) =>
                record.tagCode ===
                tagCode
            ),

        attachTag:
          async (
            recordId,
            tagCode,
            options
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
                    'a plant whose species isn\'t confirmed yet'
                  }`,
              };
            }

            const current =
              get().records.find(
                (
                  record
                ) =>
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

            const serverRowVersion =
              options?.serverRowVersion;

            /*
             * The server already saved this tag and
             * raised the plant's row_version. Take the
             * new version, so later outbox updates are
             * based on it.
             *
             * Queue an update only if the plant has other
             * unsent changes: that pending update is then
             * re-based on the new version. Otherwise there
             * is nothing to send, and queuing the same tag
             * again with the old version would come back
             * as a version conflict.
             */
            const serverHasTag =
              typeof serverRowVersion ===
                'number' &&
              serverRowVersion > 0;

            const plantMetadataStatus =
              serverHasTag
                ? await getPlantMetadataSyncStatus(
                    recordId
                  )
                : null;

            const updated:
              PlantRecord = {
              ...current,

              tagCode,

              tagProblem: null,

              ...(serverHasTag
                ? {
                    rowVersion:
                      serverRowVersion,
                  }
                : {}),
            };

            await persistRecordSnapshot(
              updated,
              {
                queuePlant:
                  !serverHasTag ||
                  (plantMetadataStatus !==
                    null &&
                    plantMetadataStatus !==
                      'uploaded'),

                /*
                 * A plant already on the server: send only the tag. The server
                 * accepts that in any review status (the plant's other fields are
                 * locked once it is submitted); any other unsent change already
                 * queued is kept in the same update.
                 */
                tagOnly:
                  Boolean(
                    current.serverId &&
                    current.rowVersion
                  ),
              }
            );

            set(
              (state) => ({
                records:
                  state.records.map(
                    (
                      record
                    ) =>
                      record.id ===
                      recordId
                        ? updated
                        : record
                  ),
              })
            );

            /*
             * Try immediately.
             * Offline reconnect auto-sync will retry.
             */
            if (
              isUploadable(
                updated
              )
            ) {
              void get().syncRecord(
                recordId
              );
            }

            return {
              ok: true,
            };
          },

        /* -------------------------------------------------
         * ROUTE
         * ------------------------------------------------ */

        saveRoute:
          (
            routeData
          ) => {
            const route:
              RecordedRoute = {
              ...routeData,

              id:
                `route-${Date.now()}`,

              createdAt:
                new Date().toISOString(),

              clientRouteId:
                randomUUID(),

              syncStatus:
                'not_uploaded',

              syncError: null,
            };

            set(
              (state) => ({
                routes: [
                  route,
                  ...state.routes,
                ],

                activeDraftRoute:
                  route,
              })
            );

            return route;
          },

        /* -------------------------------------------------
         * ROUTE UPLOAD (separate from syncAll)
         * ------------------------------------------------ */

        syncRoutes: async () => {
          if (routeSyncRunning) {
            return { uploaded: 0, failed: 0 };
          }
          routeSyncRunning = true;

          let uploaded = 0;
          let failed = 0;

          // Changes one saved route only; plant records are never touched.
          const updateRoute = (
            routeId: string,
            changes: Partial<RecordedRoute>
          ) =>
            set((state) => ({
              routes: state.routes.map((item) =>
                item.id === routeId ? { ...item, ...changes } : item
              ),
              activeDraftRoute:
                state.activeDraftRoute?.id === routeId
                  ? { ...state.activeDraftRoute, ...changes }
                  : state.activeDraftRoute,
            }));

          try {
            const pending = routesToUpload(
              get().routes,
              get().activeDraftRoute?.id ?? null,
              Date.now()
            );

            // One at a time.
            for (const route of pending) {
              const clientRouteId = route.clientRouteId || randomUUID();
              updateRoute(route.id, {
                clientRouteId,
                syncStatus: 'uploading',
                syncError: null,
              });

              try {
                // Read the route again: it may have been linked meanwhile.
                const current =
                  get().routes.find((item) => item.id === route.id) ?? route;
                const body = buildRouteUpload(
                  { ...current, clientRouteId },
                  // Option A: the plant only when it has already synced.
                  linkedPlantServerId(current, get().records)
                );
                // 201 for a new route, 200 when it was uploaded before (same id).
                const result = await apiFetch<{ data?: { id?: string } }>(
                  '/api/routes',
                  { method: 'POST', body }
                );
                updateRoute(route.id, {
                  syncStatus: 'uploaded',
                  serverId: result?.data?.id,
                  syncError: null,
                });
                uploaded += 1;
              } catch (error) {
                failed += 1;
                updateRoute(route.id, {
                  syncStatus: 'failed',
                  syncError: routeUploadProblem(error),
                });
                // Offline or signed out: the others would fail the same way; they
                // stay "Not uploaded" for the next sync.
                if (
                  error instanceof ApiError &&
                  (error.status === 0 || error.status === 401)
                ) {
                  break;
                }
              }
            }
          } finally {
            routeSyncRunning = false;
          }

          return { uploaded, failed };
        },

        linkRouteToPlant:
          async (
            routeId,
            plantId
          ) => {
            const targetRoute =
              get().routes.find(
                (route) =>
                  route.id ===
                  routeId
              );

            if (!targetRoute) {
              return;
            }

            const updatedRoutes =
              get().routes.map(
                (route) =>
                  route.id ===
                  routeId
                    ? {
                        ...route,
                        linkedPlantId:
                          plantId,
                      }
                    : route
              );

            const targetPlant =
              get().records.find(
                (item) =>
                  item.id ===
                    plantId ||
                  item.serverId ===
                    plantId
              );

            if (targetPlant) {
              const updatedPlant:
                PlantRecord = {
                ...targetPlant,

                routeLength:
                  formatRouteLength(
                    targetRoute.distanceMeters
                  ),

                walkingTime:
                  formatWalkingTime(
                    targetRoute.durationSeconds
                  ),
              };

              await persistRecordSnapshot(
                updatedPlant
              );

              set(
                (state) => ({
                  routes:
                    updatedRoutes,

                  activeDraftRoute:
                    state.activeDraftRoute
                      ?.id ===
                    routeId
                      ? null
                      : state.activeDraftRoute,

                  records:
                    state.records.map(
                      (item) =>
                        item.id ===
                        targetPlant.id
                          ? updatedPlant
                          : item
                    ),
                })
              );

              return;
            }

            set(
              (state) => ({
                routes:
                  updatedRoutes,

                activeDraftRoute:
                  state.activeDraftRoute
                    ?.id ===
                  routeId
                    ? null
                    : state.activeDraftRoute,
              })
            );
          },

        discardDraftRoute:
          () => {
            const draftId =
              get().activeDraftRoute
                ?.id;

            set(
              (state) => ({
                routes:
                  draftId
                    ? state.routes.filter(
                        (route) =>
                          route.id !==
                          draftId
                      )
                    : state.routes,

                activeDraftRoute:
                  null,
              })
            );
          },

        /* -------------------------------------------------
         * HYDRATE SQLITE
         * ------------------------------------------------ */

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

        /* -------------------------------------------------
         * CLEAR
         * ------------------------------------------------ */

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

      /* ===================================================
       * ZUSTAND PERSIST / OLD DATA MIGRATIONS
       * ================================================= */

      {
        name:
          'niah-ground-truth-store',

        storage:
          createJSONStorage(
            () =>
              AsyncStorage
          ),

        version: 10,

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
              routes?: Record<
                string,
                unknown
              >[];
              activeDraftRoute?: Record<
                string,
                unknown
              > | null;
            };

          /*
           * v1:
           * remove old fake recordId.
           */
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

                  tagCode:
                    null,
                })
              );
          }

          /*
           * v2:
           * old fake synced records become pending.
           */
          if (
            version < 2 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (
                  record
                ) => ({
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

          /*
           * v3:
           * status -> syncStatus.
           */
          if (
            version < 3 &&
            Array.isArray(
              state.records
            )
          ) {
            const toSync = (
              old: unknown
            ) =>
              old ===
                  'Synced' ||
              old ===
                  'Uploaded'
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

          /*
           * v4:
           * review status.
           */
          if (
            version < 4 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (
                  record
                ) => ({
                  ...record,

                  reviewStatus:
                    ReviewStatus.DRAFT,

                  reviewComment:
                    null,
                })
              );
          }

          /*
           * v5:
           * species ID.
           */
          if (
            version < 5 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (
                  record
                ) => ({
                  ...record,

                  speciesId:
                    null,
                })
              );
          }

          /*
           * v6:
           * observation UUIDs.
           */
          if (
            version < 6 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (
                  record
                ) => ({
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

                                  id:
                                    randomUUID(),
                                }
                              : observation
                        )
                      : [],
                })
              );
          }

          /*
           * v7:
           * createdAtIso was introduced.
           *
           * Old display dates do not contain enough
           * information to reconstruct it safely.
           */

          /*
           * v8:
           * pending review records must retry upload
           * until observations reach officer queue.
           */
          if (
            version < 8 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (
                  record
                ) =>
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

          /*
           * v9:
           * record completeness / identification.
           */
          if (
            version < 9 &&
            Array.isArray(
              state.records
            )
          ) {
            state.records =
              state.records.map(
                (
                  record
                ) => {
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
                    record.scientificName
                      .trim() !==
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

          /*
           * v10:
           * routes get an upload ID and
           * "not uploaded" (route sync). Plant
           * records are not touched.
           */
          if (
            version < 10 &&
            Array.isArray(
              state.routes
            )
          ) {
            state.routes =
              migrateRoutesToV10(
                state.routes,
                randomUUID
              );

            // Keep the route waiting on Link route in step with its copy in the list.
            const draftId =
              state.activeDraftRoute?.id;
            if (draftId) {
              state.activeDraftRoute =
                state.routes.find(
                  (route) =>
                    route.id === draftId
                ) ?? null;
            }
          }

          return state as unknown as
            RecordState;
        },
      }
    )
  );

