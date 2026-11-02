import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { apiFetch, ApiError } from '../api/client';
import { useProfileStore } from './useProfileStore';
// recordMapper imports only types from this file (import type), so there is no
// runtime circular dependency between the two.
import { mapLocalRecordToBackend, mapLocalObservationToBackend } from '../services/recordMapper';

export enum SyncStatus {
  UPLOADED = 'Uploaded',
  NOT_UPLOADED = 'Not uploaded',
  FAILED = 'Upload failed',
}

// The officer's review (same values as review_status on the server).
export enum ReviewStatus {
  DRAFT = 'draft',       // botanist still working on it
  PENDING = 'pending',   // submitted, waiting for an officer
  APPROVED = 'approved',
  REJECTED = 'rejected', // officer sent it back with a comment
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
  health?: 'Healthy' | 'Stressed' | 'Damaged' | 'Dead';
  stage?: 'Bud' | 'Flowering' | 'Vegetative' | 'Fruiting';
  measurement: string;
  notes: string;
  syncStatus: SyncStatus;
  // The server's id for this visit (observations.id), saved after a successful upload.
  // Needed later to submit the visit for review (PATCH /api/observations/:id/submit).
  serverId?: string;
}

export interface PlantRecord {
  id: string; // UUID generated on the phone; stays the same after sync
  // The server's id for this plant (plants.id), saved as soon as the plant upload
  // succeeds. Observations are uploaded with it as plant_id. If it's set, the plant
  // itself is already on the server and a retry only re-sends the observations.
  serverId?: string;
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
export type SyncResult = { ok: true } | { ok: false; reason: string };

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
  ) => PlantRecord;
  // observedAt is required for new visits (it's only optional on the type for old ones).
  addObservation: (
    plantRecordId: string,
    observation: Omit<ObservationVisit, 'id' | 'syncStatus' | 'observedAt'> & { observedAt: string }
  ) => void;
  syncRecord: (id: string) => Promise<SyncResult>;
  syncAll: () => Promise<SyncAllResult>;
  submitForReview: (id: string) => Promise<SubmitResult>;
  findByTag: (tagCode: string) => PlantRecord | undefined;
  attachTag: (recordId: string, tagCode: string) => { ok: true } | { ok: false; reason: string };
  saveRoute: (route: Omit<RecordedRoute, 'id' | 'createdAt'>) => RecordedRoute;
  clearActiveDraftRoute: () => void;
  clearAllData: () => void;
}

