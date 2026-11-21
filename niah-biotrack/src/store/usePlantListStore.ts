import { create } from 'zustand';
import { fetchPlantList, type OtherApprovedPlant } from '../services/approvedPlants';
import { useRecordStore } from './useRecordStore';
import type { SignedThumbnail } from '../utils/thumbnailSources';
import type { ServerPlantDetails } from '../utils/plantDetails';

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
        set({ others: list.others, ownThumbnails: list.ownThumbnails, detailsById: list.detailsById, state: 'ok', loadedAt: Date.now() });
      } catch {
        set({ state: 'offline' });
      } finally {
        running = null;
      }
    })();
    return running;
  },

  // Called by a thumbnail whose signed link failed or had expired: fresh links, once.
  refreshExpiredThumbnails: async () => {
    if (get().refreshedForExpiry) return;
    set({ refreshedForExpiry: true });
    await get().load({ force: true });
  },
}));

// Clears the once-only expiry refresh when the screen loads the list again normally.
export function resetExpiryRefresh(): void {
  usePlantListStore.setState({ refreshedForExpiry: false });
}
