import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { apiFetch, ApiError } from '../api/client';
import { useProfileStore } from './useProfileStore';
// recordMapper imports only types from this file (import type), so there is no
// runtime circular dependency between the two.
import {
  getObservationMetadataSyncStatus,
  getPlantMetadataSyncStatus,
  loadOrMigrateRecords,
  persistObservation,
  persistRecordSnapshot,
} from '../services/offlineRecordRepository';

import { syncPlantPhotos } from '../services/plantPhotoSync';
import { clearOfflineDatabase } from '../services/offlineDatabase';
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

// The officer's review (same values as review_status on the server).
export enum ReviewStatus {
  DRAFT = 'draft',       // botanist still working on it
  PENDING = 'pending',   // submitted, waiting for an officer
  APPROVED = 'approved',
  REJECTED = 'rejected', // officer sent it back with a comment
}

export type HealthStatus = 'Healthy' | 'Stressed' | 'Diseased' | 'Damaged' | 'Dead';
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
  id: string; // client_record_id used for idempotent photo retry
  uri: string;
  photoType: PlantPhotoType;
  syncStatus: SyncStatus;
  serverId?: string;
  lastError?: string;
}

export interface ObservationVisit {
  id: string; // UUID generated on the phone; sent as client_record_id
  date: string; // for display only, e.g. "22 Oct 2026 · 3:15 PM"
  // When the visit happened, as an ISO 8601 string (e.g. "2026-10-22T07:15:00.000Z").
  // This is what gets uploaded. Visits saved before store v6 don't have it.
  observedAt?: string;
  recordedBy: string;
  // Optional because the registration visit (made on submit for a record with no
  // visits) has no health or stage to report. Screens show "Not recorded" instead.
  health?: HealthStatus;
  // The first four are the older phenology stages; the rest are the growth stages
  // from the 3-step Add Observation screen. Old visits keep their values.
  stage?: LifeStage;
  measurement: string;
  // Height and stem diameter in centimetres, from the 3-step Add Observation screen.
  // Sent as height_cm / diameter_cm. Older visits only have the free-text measurement.
  heightCm?: number;
  diameterCm?: number;
  // Evidence photos for this visit, stored on the phone. Not uploaded yet: see
  // TODO(photos) in syncRecord. Cleared with every other photo on logout.
  photoUris?: string[];
  notes: string;
  syncStatus: SyncStatus;
  // The server's id for this visit (observations.id), saved after a successful upload.
  // Needed later to submit the visit for review (PATCH /api/observations/:id/submit).
  serverId?: string;
  rowVersion?: number;
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number | null;
  // True once the server has accepted this visit for officer review (it's "pending"
  // there). Visits without it are still drafts on the server.
  submittedForReview?: boolean;
}

export interface PlantRecord {
  id: string; // UUID generated on the phone; stays the same after sync
  // The server's id for this plant (plants.id), saved as soon as the plant upload
  // succeeds. Observations are uploaded with it as plant_id. If it's set, the plant
  // itself is already on the server and a retry only re-sends the observations.
  serverId?: string;
  rowVersion?: number;
  tagCode: string | null; // code of the pre-printed tag on the plant; null until one is attached
  scientificName: string;
  speciesId: string | null;
  commonName: string;
  family: string;
  height?: string;
  morphology?: string;
  description?: string;
  locationName: string;
  // Raw GPS fix. Optional because records saved before 1.2 only have the display string.
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number | null; // null when the device didn't report accuracy
  gpsCoordination: string; // formatted for display only, e.g. "3.81760° N, 113.78100° E (±5 m)"
  photoUris: string[];
  recordStatus: RecordStatus;
  identificationStatus: IdentificationStatus;
  syncStatus: SyncStatus;
  reviewStatus: ReviewStatus;
  reviewComment?: string | null; // officer's reason when rejected
  createdAt: string; // for display only, e.g. "2 Nov" (no year or time)
  // When the record was created, as an ISO 8601 string. Records saved before store v7
  // don't have it.
  createdAtIso?: string;
  conservationStatus?: 'EN' | 'VU' | 'LC' | 'CR';
  routeLength?: string;
  walkingTime?: string;
  observations: ObservationVisit[];
  photoEntries?: PlantPhotoEntry[];
}

