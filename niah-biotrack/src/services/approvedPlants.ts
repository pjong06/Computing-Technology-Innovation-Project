import { apiFetch } from '../api/client';
import type { SignedThumbnail } from '../utils/thumbnailSources';
import { detailsFromServer, type ServerPlantDetails } from '../utils/plantDetails';

// The plant list for the Plants tab and Home, from GET /api/plants
// (backend/src/routes/plants.js): one request per page of 50, never one per plant.
//
// The route reads through the signed-in user's Supabase client, so it returns what the
// plants table's row-level security lets them read: their own plants and approved plants.
// It sends id, species, tag, review status and registration date only: never coordinates,
// never who registered it. Each row also carries its picture:
//   - other botanists' (and imported) public plants: photo_url, "/p/<tag>/photo";
//   - the botanist's own plants: thumbnail_url, a short-lived signed link to the plant's main
//     photo (or its first observation's), with thumbnail_key and thumbnail_expires_at.
//
// The phone keeps only the botanist's own plants, so the others are loaded when the tab
// opens and kept in memory. Offline, "All plants" shows the plants on the phone only.

interface PlantListResponse {
  data: {
    id?: string;
    plant_id?: string;
    species_id?: string | null;
    qr_code_value?: string | null;
    plant_status?: string | null;
    registered_at?: string | null;
    photo_url?: string | null;
    thumbnail_url?: string | null;
    thumbnail_key?: string | null;
    thumbnail_expires_at?: string | null;
    // "This plant" details of an approved plant (backend/src/services/plantDetails.js).
    details?: unknown;
  }[];
  pagination?: { page: number; page_size: number; total: number | null };
}

export interface OtherApprovedPlant {
  serverId: string;
  speciesId: string | null;
  tagCode: string | null;
  registeredAt: string | null;
  photoUrl: string | null;
  details: ServerPlantDetails | null;
}

export interface PlantList {
  // Other botanists' approved plants.
  others: OtherApprovedPlant[];
  // Signed thumbnails of the botanist's own plants, by server id.
  ownThumbnails: Record<string, SignedThumbnail>;
  // Server details of every approved plant in the list (own ones too: their fallback).
  detailsById: Record<string, ServerPlantDetails>;
}

// The server sends 50 a page; stop after this many pages so a slow network can't hang the tab.
const MAX_PAGES = 20;

// Every plant the server lets this botanist read: the others' approved plants (anything not
// approved is left out here too), and thumbnails for their own.
export async function fetchPlantList(ownServerIds: Set<string>): Promise<PlantList> {
  const others: OtherApprovedPlant[] = [];
  const ownThumbnails: Record<string, SignedThumbnail> = {};
  const detailsById: Record<string, ServerPlantDetails> = {};
  let seen = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await apiFetch<PlantListResponse>(`/api/plants?page=${page}`);
    const rows = Array.isArray(response?.data) ? response.data : [];
    seen += rows.length;
    for (const row of rows) {
      const serverId = row.plant_id || row.id;
      if (!serverId) continue;
      const details = detailsFromServer(row.details);
      if (details) detailsById[serverId] = details;
      // Only own plants get a signed thumbnail.
      const own = ownServerIds.has(serverId) || typeof row.thumbnail_url === 'string';
      if (own) {
        if (typeof row.thumbnail_url === 'string' && typeof row.thumbnail_key === 'string') {
          ownThumbnails[serverId] = {
            url: row.thumbnail_url,
            key: row.thumbnail_key,
            expiresAt: typeof row.thumbnail_expires_at === 'string' ? row.thumbnail_expires_at : null,
          };
        }
        continue;
      }
      if (row.plant_status?.toLowerCase() !== 'approved') continue;
      others.push({
        serverId,
        speciesId: row.species_id ?? null,
        tagCode: row.qr_code_value ?? null,
        registeredAt: row.registered_at ?? null,
        photoUrl: typeof row.photo_url === 'string' ? row.photo_url : null,
        details: detailsFromServer(row.details),
      });
    }
    const total = response?.pagination?.total;
    if (rows.length === 0 || (typeof total === 'number' && seen >= total)) break;
  }
  return { others, ownThumbnails, detailsById };
}
