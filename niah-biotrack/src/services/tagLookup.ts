import { apiFetch, ApiError } from '../api/client';
import { useRecordStore, type PlantRecord } from '../store/useRecordStore';

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
    species?: { scientific_name?: string | null; common_name?: string | null } | null;
  };
}

// Looks a tag up on the phone first (works without signal), then on the server.
export async function lookupTag(rawTag: string): Promise<TagLookupResult> {
  const tagCode = rawTag.trim().toUpperCase();

  const record = useRecordStore.getState().findByTag(tagCode);
  if (record) return { status: 'on-phone', tagCode, record };

  try {
    // apiFetch attaches the login token; the route rejects requests without one.
    const response = await apiFetch<TagLookupResponse>(`/api/plants/tag/${encodeURIComponent(tagCode)}`);
    // Read the species itself, not the route's "Unknown species" placeholder.
    const species = response.data?.species;
    return {
      status: 'server-only',
      tagCode,
      scientificName: species?.scientific_name || null,
      commonName: species?.common_name || null,
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
          'This plant is registered on the server but not on this phone. Visits can only be added to plants saved on this phone.',
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

// What a visitor's scan found. Uses the public route, which only returns approved
// plants, so a plant that exists but isn't approved yet looks the same as "not found".
export type PublicTagLookupResult =
  | {
      status: 'found';
      tagCode: string;
      scientificName: string | null;
      commonName: string | null;
      localName: string | null;
    }
  | { status: 'not-found'; tagCode: string }
  | { status: 'offline'; tagCode: string }
  | { status: 'error'; tagCode: string; message: string };

// GET /api/public/plants/by-qr answers { data: {...public plant fields} }.
interface PublicPlantResponse {
  data: { scientific_name: string | null; common_name: string | null; local_name: string | null };
}

export async function lookupPublicTag(rawTag: string): Promise<PublicTagLookupResult> {
  const tagCode = rawTag.trim();
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
    };
  } catch (error) {
    if (error instanceof ApiError) {
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