export interface RecordedRoute {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  endGps: string;
  linkedPlantId?: string;
  createdAt: string;
}

// What syncRecord tells the screen: success, or a message it can show to the user.
// submittedForReview is true when the record is pending on the phone and every one of
// its visits is now in the officer's review queue on the server.
export type SyncResult = { ok: true; submittedForReview: boolean } | { ok: false; reason: string };

// True when a record may go to the server: a completed record with a confirmed,
// approved species. Drafts (Local only) are kept on the phone until then.
function isUploadable(record: PlantRecord): boolean {
  return (
    record.syncStatus !== SyncStatus.LOCAL_ONLY &&
    record.recordStatus === RecordStatus.COMPLETE &&
    record.identificationStatus === IdentificationStatus.IDENTIFIED &&
    !!record.speciesId
  );
}

// True when a record pending on the phone has every visit submitted on the server.
function isFullySubmitted(record: PlantRecord | undefined): boolean {
  return (
    record?.reviewStatus === ReviewStatus.PENDING &&
    record.observations.length > 0 &&
    record.observations.every((obs) => obs.submittedForReview)
  );
}

// What syncAll tells the screen: how many records went up, how many didn't, and how
// many it left alone because they were already uploading (e.g. Retry was tapped first).
export interface SyncAllResult {
  uploaded: number;
  failed: number;
  skipped: number;
}

// What submitForReview tells the screen. ok: false means the record was NOT submitted
// (it stays as it was). ok: true means it is now pending on this phone; `sync` then says
// whether the upload that followed worked, so the screen can warn if it didn't.
export type SubmitResult = { ok: true; sync: SyncResult } | { ok: false; reason: string };

// Server responses we read. Both routes return the saved row, also when it was
// already saved by an earlier attempt (200 instead of 201).
interface PlantUploadResponse {
  plant: { id: string };
}
interface ObservationUploadResponse {
  observation: { id: string };
}

// IDs of records currently uploading. Stops "Sync now" and "Retry" from uploading
// the same record twice at the same time. (The server would not create a duplicate
// anyway, thanks to client_record_id, but it saves needless requests.)
const uploadsInProgress = new Set<string>();

