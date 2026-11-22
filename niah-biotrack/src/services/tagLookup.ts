import { apiFetch, ApiError } from '../api/client';
import { fetchSpecies } from '../api/species';
import { parseTagCode } from '../utils/tagCode';
import { detailsFromServer } from '../utils/plantDetails';
import {
  IdentificationStatus,
  RecordStatus,
  ReviewStatus,
  SyncStatus,
  useRecordStore,
  type PlantRecord,
} from '../store/useRecordStore';

// What a tag lookup found. Every case is real: nothing is filled in when the tag
// can't be matched, so the screen can say exactly what happened.
export type TagLookupResult =
  | { status: 'on-phone'; tagCode: string; record: PlantRecord } // can add a visit
  | { status: 'server-only'; tagCode: string; scientificName: string | null; commonName: string | null }
  | { status: 'not-found'; tagCode: string }
  | { status: 'offline'; tagCode: string } // not on the phone, and the server couldn't be reached
  | { status: 'error'; tagCode: string; message: string };

// GET /api/plants/tag/:tagCode answers { data: { ...plant, species: {...} } }.
interface TagLookupResponse {
  data: {
    id?: string;
    plant_id?: string;
    client_record_id?: string | null;
    species_id?: string | null;
    qr_code_value?: string | null;
    tag_code?: string | null;
    location_description?: string | null;
    location_name?: string | null;
    morphology?: string | null;
    description?: string | null;
    plant_status?: string | null;
    // Sent only for the botanist's own plants (visiblePlant in backend/src/routes/plants.js).
    registered_by?: string | null;
    registered_at?: string | null;
    row_version?: number | null;
    gps_accuracy_m?: number | null;
    // Public photo address for a plant someone else registered ("/p/<tag>/photo"), or null.
    photo_url?: string | null;
    // "This plant" details of an approved plant (location, notes, latest approved observation).
    details?: unknown;
    scientific_name?: string | null;
    common_name?: string | null;
    species?: {
      id?: string | null;
      scientific_name?: string | null;
      common_name?: string | null;
    } | null;
  };
}

// Looks a tag up on the phone first (works without signal), then on the server.
export async function lookupTag(rawTag: string): Promise<TagLookupResult> {
  const tagCode = parseTagCode(rawTag) ??
    rawTag.trim().toUpperCase();

  const record = useRecordStore.getState().findByTag(tagCode);
  if (record) return { status: 'on-phone', tagCode, record };

  try {
    // apiFetch attaches the login token; the route rejects requests without one.
    const response = await apiFetch<TagLookupResponse>(`/api/plants/tag/${encodeURIComponent(tagCode)}`);
    const data = response.data;
    const serverId = data?.plant_id || data?.id;
    if (!serverId) {
      return {
        status: 'error',
        tagCode,
        message: 'The server returned a plant without an ID. Please try again.',
      };
    }

    const species = data.species;
    const speciesId = data.species_id || species?.id || null;
    const registeredAt =
      data.registered_at && Number.isFinite(Date.parse(data.registered_at))
        ? new Date(data.registered_at)
        : new Date();
    const plantStatus = data.plant_status?.toLowerCase();
    const serverDetails = detailsFromServer(data.details);
    const cachedRecord: PlantRecord = {
      id: data.client_record_id || serverId,
      serverId,
      otherBotanist: !data.registered_by,
      publicPhotoUrl: !data.registered_by && typeof data.photo_url === 'string' ? data.photo_url : null,
      rowVersion: data.row_version ?? undefined,
      tagCode: data.tag_code || data.qr_code_value || tagCode,
      scientificName:
        species?.scientific_name ||
        data.scientific_name ||
        'Species not recorded',
      speciesId,
      commonName: species?.common_name || data.common_name || '',
      family: '',
      morphology: data.morphology || '',
      description: data.description || '',
      locationName:
        data.location_name ||
        data.location_description ||
        'Location not recorded',
      // Approved plants: their location, so "Find plant" can navigate to them.
      latitude: serverDetails?.latitude ?? undefined,
      longitude: serverDetails?.longitude ?? undefined,
      gpsAccuracyM: serverDetails?.gpsAccuracyM ?? data.gps_accuracy_m ?? null,
      gpsCoordination: '',
      serverDetails,
      photoUris: [],
      photoEntries: [],
      recordStatus: RecordStatus.COMPLETE,
      identificationStatus: speciesId
        ? IdentificationStatus.IDENTIFIED
        : IdentificationStatus.PENDING,
      syncStatus: SyncStatus.UPLOADED,
      reviewStatus:
        plantStatus === 'approved'
          ? ReviewStatus.APPROVED
          : plantStatus === 'rejected'
            ? ReviewStatus.REJECTED
            : ReviewStatus.PENDING,
      createdAt: registeredAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      }),
      createdAtIso: registeredAt.toISOString(),
      observations: [],
    };
    const record = await useRecordStore
      .getState()
      .cacheServerRecord(cachedRecord);
    return {
      status: 'on-phone',
      tagCode,
      record,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) return { status: 'not-found', tagCode };
      if (error.status === 0) return { status: 'offline', tagCode };
      // e.g. 400 "Tag code must follow NIAH-PLT-00001 format"
      return { status: 'error', tagCode, message: error.message };
    }
    return { status: 'error', tagCode, message: 'Could not look up this tag. Please try again.' };
  }
}

