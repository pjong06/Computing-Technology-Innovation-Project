import { apiFetch } from '../api/client';

// Other botanists' approved plants, for "All plants" on the Plants tab.
//
// GET /api/plants (backend/src/routes/plants.js) is open to botanists and reads through the
// signed-in user's Supabase client, so it returns what the plants table's row-level security
// lets them read: their own plants and approved plants (the same rule as canReadPlant and the
// sync rule that lets botanists visit approved plants). It sends id, species, tag, review
// status and registration date only: never coordinates, never who registered it.
//
// The phone keeps only the botanist's own plants, so these are loaded when the tab opens and
// kept in memory. Offline, "All plants" shows the plants on the phone only.

interface PlantListResponse {
  data: {
    id?: string;
    plant_id?: string;
    species_id?: string | null;
    qr_code_value?: string | null;
    plant_status?: string | null;
    registered_at?: string | null;
  }[];
  pagination?: { page: number; page_size: number; total: number | null };
}

export interface OtherApprovedPlant {
  serverId: string;
  speciesId: string | null;
  tagCode: string | null;
  registeredAt: string | null;
}

// The server sends 50 a page; stop after this many pages so a slow network can't hang the tab.
const MAX_PAGES = 20;

// Every approved plant the server lets this botanist read, except the ones in ownServerIds.
// Anything not approved is left out here too, even if the server ever sent it.
export async function fetchOtherApprovedPlants(ownServerIds: Set<string>): Promise<OtherApprovedPlant[]> {
  const plants: OtherApprovedPlant[] = [];
  let seen = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await apiFetch<PlantListResponse>(`/api/plants?page=${page}`);
    const rows = Array.isArray(response?.data) ? response.data : [];
    seen += rows.length;
    for (const row of rows) {
      const serverId = row.plant_id || row.id;
      if (!serverId || ownServerIds.has(serverId)) continue;
      if (row.plant_status?.toLowerCase() !== 'approved') continue;
      plants.push({
        serverId,
        speciesId: row.species_id ?? null,
        tagCode: row.qr_code_value ?? null,
        registeredAt: row.registered_at ?? null,
      });
    }
    const total = response?.pagination?.total;
    if (rows.length === 0 || (typeof total === 'number' && seen >= total)) break;
  }
  return plants;
}
