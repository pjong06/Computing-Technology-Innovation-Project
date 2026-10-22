import { PlantRecord, ObservationVisit, UNKNOWN_SPECIES } from '../store/useRecordStore';

/**
 * Payload interface for the backend POST /api/plants endpoint
 */
export interface BackendPlantPayload {
  // The phone's own UUID for this record (PlantRecord.id). The backend uses it to
  // spot a repeated upload: same ID again = 200 "already saved", not a duplicate row.
  client_record_id: string;
  // Left out for an unknown species (see mapLocalRecordToBackend).
  scientific_name?: string;
  common_name?: string;
  family?: string;
  // The backend column is location_description; it does not read location_name.
  location_description: string;
  latitude?: number;
  longitude?: number;
  gps_accuracy_m?: number;
  qr_code_value?: string | null;
  species_id?: string | null;
  notes?: string;
}

/**
 * Payload interface for the backend POST /api/observations endpoint
 */
export interface BackendObservationPayload {
  // The phone's UUID for this visit (ObservationVisit.id), so a retried upload
  // is recognised instead of creating a second copy.
  client_record_id: string;
  plant_id: string; // the SERVER's id for the plant (returned by POST /api/plants)
  observed_at?: string; // ISO date; left out for old visits that only have display text
  recorded_by: string;
  health_status: string;
  life_stage: string;
  measurement?: string;
  notes?: string;
}

/**
 * Converts a local on-device PlantRecord into the backend DB payload format
 */
export function mapLocalRecordToBackend(record: PlantRecord): BackendPlantPayload {
  // "Unknown species" is only a label on the phone. The backend looks every
  // scientific_name up in the approved species list and rejects one it can't find,
  // so for an unidentified plant we send no species fields at all; the officer
  // assigns the species during review.
  const isUnknownSpecies = record.scientificName === UNKNOWN_SPECIES;

  return {
    client_record_id: record.id,
    scientific_name: isUnknownSpecies ? undefined : record.scientificName,
    common_name: record.commonName?.trim() || undefined,
    family: record.family?.trim() || undefined,
    location_description: record.locationName.trim(),
    latitude: record.latitude,
    longitude: record.longitude,
    // Leave it out when the phone didn't report accuracy: the backend rejects null here
    // (it only accepts a number or no field at all) and stores a missing value as null.
    gps_accuracy_m: record.gpsAccuracyM ?? undefined,
    qr_code_value: record.tagCode || null,
    species_id: isUnknownSpecies ? undefined : record.speciesId || null,
    notes: [record.morphology, record.description].filter(Boolean).join('\n\n') || undefined,
  };
}

/**
 * Converts a local ObservationVisit into the backend DB observation payload format
 */
export function mapLocalObservationToBackend(
  backendPlantId: string,
  obs: ObservationVisit
): BackendObservationPayload {
  return {
    client_record_id: obs.id,
    plant_id: backendPlantId,
    // Send the ISO timestamp, not obs.date: the backend rejects text it can't parse
    // as a date (e.g. "22 Oct 2026 · 3:15 PM"). Visits from before store v6 have no
    // observedAt, so the field is left out and the server uses the upload time.
    observed_at: obs.observedAt,
    recorded_by: obs.recordedBy,
    health_status: obs.health.toLowerCase(),
    life_stage: obs.stage.toLowerCase(),
    measurement: obs.measurement,
    notes: obs.notes,
  };
}