// The visit added on submit to a record that has none, so the officer has something
// to review. Only real data from the record goes in: health and stage are left out
// because registering a plant doesn't record them.
function buildRegistrationVisit(record: PlantRecord): ObservationVisit {
  // Old records (before store v7) only have the "2 Nov" display date. Then observedAt
  // is left out and the server uses the upload time instead.
  const created = record.createdAtIso ? new Date(record.createdAtIso) : null;
  const me = useProfileStore.getState().me;
  return {
    id: randomUUID(),
    // Same display format as add-observation.tsx.
    date: created
      ? `${created.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
      : record.createdAt,
    observedAt: record.createdAtIso,
    // Same fallback as add-observation.tsx. Display only: the server records the
    // signed-in user itself.
    recordedBy: me?.full_name || me?.email || 'Field Staff',
    // The height entered when registering, in the same "0.4 m" form as other visits.
    measurement: record.height ? `${record.height} m` : 'Not recorded',
    notes: record.description?.trim() || 'Registration visit (added on submit).',
    syncStatus: SyncStatus.NOT_UPLOADED,
  };
}

interface RecordState {
  records: PlantRecord[];
  routes: RecordedRoute[];
  activeDraftRoute: RecordedRoute | null;
  addRecord: (
    record: Omit<
      PlantRecord,
      'id' | 'tagCode' | 'createdAt' | 'createdAtIso' | 'observations' | 'reviewStatus' | 'reviewComment'
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
  // observedAt is required for new visits (it's only optional on the type for old ones).
  addObservation: (
    plantRecordId: string,
    observation: Omit<ObservationVisit, 'id' | 'syncStatus' | 'observedAt'> & { observedAt: string }
  ) => Promise<ObservationVisit | null>;
  syncRecord: (id: string) => Promise<SyncResult>;
  syncAll: () => Promise<SyncAllResult>;
  submitForReview: (id: string) => Promise<SubmitResult>;
  findByTag: (tagCode: string) => PlantRecord | undefined;
  attachTag: (recordId: string, tagCode: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  hydrateOfflineRecords: () => Promise<void>;
  saveRoute: (route: Omit<RecordedRoute, 'id' | 'createdAt'>) => RecordedRoute;
  clearActiveDraftRoute: () => void;
  clearAllData: () => Promise<void>;
}

export const useRecordStore = create<RecordState>()(
  persist(
    (set, get) => ({
      records: [],
      routes: [],
      activeDraftRoute: null,
      addRecord: async (recordData) => {
        const now = new Date();
        const newRecord: PlantRecord = {
          ...recordData,
          id: randomUUID(),
          tagCode: null, // set later from a pre-printed tag
          reviewStatus: ReviewStatus.DRAFT,
          reviewComment: null,
          createdAt: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          createdAtIso: now.toISOString(), // same moment, machine-readable
          observations: [],
        };
        await persistRecordSnapshot(newRecord, { queuePlant: true });
        set((state) => ({ records: [newRecord, ...state.records] }));
        return newRecord;
      },
      updateRecord: async (id, updates) => {
        const current = get().records.find((record) => record.id === id);
        if (!current) return null;
        if (current.reviewStatus !== ReviewStatus.DRAFT && current.reviewStatus !== ReviewStatus.REJECTED) {
          return null;
        }

        const updated = { ...current, ...updates };
        await persistRecordSnapshot(updated, {
          queuePlant: true,
          queueObservationIds: updated.observations
            .filter((observation) => observation.syncStatus !== SyncStatus.UPLOADED)
            .map((observation) => observation.id),
        });
        set((state) => ({
          records: state.records.map((record) => (record.id === id ? updated : record)),
        }));
        return updated;
      },
      addObservation: async (plantRecordId, observationData) => {
        const record = get().records.find((item) => item.id === plantRecordId);
        if (!record) return null;

        const newObs: ObservationVisit = {
          ...observationData,
          id: randomUUID(),
          syncStatus: SyncStatus.NOT_UPLOADED,
        };
        const updatedRecord: PlantRecord = {
          ...record,
          observations: [newObs, ...record.observations],
          syncStatus:
            record.syncStatus === SyncStatus.UPLOADED
              ? SyncStatus.NOT_UPLOADED
              : record.syncStatus,
        };

        await persistObservation(updatedRecord, newObs, isUploadable(updatedRecord));
        await persistRecordSnapshot(updatedRecord);
        set((state) => ({
          records: state.records.map((item) =>
            item.id === plantRecordId ? updatedRecord : item
          ),
        }));
        return newObs;
      },

      // Synchronizes one record through the durable SQLite outbox. The same
      // operation IDs are reused after an interrupted request, so the backend
      // can safely return the earlier result instead of creating duplicates.
      syncRecord: async (id) => {
  const record = get().records.find(
    (item) => item.id === id
  );

  if (!record) {
    return {
      ok: false,
      reason: 'Record not found',
    };
  }

  if (!isUploadable(record)) {
    return {
      ok: false,
      reason:
        'Confirm an approved species and complete this draft before uploading it.',
    };
  }

  if (uploadsInProgress.has(id)) {
    return {
      ok: false,
      reason:
        'This record is already uploading',
    };
  }

  uploadsInProgress.add(id);

  try {
    /*
     * Metadata operations are already queued when the record
     * is created/edited. Only create a missing operation here,
     * instead of creating a duplicate because a PHOTO is pending.
     */
    const plantMetadataStatus =
      await getPlantMetadataSyncStatus(id);

    const queueObservationIds: string[] =
      [];

    for (const observation of record.observations) {
      const status =
        await getObservationMetadataSyncStatus(
          observation.id
        );

      if (
        status === null ||
        status === 'local_only'
      ) {
        queueObservationIds.push(
          observation.id
        );
      }
    }

    await persistRecordSnapshot(record, {
      queuePlant:
        plantMetadataStatus === null ||
        plantMetadataStatus ===
          'local_only',
      queueObservationIds,
    });

    /*
     * STEP 1:
     * Push plant + observation metadata.
     */
    const run =
      await runOutboxSync();

    let refreshedRecords =
      await loadOrMigrateRecords(
        get().records
      );

    set({
      records: refreshedRecords,
    });

    let refreshed =
      refreshedRecords.find(
        (item) => item.id === id
      );

    if (!refreshed) {
      return {
        ok: false,
        reason:
          'Record not found after synchronization',
      };
    }

    // Network/server could not complete metadata.
    if (run.error) {
      return {
        ok: false,
        reason: run.error,
      };
    }

    /*
     * Check THIS record's metadata status.
     * runOutboxSync may also have processed operations
     * belonging to other records.
     */
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
      plantStatus === 'conflict' ||
      observationStatuses.some(
        (status) =>
          status === 'conflict'
      );

    const hasFailure =
      plantStatus === 'failed' ||
      observationStatuses.some(
        (status) =>
          status === 'failed'
      );

    if (hasConflict || hasFailure) {
      return {
        ok: false,
        reason: hasConflict
          ? 'A newer server version exists. This record needs conflict review.'
          : 'The server rejected part of this record. Review it and try again.',
      };
    }

    const metadataReady =
      plantStatus === 'uploaded' &&
      observationStatuses.every(
        (status) =>
          status === 'uploaded'
      );

    if (!metadataReady) {
      return {
        ok: false,
        reason:
          'Some metadata operations are still waiting to upload.',
      };
    }

    /*
     * STEP 2:
     * Metadata exists on the server, so plant photos can now
     * safely reference the server plant ID.
     */
    const photoRun =
      await syncPlantPhotos(
        refreshed
      );

    refreshed = photoRun.record;

    await persistRecordSnapshot(
      refreshed
    );

    set((state) => ({
      records: state.records.map(
        (item) =>
          item.id === id
            ? refreshed!
            : item
      ),
    }));

    /*
     * Re-read from SQLite so aggregate syncStatus now includes
     * metadata + observations + photos.
     */
    refreshedRecords =
      await loadOrMigrateRecords(
        get().records
      );

    set({
      records: refreshedRecords,
    });

    refreshed =
      refreshedRecords.find(
        (item) => item.id === id
      );

    if (!refreshed) {
      return {
        ok: false,
        reason:
          'Record not found after photo synchronization',
      };
    }

    if (photoRun.error) {
      return {
        ok: false,
        reason: photoRun.error,
      };
    }

    /*
     * STEP 3:
     * Review submission is a MANUAL Botanist decision.
     *
     * This block only runs if the Botanist previously pressed
     * Submit for Review and reviewStatus is already PENDING.
     *
     * Therefore reconnect may deliver a queued submission,
     * but it never submits a draft by itself.
     */
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
            method: 'PATCH',
          }
        );

        submittedIds.add(
          observation.id
        );
      }

      if (
        submittedIds.size > 0
      ) {
        refreshed = {
          ...refreshed,
          observations:
            refreshed.observations.map(
              (observation) =>
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
                item.id === id
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
      error instanceof ApiError
        ? error.message
        : 'Upload failed unexpectedly. Please try again.';

    return {
      ok: false,
      reason,
    };
  } finally {
    uploadsInProgress.delete(id);
  }
},

      // Uploads every record that isn't fully on the server yet (Not uploaded AND
      // Upload failed, so "Sync now" also retries failures). One record at a time, so
      // a weak field connection isn't flooded with parallel requests. Like syncRecord,
      // it never throws: a failed record just counts as failed and the loop moves on.
      syncAll: async () => {
        // Take the list of IDs up front. Records added while this runs wait for the
        // next sync, so the loop always ends.
        // Unfinished drafts (Local only) are left out: they aren't failures, they just
        // can't be uploaded until the botanist confirms a species.
        const ids = get()
          .records.filter((r) => r.syncStatus !== SyncStatus.UPLOADED && isUploadable(r))
          .map((r) => r.id);

        let uploaded = 0;
        let failed = 0;
        let skipped = 0;
        for (const id of ids) {
          // Already uploading (from Retry or a submit)? That upload will finish on its
          // own, so don't count it as a failure. Checking here is safe: syncRecord adds
          // the ID to uploadsInProgress before its first await, so nothing can slip in
          // between this check and the call.
          if (uploadsInProgress.has(id)) {
            skipped += 1;
            continue;
          }
          const result = await get().syncRecord(id);
          if (result.ok) uploaded += 1;
          else failed += 1;
        }
        return { uploaded, failed, skipped };
      },

      submitForReview: async (id) => {
        const record = get().records.find((r) => r.id === id);
        if (!record) return { ok: false, reason: 'Record not found' };
        if (record.reviewStatus !== ReviewStatus.DRAFT && record.reviewStatus !== ReviewStatus.REJECTED) {
          return { ok: false, reason: 'This record has already been submitted' };
        }
        if (!isUploadable(record)) {
          return { ok: false, reason: 'Confirm an approved species and complete this draft before submitting it.' };
        }
        // The backend reviews visits, not plants, so a record with no visits would give
        // the officer nothing to review. Add a registration visit built from the record.
        const registrationVisit = record.observations.length === 0 ? buildRegistrationVisit(record) : null;

        // The submission has to reach the server, so it also needs uploading again.
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id
              ? {
                  ...r,
                  reviewStatus: ReviewStatus.PENDING,
                  syncStatus: SyncStatus.NOT_UPLOADED,
                  observations: registrationVisit ? [registrationVisit] : r.observations,
                }
              : r
          ),
        }));
        // Upload straight away. The record is already pending on the phone, so if the
        // upload fails (e.g. no signal in the field) the submission is kept and goes up
        // later with "Sync now" or Retry; syncRecord marks it FAILED and never throws.
        const sync = await get().syncRecord(id);
        return { ok: true, sync };
      },

      findByTag: (tagCode) => get().records.find((r) => r.tagCode === tagCode),
      attachTag: async (recordId, tagCode) => {
        // 1. Is this tag already on ANOTHER record?
        const existing = get().findByTag(tagCode);
        if (existing && existing.id !== recordId ) {
          return {
            ok: false,
            reason: `This tag is already attached to ${existing.scientificName || 'an identification-pending record'}`,
          };
        } 

        // 2. Update only the record with this recordId (same map-and-replace pattern as the other actions)
        const current = get().records.find((record) => record.id === recordId);
        if (!current) return { ok: false, reason: 'Plant record not found' };
        const updated = { ...current, tagCode };
        await persistRecordSnapshot(updated, { queuePlant: true });
        set((state) => ({
          records: state.records.map((r) => (r.id === recordId ? updated : r)),
        }));

        // 3. Tell the screen it worked
        return { ok: true };
      },      
      saveRoute: (routeData) => {
        const route: RecordedRoute = {
          ...routeData,
          id: `route-${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          routes: [route, ...state.routes],
          activeDraftRoute: route,
        }));
        return route;
      },
      hydrateOfflineRecords: async () => {
        const records = await loadOrMigrateRecords(get().records);
        set({ records });
      },
      clearActiveDraftRoute: () => set({ activeDraftRoute: null }),
      clearAllData: async () => {
        await clearOfflineDatabase();
        set({ records: [], routes: [], activeDraftRoute: null });
      },
    }),
    {
      name: 'niah-ground-truth-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 9,
      migrate: (persistedState, version) => {
        const state = persistedState as { records?: Record<string, unknown>[] };
        if (version < 1 && Array.isArray(state.records)) {
          // v0 records carried a random "NP-2026-xxxx" recordId that was never on a
          // physical tag. Drop it; those records simply have no tag attached.
          state.records = state.records.map(({ recordId: _discarded, ...record }) => ({ ...record, tagCode: null }));
        }
        if (version < 2 && Array.isArray(state.records)) {
          // Before v2 a fake "Sync" button marked records (and observations) as Synced
          // without uploading anything. Nothing has ever reached a server, so every
          // record goes back to Pending.
          state.records = state.records.map((record) => ({
            ...record,
            status: SyncStatus.NOT_UPLOADED,
            observations: Array.isArray(record.observations)
              ? record.observations.map((obs: Record<string, unknown>) => ({ ...obs, status: SyncStatus.NOT_UPLOADED }))
              : [],
          }));
        }

          if (version < 3 && Array.isArray(state.records)) {
          // v3: "status" (Synced/Pending/Failed) became "syncStatus", so the phone's
          // upload state isn't confused with the officer's review status.
          const toSync = (old: unknown) =>
            old === 'Synced' || old === 'Uploaded'
              ? SyncStatus.UPLOADED
              : old === 'Failed' || old === 'Upload failed'
                ? SyncStatus.FAILED
                : SyncStatus.NOT_UPLOADED;
          state.records = state.records.map(({ status, ...record }) => ({
            ...record,
            syncStatus: toSync(status),
            observations: Array.isArray(record.observations)
              ? record.observations.map(({ status: obsStatus, ...obs }: Record<string, unknown>) => ({
                  ...obs,
                  syncStatus: toSync(obsStatus),
                }))
              : [],
          }));
        }

        if (version < 4 && Array.isArray(state.records)) {
          // v4: records get a review status. Nothing has been submitted yet,
          // so every existing record starts as a draft.
          state.records = state.records.map((record) => ({
            ...record,
            reviewStatus: ReviewStatus.DRAFT,
            reviewComment: null,
          }));
        }

                if (version < 5 && Array.isArray(state.records)) {
          // v5: records link to a species by ID. Older records only have a name.
          state.records = state.records.map((record) => ({ ...record, speciesId: null }));
        }

        if (version < 6 && Array.isArray(state.records)) {
          // v6: observation IDs must be UUIDs, because the backend uses them as
          // client_record_id and rejects anything else. Visits saved before v6 had
          // IDs like "obs-1761118500000", so each of those gets a fresh UUID.
          // (These old visits also have no observedAt, only the display "date"
          // text, so they upload without observed_at and the server uses the
          // upload time instead.)
          state.records = state.records.map((record) => ({
            ...record,
            observations: Array.isArray(record.observations)
              ? record.observations.map((obs: Record<string, unknown>) =>
                  typeof obs.id === 'string' && obs.id.startsWith('obs-') ? { ...obs, id: randomUUID() } : obs
                )
              : [],
          }));
        }

        // v7: new records get createdAtIso. Nothing to convert: older records only have
        // the "2 Nov" display date, which has no year or time to rebuild it from, so they
        // simply go without it.

        if (version < 8 && Array.isArray(state.records)) {
          // v8: syncRecord now also submits visits for review. A record submitted before
          // this could already be marked Uploaded without its visits ever reaching the
          // officer queue, and syncRecord skips Uploaded records. Mark those as Not
          // uploaded so the next sync submits them (the plant and visits aren't sent again).
          state.records = state.records.map((record) =>
            record.reviewStatus === ReviewStatus.PENDING && record.syncStatus === SyncStatus.UPLOADED
              ? { ...record, syncStatus: SyncStatus.NOT_UPLOADED }
              : record
          );
        }

        if (version < 9 && Array.isArray(state.records)) {
          // v9 (was "v6" on main): separates record completeness, identification and
          // upload state. Main and this branch both used the number 6 for different
          // migrations, so this one moved to 9. A phone that already ran main's v6 has
          // these fields, and they are kept as they are; only records without them are
          // filled in. Existing named records remain complete even if they predate
          // species IDs.
          state.records = state.records.map((record) => {
            if (record.recordStatus !== undefined && record.identificationStatus !== undefined) return record;
            const hasName = typeof record.scientificName === 'string' && record.scientificName.trim() !== '';
            return {
              ...record,
              recordStatus: hasName ? RecordStatus.COMPLETE : RecordStatus.DRAFT,
              identificationStatus: hasName
                ? IdentificationStatus.IDENTIFIED
                : IdentificationStatus.PENDING,
              syncStatus: hasName ? record.syncStatus : SyncStatus.LOCAL_ONLY,
            };
          });
        }

        return state as unknown as RecordState;
      },
    }
  )
);
