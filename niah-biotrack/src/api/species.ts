import { supabase } from '../lib/supabase';
import { orderSpeciesMedia } from '../utils/speciesPhoto';

export interface SpeciesTaxonomySummary {
  family: string | null;
}

export interface SpeciesTaxonomy {
  kingdom: string | null;
  division: string | null;
  class_name: string | null;
  order_name: string | null;
  family: string | null;
  genus: string | null;
}

export interface SpeciesMedia {
  id: string;
  file_path?: string;
  media_type?: string;
  is_primary: boolean;
  source?: 'sfc' | 'inaturalist' | null;
  licence_code?: 'cc0' | 'cc-by' | 'cc-by-sa' | null;
  attribution?: string | null;
  photographer?: string | null;
  source_url?: string | null;
}

// Optional until the Knowledge API/database adds real attribution fields.
export interface SpeciesSource {
  name: string;
  url: string | null;
  citation: string | null;
  accessed_at: string | null;
  license: string | null;
}

// The primary photo of one of the species' plants (the newest approved plant with a photo),
// shown in place of species reference photos. Only staff requests get one (plant photos are
// staff-only); the link is signed and short-lived, so the app downloads it straight away.
export interface PlantPhoto {
  id: string;
  plant_id: string;
  tag: string | null;
  url: string;
  expires_in?: number;
}

// A plant photo visitors may see: the newest public plant of the species with a public
// photo. url is a path on the API server ("/p/NIAH-PLT-00012/photo"), turned into an
// address with publicPhotoUri(). Everyone gets it, signed in or not.
export interface PublicPlantPhoto {
  tag: string;
  url: string;
}

export interface Species {
  id: string;
  scientific_name: string;
  common_name: string | null;
  local_name: string | null;
  species_category: string | null;
  conservation_status: string | null;
  description: string | null;
  taxonomy: SpeciesTaxonomySummary | null;
  species_media: SpeciesMedia[];
  plant_photo?: PlantPhoto | null;
  public_photo?: PublicPlantPhoto | null;
}

export interface SpeciesDetail extends Species {
  morphology: string | null;
  habitat: string | null;
  cultural_significance: string | null;
  taxonomy: SpeciesTaxonomy | null;
  species_media: SpeciesMedia[];
  sources?: SpeciesSource[];
}

interface SpeciesPage {
  data: Species[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const NORMALIZED_BASE_URL = BASE_URL === undefined ? undefined : trimTrailingSlashes(BASE_URL);
const REQUEST_TIMEOUT_MS = 15_000;

function requireBaseUrl(): string {
  if (!NORMALIZED_BASE_URL) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is not set');
  }
  return NORMALIZED_BASE_URL;
}

// The login token when someone is signed in, so staff get plant photos; the species routes
// stay public and answer without one.
async function optionalAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const baseUrl = requireBaseUrl();
  const headers = await optionalAuthHeaders();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let response: Response;

    try {
      response = await fetch(`${baseUrl}${path}`, { headers, signal: controller.signal });
    } catch {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
    }

    if (!response.ok) {
      throw new Error('The server had a problem. Please try again.');
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// Downloads every approved species page instead of silently keeping only page 1.
export async function fetchSpecies(): Promise<Species[]> {
  const allSpecies: Species[] = [];
  const pageSize = 100;
  let page = 1;
  let totalPages = 1;

  do {
    const body = await fetchJson<SpeciesPage>(
      `/api/knowledge/species?page=${page}&page_size=${pageSize}`
    );

    if (!Array.isArray(body.data) || !body.pagination) {
      throw new Error('Unexpected species response from server');
    }

    allSpecies.push(...body.data.map((item) => ({
      ...item,
      species_media: orderSpeciesMedia(item.species_media),
    })));
    totalPages = Math.max(1, body.pagination.total_pages);
    page += 1;
  } while (page <= totalPages);

  // Protect the offline cache from accidental duplicate rows.
  const uniqueSpecies = [...new Map(allSpecies.map((item) => [item.id, item])).values()];

  return uniqueSpecies.sort((a, b) =>
    a.scientific_name.localeCompare(b.scientific_name)
  );
}

export async function fetchSpeciesDetail(id: string): Promise<SpeciesDetail> {
  const body = await fetchJson<{ data: SpeciesDetail }>(
    `/api/knowledge/species/${encodeURIComponent(id)}`
  );

  if (!body.data?.id) {
    throw new Error('Unexpected species detail response from server');
  }

  return {
    ...body.data,
    species_media: orderSpeciesMedia(body.data.species_media),
  };
}

// The backend returns a short-lived signed URL; download it immediately.
export async function fetchSpeciesPhotoUrl(
  speciesId: string,
  photoId: string
): Promise<string> {
  const body = await fetchJson<{ url: string }>(
    `/api/knowledge/species/${encodeURIComponent(speciesId)}/photos/${encodeURIComponent(photoId)}`
  );

  if (!body.url) {
    throw new Error('Species photo URL is missing');
  }

  return body.url;
}
