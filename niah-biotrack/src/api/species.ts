// The shape of one species, exactly as the backend sends it (snake_case, like the database).
export interface Species {
  id: string;
  scientific_name: string;
  common_name: string | null;
  local_name: string | null;
  conservation_status: string | null;
  description: string | null;
}

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

// Downloads the approved species list from the backend.
export async function fetchSpecies(): Promise<Species[]> {
  if (!BASE_URL) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is not set');
  }

  // Give up after 15 seconds (weak signal in the field).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${BASE_URL}/api/knowledge/species`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    const body = await response.json();
    if (!Array.isArray(body?.data)) {
      throw new Error('Unexpected response from server');
    }
    return body.data as Species[];
  } finally {
    clearTimeout(timer);
  }
}