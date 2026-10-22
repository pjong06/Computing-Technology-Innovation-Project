import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

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

// Shown and saved as the name when the botanist doesn't know the species.
// The officer assigns the real species during review.
export const UNKNOWN_SPECIES = 'Unknown species';

export interface ObservationVisit {
  id: string; // UUID generated on the phone; sent as client_record_id
  date: string; // for display only, e.g. "22 Oct 2026 · 3:15 PM"
  // When the visit happened, as an ISO 8601 string (e.g. "2026-10-22T07:15:00.000Z").
  // This is what gets uploaded. Visits saved before store v6 don't have it.
  observedAt?: string;
  recordedBy: string;
  health: 'Healthy' | 'Stressed' | 'Damaged' | 'Dead';
  stage: 'Bud' | 'Flowering' | 'Vegetative' | 'Fruiting';
  measurement: string;
  notes: string;
  syncStatus: SyncStatus;
}

export interface PlantRecord {
  id: string; // UUID generated on the phone; stays the same after sync
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
  createdAt: string;
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

interface RecordState {
  records: PlantRecord[];
  routes: RecordedRoute[];
  activeDraftRoute: RecordedRoute | null;
  addRecord: (
    record: Omit<PlantRecord, 'id' | 'tagCode' | 'createdAt' | 'observations' | 'reviewStatus' | 'reviewComment'>
  ) => PlantRecord;
  // observedAt is required for new visits (it's only optional on the type for old ones).
  addObservation: (
    plantRecordId: string,
    observation: Omit<ObservationVisit, 'id' | 'syncStatus' | 'observedAt'> & { observedAt: string }
  ) => void;
  retryRecord: (id: string) => void;
  submitForReview: (id: string) => { ok: true } | { ok: false; reason: string };
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
        const newRecord: PlantRecord = {
          ...recordData,
          id: randomUUID(),
          tagCode: null, // set later from a pre-printed tag
          reviewStatus: ReviewStatus.DRAFT,
          reviewComment: null,
          createdAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
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
              return { ...r, observations: [newObs, ...r.observations] };
            }
            return r;
          }),
        }));
      },
      // There is deliberately no action that marks records Synced: only a real upload
      // to the server (not built yet) may set that status.
      retryRecord: (id) => {
        set((state) => ({
          records: state.records.map((r) => (r.id === id ? { ...r, syncStatus: SyncStatus.NOT_UPLOADED } : r)),
        }));
      },

      submitForReview: (id) => {
        const record = get().records.find((r) => r.id === id);
        if (!record) return { ok: false, reason: 'Record not found' };
        if (record.reviewStatus !== ReviewStatus.DRAFT && record.reviewStatus !== ReviewStatus.REJECTED) {
          return { ok: false, reason: 'This record has already been submitted' };
        }
        // The submission has to reach the server, so it also needs uploading again.
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id
              ? { ...r, reviewStatus: ReviewStatus.PENDING, syncStatus: SyncStatus.NOT_UPLOADED }
              : r
          ),
        }));
        return { ok: true };
      },

      findByTag: (tagCode) => get().records.find((r) => r.tagCode === tagCode),
      attachTag: (recordId, tagCode) => {
        // 1. Is this tag already on ANOTHER record?
        const existing = get().findByTag(tagCode);
        if (existing && existing.id !== recordId ) {
          return { ok: false, reason: `This tag is already attached to ${existing.scientificName}` };
        } 

        // 2. Update only the record with this recordId (copy retryRecord's pattern)
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
      version: 6,
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

        return state as unknown as RecordState;
      },
    }
  )
);