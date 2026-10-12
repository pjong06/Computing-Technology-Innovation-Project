import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

export enum RecordStatus {
  SYNCED = 'Synced',
  PENDING = 'Pending',
  FAILED = 'Failed',
}

export interface ObservationVisit {
  id: string;
  date: string;
  recordedBy: string;
  health: 'Healthy' | 'Stressed' | 'Damaged' | 'Dead';
  stage: 'Bud' | 'Flowering' | 'Vegetative' | 'Fruiting';
  measurement: string;
  notes: string;
  status: RecordStatus;
}

export interface PlantRecord {
  id: string; // UUID generated on the phone; stays the same after sync
  tagCode: string | null; // code of the pre-printed tag on the plant; null until one is attached
  scientificName: string;
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
  status: RecordStatus;
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
  addRecord: (record: Omit<PlantRecord, 'id' | 'tagCode' | 'createdAt' | 'observations'>) => PlantRecord;
  addObservation: (plantRecordId: string, observation: Omit<ObservationVisit, 'id' | 'status'>) => void;
  retryRecord: (id: string) => void;
  saveRoute: (route: Omit<RecordedRoute, 'id' | 'createdAt'>) => RecordedRoute;
  clearActiveDraftRoute: () => void;
  clearAllData: () => void;
}

export const useRecordStore = create<RecordState>()(
  persist(
    (set) => ({
      records: [],
      routes: [],
      activeDraftRoute: null,
      addRecord: (recordData) => {
        const newRecord: PlantRecord = {
          ...recordData,
          id: randomUUID(),
          tagCode: null, // set later from a pre-printed tag
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
                id: `obs-${Date.now()}`,
                status: RecordStatus.PENDING,
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
          records: state.records.map((r) => (r.id === id ? { ...r, status: RecordStatus.PENDING } : r)),
        }));
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
      version: 2,
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
            status: RecordStatus.PENDING,
            observations: Array.isArray(record.observations)
              ? record.observations.map((obs: Record<string, unknown>) => ({ ...obs, status: RecordStatus.PENDING }))
              : [],
          }));
        }
        return state as unknown as RecordState;
      },
    }
  )
);