// Heading and explanation for every result except 'on-phone', shared by Scan and
// Manual Tag Entry so both screens say the same thing.
export function describeTagLookup(result: Exclude<TagLookupResult, { status: 'on-phone' }>): {
  title: string;
  message: string;
} {
  switch (result.status) {
    case 'server-only':
      return {
        title: result.scientificName ?? 'Species not recorded',
        message:
          'This plant is registered on the server but could not be added to this phone.',
      };
    case 'not-found':
      return { title: 'Tag not found', message: 'No plant has this tag, on this phone or on the server.' };
    case 'offline':
      return { title: 'Not on this phone', message: 'Connect to the internet to look it up on the server.' };
    case 'error':
      return { title: 'Could not look up tag', message: result.message };
  }
}

// ---- Visitors (not signed in) ----

// Public lookup returns plant details only after approval.
export type PublicTagLookupResult =
  | {
    status: 'found';
    tagCode: string;
    scientificName: string | null;
    commonName: string | null;
    localName: string | null;
    // Public plant facts for the visitor plant page. Location is never used there.
    description: string | null;
    habitat: string | null;
    conservationStatus: string | null;
    culturalSignificance: string | null;
    // The plant's own main photo (a path on the API server), or null when it has none.
    photoUrl: string | null;
  }
  | { status: 'pending'; tagCode: string; message: string }
  | { status: 'not-found'; tagCode: string }
  | { status: 'offline'; tagCode: string }
  | { status: 'error'; tagCode: string; message: string };

// GET /api/public/plants/by-qr answers { data: {...public plant fields} }.
interface PublicPlantResponse {
  data: {
    scientific_name: string | null;
    common_name: string | null;
    local_name: string | null;
    description: string | null;
    habitat: string | null;
    conservation_status: string | null;
    cultural_significance: string | null;
    photo_url?: string | null;
  };
}

export async function lookupPublicTag(rawTag: string): Promise<PublicTagLookupResult> {
  const tagCode = parseTagCode(rawTag);
  if (tagCode === null) {
    return { status: 'not-found', tagCode: rawTag.trim() };
  }
  try {
    // auth: false — visitors have no login; the route is public and rate-limited.
    const response = await apiFetch<PublicPlantResponse>(
      `/api/public/plants/by-qr?code=${encodeURIComponent(tagCode)}`,
      { auth: false }
    );
    return {
      status: 'found',
      tagCode,
      scientificName: response.data?.scientific_name || null,
      commonName: response.data?.common_name || null,
      localName: response.data?.local_name || null,
      description: response.data?.description || null,
      habitat: response.data?.habitat || null,
      conservationStatus: response.data?.conservation_status || null,
      culturalSignificance: response.data?.cultural_significance || null,
      photoUrl: typeof response.data?.photo_url === 'string' ? response.data.photo_url : null,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404 && error.code === 'plant_pending_verification') {
        return { status: 'pending', tagCode, message: error.message };
      }
      if (error.status === 404) return { status: 'not-found', tagCode };
      if (error.status === 0) return { status: 'offline', tagCode };
      return { status: 'error', tagCode, message: error.message };
    }
    return { status: 'error', tagCode, message: 'Could not look up this tag. Please try again.' };
  }
}

