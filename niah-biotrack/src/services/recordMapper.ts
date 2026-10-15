import { PlantRecord, ObservationVisit } from '../store/useRecordStore';

/**
 * Payload interface for the backend POST /api/plants endpoint
 */
export interface BackendPlantPayload {
  scientific_name: string;
  common_name?: string;
  family?: string;
  location_name: string;
  latitude?: number;
  longitude?: number;
  gps_accuracy_m?: number | null;
  qr_code_value?: string | null;
  species_id?: string | null;
  notes?: string;
}

/**
 * Payload interface for the backend POST /api/observations endpoint
 */
export interface BackendObservationPayload {
  plant_id: string;
  observed_at: string;
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
  return {
    scientific_name: record.scientificName,
    common_name: record.commonName?.trim() || undefined,
    family: record.family?.trim() || undefined,
    location_name: record.locationName.trim(),
    latitude: record.latitude,
    longitude: record.longitude,
    gps_accuracy_m: record.gpsAccuracyM ?? null,
    qr_code_value: record.tagCode || null,
    species_id: record.speciesId || null,
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
    plant_id: backendPlantId,
    observed_at: obs.date,
    recorded_by: obs.recordedBy,
    health_status: obs.health.toLowerCase(),
    life_stage: obs.stage.toLowerCase(),
    measurement: obs.measurement,
    notes: obs.notes,
  };
}