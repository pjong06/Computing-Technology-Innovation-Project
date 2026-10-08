import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export enum RecordStatus {
  PENDING = 'Pending',
  SYNCED = 'Synced',
  FAILED = 'Failed',
}

export interface PlantRecord {
  id: string;
  recordId: string;
  scientificName: string;
  commonName: string;
  family: string;
  height?: string;
  morphology?: string;
  notes?: string;
  locationName: string;
  gpsCoordination: string;
  photoUri?: string;
  status: RecordStatus;
  createdAt: string;
}

interface RecordState {
  records: PlantRecord[];
  addRecord: (record: Omit<PlantRecord, 'id' | 'createdAt'>) => void;
  syncPending: () => void;
  clearRecords: () => void;
}

export const useRecordStore = create<RecordState>()(
  persist(
    (set) => ({
      records: [],
      addRecord: (record) =>
        set((state) => {
          const newEntry: PlantRecord = {
            ...record,
            id: Date.now().toString(),
            createdAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          };
          return { records: [newEntry, ...state.records] };
        }),
      syncPending: () =>
        set((state) => ({
          records: state.records.map((r) =>
            r.status === RecordStatus.PENDING ? { ...r, status: RecordStatus.SYNCED } : r
          ),
        })),
      clearRecords: () => set({ records: [] }),
    }),
    {
      name: 'niah-biotrack-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);