// Heading and explanation for a visitor result that isn't a found plant.
export function describePublicTagLookup(result: Exclude<PublicTagLookupResult, { status: 'found' }>): {
  title: string;
  message: string;
} {
  switch (result.status) {
    case 'pending':
      return { title: 'Being verified', message: result.message };
    case 'not-found':
      return {
        title: 'Tag not found',
        message: "This plant's information isn't available yet.",
      };
    case 'offline':
      return { title: 'No connection', message: 'Connect to the internet to look up this tag.' };
    case 'error':
      return { title: 'Could not look up tag', message: result.message };
  }
}

export interface PublicPlantSummary {
  id: string;
  tagCode: string | null;
  speciesId: string | null;
  scientificName: string | null;
  commonName: string | null;
  localName: string | null;
  speciesCategory: string | null;
  conservationStatus: string | null;
  description: string | null;
  registeredAt: string | null;
  photoUrl: string | null;
}

interface PublicPlantsListResponse {
  data: {
    id?: string;
    tag_code?: string | null;
    species_id?: string | null;
    scientific_name?: string | null;
    common_name?: string | null;
    local_name?: string | null;
    species_category?: string | null;
    conservation_status?: string | null;
    description?: string | null;
    registered_at?: string | null;
    photo_url?: string | null;
  }[];
}

// Fallback when the running backend does not yet have GET /api/public/plants deployed:
// extracts the approved plant tags attached to /api/knowledge/species (public_photo.tag).
async function fetchPublicPlantsFromSpeciesFallback(): Promise<PublicPlantSummary[]> {
  const speciesList = await fetchSpecies();
  const plants: PublicPlantSummary[] = [];
  const seenTags = new Set<string>();

  for (const sp of speciesList) {
    const tagCode = sp.public_photo?.tag?.trim().toUpperCase();
    if (!tagCode || seenTags.has(tagCode)) continue;
    seenTags.add(tagCode);
    plants.push({
      id: tagCode,
      tagCode,
      speciesId: sp.id,
      scientificName: sp.scientific_name || null,
      commonName: sp.common_name || null,
      localName: sp.local_name || null,
      speciesCategory: sp.species_category || null,
      conservationStatus: sp.conservation_status || null,
      description: sp.description || null,
      registeredAt: null,
      photoUrl: sp.public_photo?.url ?? null,
    });
  }

  return plants.sort((a, b) => (b.tagCode ?? '').localeCompare(a.tagCode ?? ''));
}

export async function fetchPublicPlants(): Promise<PublicPlantSummary[]> {
  try {
    const response = await apiFetch<PublicPlantsListResponse>('/api/public/plants', {
      auth: false,
    });
    const rows = Array.isArray(response?.data) ? response.data : [];
    return rows
      .filter((row) => Boolean(row?.id || row?.tag_code))
      .map((row) => ({
        id: (row.id || row.tag_code)!,
        tagCode: typeof row.tag_code === 'string' && row.tag_code.length > 0 ? row.tag_code : null,
        speciesId: row.species_id ?? null,
        scientificName: row.scientific_name ?? null,
        commonName: row.common_name ?? null,
        localName: row.local_name ?? null,
        speciesCategory: row.species_category ?? null,
        conservationStatus: row.conservation_status ?? null,
        description: row.description ?? null,
        registeredAt: row.registered_at ?? null,
        photoUrl: typeof row.photo_url === 'string' ? row.photo_url : null,
      }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return fetchPublicPlantsFromSpeciesFallback();
    }
    throw error;
  }
}