export const useRecordStore = create<RecordState>()(
  persist(
    (set, get) => ({
      records: [],
      routes: [],
      activeDraftRoute: null,
      addRecord: (recordData) => {
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
        set((state) => ({ records: [newRecord, ...state.records] }));
        return newRecord;
      },
      addObservation: (plantRecordId, observationData) => {
        set((state) => ({
          records: state.records.map((r) => {
            if (r.id === plantRecordId) {
              const newObs: ObservationVisit = {
                ...observationData,
                // A real UUID: the backend rejects anything else as client_record_id.
                id: randomUUID(),
                syncStatus: SyncStatus.NOT_UPLOADED,
              };
              return {
                ...r,
                observations: [newObs, ...r.observations],
                // A record that was fully uploaded now has a visit the server hasn't
                // seen, so it needs uploading again (syncRecord skips UPLOADED records).
                syncStatus: r.syncStatus === SyncStatus.UPLOADED ? SyncStatus.NOT_UPLOADED : r.syncStatus,
              };
            }
            return r;
          }),
        }));
      },

      // Uploads one record (the plant, then its visits) to the backend.
      // This is the ONLY place that may mark a record UPLOADED: it happens only after
      // the server has confirmed every part. It never throws; the screen gets a
      // SyncResult it can show in a message.
      syncRecord: async (id) => {
        const record = get().records.find((r) => r.id === id);
        if (!record) return { ok: false, reason: 'Record not found' };
        if (record.syncStatus === SyncStatus.UPLOADED) return { ok: true }; // nothing new to send
        if (uploadsInProgress.has(id)) return { ok: false, reason: 'This record is already uploading' };

        // Small helpers that change just this record (or one of its visits) in the store.
        // They always start from the latest state, because uploads take time and the
        // user may have changed something meanwhile.
        const updateRecord = (changes: Partial<PlantRecord>) =>
          set((state) => ({
            records: state.records.map((r) => (r.id === id ? { ...r, ...changes } : r)),
          }));
        const updateObservation = (obsId: string, changes: Partial<ObservationVisit>) =>
          set((state) => ({
            records: state.records.map((r) =>
              r.id === id
                ? { ...r, observations: r.observations.map((o) => (o.id === obsId ? { ...o, ...changes } : o)) }
                : r
            ),
          }));

        uploadsInProgress.add(id);
        try {
          // 1. The plant. Skipped if an earlier attempt already got it onto the server.
          let serverId = record.serverId;
          if (!serverId) {
            const response = await apiFetch<PlantUploadResponse>('/api/plants', {
              method: 'POST',
              body: mapLocalRecordToBackend(record),
            });
            serverId = response.plant.id;
            // Save it straight away. If a visit fails below, the next retry sees serverId
            // and only re-sends the visits instead of the plant.
            updateRecord({ serverId });
          }

          // TODO(photos): upload the record's photos here, once the teammate has fixed
          // POST /api/plants/:id/photo on the backend. Use serverId in the URL, send each
          // file in photoUris (resolve them with resolveStoredPhotoUri first), and only
          // continue to the visits when every photo is on the server.

          // 2. The visits, one at a time, oldest first so they arrive in the order they
          //    happened (the list is stored newest first). Read them fresh from the store
          //    in case one was added while the plant was uploading.
          const latest = get().records.find((r) => r.id === id);
          const visitsToSend = [...(latest?.observations ?? [])]
            .reverse()
            .filter((obs) => obs.syncStatus !== SyncStatus.UPLOADED);

          for (const obs of visitsToSend) {
            const response = await apiFetch<ObservationUploadResponse>('/api/observations', {
              method: 'POST',
              body: mapLocalObservationToBackend(serverId, obs),
            });
            // Mark each visit as soon as the server confirms it, so a later failure
            // doesn't make us send this one again.
            updateObservation(obs.id, { syncStatus: SyncStatus.UPLOADED, serverId: response.observation.id });
          }

          // TODO(submit): once Gerald restores PATCH /api/observations/:id/submit (removed
          // from main in 4efe9c5), submit the visits here. If this record is PENDING on the
          // phone, call the route for every visit that has a serverId and is still a draft
          // on the server, and treat "already pending" (200) as success. Doing it here,
          // not in submitForReview, means a submit whose upload failed still reaches the
          // officer queue later via Retry or "Sync now". Throw on any other error so the
          // record is marked FAILED like an upload failure. Also extend SyncResult (or
          // SubmitResult) with a flag so plant-detail can say "Submitted to officer review".

          // 3. Mark the record UPLOADED, but only if nothing new appeared meanwhile. A visit
          //    added while we were uploading wasn't in visitsToSend; leaving the record
          //    NOT_UPLOADED means the next sync picks it up instead of skipping it forever.
          const unsentLeft = get()
            .records.find((r) => r.id === id)
            ?.observations.some((obs) => obs.syncStatus !== SyncStatus.UPLOADED);
          updateRecord({ syncStatus: unsentLeft ? SyncStatus.NOT_UPLOADED : SyncStatus.UPLOADED });
          return { ok: true };
        } catch (error) {
          // Whatever went wrong, the record stays on the phone and shows Retry.
          updateRecord({ syncStatus: SyncStatus.FAILED });

          if (error instanceof ApiError) {
            // apiFetch already wrote a readable message: "Could not reach the server..."
            // when status is 0 (no signal, timeout), otherwise the server's own message,
            // e.g. "Valid latitude and longitude are required".
            return { ok: false, reason: error.message };
          }
          // Not an ApiError (e.g. an unexpected response shape): still don't crash the screen.
          return { ok: false, reason: 'Upload failed unexpectedly. Please try again.' };
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
        const ids = get()
          .records.filter((r) => r.syncStatus !== SyncStatus.UPLOADED)
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
      attachTag: (recordId, tagCode) => {
        // 1. Is this tag already on ANOTHER record?
        const existing = get().findByTag(tagCode);
        if (existing && existing.id !== recordId ) {
          return { ok: false, reason: `This tag is already attached to ${existing.scientificName}` };
        } 

        // 2. Update only the record with this recordId (same map-and-replace pattern as the other actions)
        set((state) => ({
          records: state.records.map((r) => (r.id === recordId ? { ...r, tagCode: tagCode } : r)),
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
      clearActiveDraftRoute: () => set({ activeDraftRoute: null }),
      clearAllData: () => set({ records: [], routes: [], activeDraftRoute: null }),
    }),
    {
      name: 'niah-ground-truth-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 7,
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

        return state as unknown as RecordState;
      },
    }
  )
);
