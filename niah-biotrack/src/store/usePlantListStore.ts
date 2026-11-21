import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPlantList, type OtherApprovedPlant } from '../services/approvedPlants';
import { useRecordStore } from './useRecordStore';
import type { SignedThumbnail } from '../utils/thumbnailSources';
import type { ServerPlantDetails } from '../utils/plantDetails';
import { parseSavedPositions, positionsFromList, type SavedPlantPosition } from '../utils/savedPlantPositions';

// Where the listed plants' coordinates are kept on the phone (savedPlantPositions.ts).
const SAVED_POSITIONS_KEY = 'niah-listed-plant-positions';

// The server plant list shared by the Plants tab, Home's Recent activity and plant detail:
// other botanists' approved plants and the signed thumbnails of the botanist's own plants.
// Loaded with one request per page (GET /api/plants), never one per plant, and kept in memory.

interface PlantListState {
  others: OtherApprovedPlant[];
  ownThumbnails: Record<string, SignedThumbnail>;
  // "This plant" server details of approved plants, by server id.
  detailsById: Record<string, ServerPlantDetails>;
  state: 'idle' | 'loading' | 'ok' | 'offline';
  loadedAt: number | null;
  // Set when the list was reloaded because a signed thumbnail had expired, so that happens
  // only once per load; cleared by the next normal load.
  refreshedForExpiry: boolean;
  // Coordinates of the others' listed plants, saved on the phone so "Find plant" has them
  // offline. Replaced on every successful load; read back with loadSavedPositions.
  savedPositions: SavedPlantPosition[];
  loadSavedPositions: () => Promise<void>;
  load: (options?: { force?: boolean }) => Promise<void>;
  refreshExpiredThumbnails: () => Promise<void>;
}

// A list loaded this recently is reused (Home and the Plants tab both ask on focus).
const FRESH_MS = 60_000;
let running: Promise<void> | null = null;

export const usePlantListStore = create<PlantListState>((set, get) => ({
  others: [],
  ownThumbnails: {},
  detailsById: {},
  state: 'idle',
  loadedAt: null,
  refreshedForExpiry: false,
  savedPositions: [],

  load: async ({ force = false } = {}) => {
    const { loadedAt } = get();
    if (!force && loadedAt !== null && Date.now() - loadedAt < FRESH_MS) return;
    if (running) return running;
    running = (async () => {
      const own = new Set(
        useRecordStore
          .getState()
          .records.map((record) => record.serverId)
          .filter((id): id is string => Boolean(id))
      );
      set({ state: 'loading' });
      try {
        const list = await fetchPlantList(own);
        const savedPositions = positionsFromList(list.others);
        set({ others: list.others, ownThumbnails: list.ownThumbnails, detailsById: list.detailsById, savedPositions, state: 'ok', loadedAt: Date.now() });
        // Not saving them only means no offline copy this time; the list itself loaded.
        await AsyncStorage.setItem(SAVED_POSITIONS_KEY, JSON.stringify(savedPositions)).catch(() => undefined);
      } catch {
        set({ state: 'offline' });
      } finally {
        running = null;
      }
    })();
    return running;
  },

  // The saved coordinates, for a screen opened before (or without) a successful load.
  loadSavedPositions: async () => {
    if (get().loadedAt !== null) return; // a fresh list is already in memory
    const raw = await AsyncStorage.getItem(SAVED_POSITIONS_KEY).catch(() => null);
    if (get().loadedAt === null) set({ savedPositions: parseSavedPositions(raw) });
  },

  // Called by a thumbnail whose signed link failed or had expired: fresh links, once.
  refreshExpiredThumbnails: async () => {
    if (get().refreshedForExpiry) return;
    set({ refreshedForExpiry: true });
    await get().load({ force: true });
  },
}));

// Logout: forget the list and the coordinates saved on the phone.
export async function clearSavedPlantList(): Promise<void> {
  usePlantListStore.setState({ others: [], ownThumbnails: {}, detailsById: {}, savedPositions: [], state: 'idle', loadedAt: null });
  await AsyncStorage.removeItem(SAVED_POSITIONS_KEY);
}

// Clears the once-only expiry refresh when the screen loads the list again normally.
export function resetExpiryRefresh(): void {
  usePlantListStore.setState({ refreshedForExpiry: false });
}
