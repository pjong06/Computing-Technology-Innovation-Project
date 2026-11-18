import { apiFetch, ApiError } from '../api/client';
import { useProfileStore } from '../store/useProfileStore';
import {
  IdentificationStatus,
  RecordStatus,
  ReviewStatus,
  SyncStatus,
  useRecordStore,
  type HealthStatus,
  type LifeStage,
  type ObservationVisit,
  type PlantRecord,
} from '../store/useRecordStore';
import { useSpeciesStore } from '../store/useSpeciesStore';
import {
  getLocalEntities,
  getSyncCursor,
  removeUploadedLocalEntity,
  setSyncCursor,
} from './offlineDatabase';
import {
  loadOrMigrateRecords,
  persistRecordSnapshot,
} from './offlineRecordRepository';

interface PullChange {
  sequence_cursor: number;
  entity_type: 'plants' | 'observations' | 'plant_media' | 'observation_media';
  entity_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  row_version: number | null;
  changed_at: string;
  record_payload: Record<string, unknown> | null;
}

interface PullResponse {
  changes: PullChange[];
  next_cursor: number;
  has_more: boolean;
}

export interface ServerPullResult {
  downloaded: number;
  plants: number;
  observations: number;
  keptLocal: number;
}

const PAGE_SIZE = 200;
let activePull: Promise<ServerPullResult> | null = null;

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function coordinates(payload: Record<string, unknown>): {
  latitude?: number;
  longitude?: number;
} {
  const latitude = numberValue(payload.latitude);
  const longitude = numberValue(payload.longitude);
  if (latitude !== undefined && longitude !== undefined) return { latitude, longitude };

  const location = payload.location;
  if (location && typeof location === 'object') {
    const pair = (location as { coordinates?: unknown }).coordinates;
    if (Array.isArray(pair) && pair.length >= 2) {
      const parsedLongitude = numberValue(pair[0]);
      const parsedLatitude = numberValue(pair[1]);
      if (parsedLatitude !== undefined && parsedLongitude !== undefined) {
        return { latitude: parsedLatitude, longitude: parsedLongitude };
      }
    }
  }

  if (typeof location === 'string') {
    const point = /^POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(location);
    if (point) {
      return { longitude: Number(point[1]), latitude: Number(point[2]) };
    }
  }

  return {};
}

function displayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} · ${date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })}`;
}

function plantReview(value: unknown): ReviewStatus {
  if (value === 'approved') return ReviewStatus.APPROVED;
  if (value === 'rejected') return ReviewStatus.REJECTED;
  if (value === 'pending') return ReviewStatus.PENDING;
  return ReviewStatus.DRAFT;
}

function observationReview(value: unknown): ReviewStatus {
  if (value === 'approved') return ReviewStatus.APPROVED;
  if (value === 'rejected') return ReviewStatus.REJECTED;
  if (value === 'pending') return ReviewStatus.PENDING;
  return ReviewStatus.DRAFT;
}

function healthStatus(value: unknown): HealthStatus | undefined {
  const normalized = textValue(value)?.toLowerCase();
  const statuses: Record<string, HealthStatus> = {
    healthy: 'Healthy',
    stressed: 'Stressed',
    diseased: 'Diseased',
    damaged: 'Damaged',
    dead: 'Dead',
  };
  return normalized ? statuses[normalized] : undefined;
}

function lifeStage(value: unknown): LifeStage | undefined {
  const normalized = textValue(value)?.toLowerCase();
  const stages: Record<string, LifeStage> = {
    bud: 'Bud',
    flowering: 'Flowering',
    vegetative: 'Vegetative',
    fruiting: 'Fruiting',
    seedling: 'Seedling',
    sapling: 'Sapling',
    pole: 'Pole',
    mature: 'Mature',
    senescent: 'Senescent',
  };
  return normalized ? stages[normalized] : undefined;
}

function measurement(heightCm?: number, diameterCm?: number): string {
  const height = heightCm === undefined ? '-' : String(heightCm / 100);
  const diameter = diameterCm === undefined ? '-' : String(diameterCm);
  return `Height ${height} m · Diameter ${diameter} cm`;
}

function clientId(change: PullChange): string {
  return textValue(change.record_payload?.client_record_id) ?? change.entity_id;
}

function isDeleted(change: PullChange): boolean {
  return change.action === 'DELETE' || change.record_payload?.deleted_at != null;
}

function latestChanges(changes: PullChange[]): PullChange[] {
  const latest = new Map<string, PullChange>();
  for (const change of changes) {
    latest.set(`${change.entity_type}:${change.entity_id}`, change);
  }
  return [...latest.values()];
}

async function fetchChanges(): Promise<{ changes: PullChange[]; cursor: number }> {
  let cursor = await getSyncCursor();
  const changes: PullChange[] = [];

  while (true) {
    const response = await apiFetch<PullResponse>(
      `/api/sync/pull?cursor=${cursor}&limit=${PAGE_SIZE}`
    );
    if (!Array.isArray(response.changes) || !Number.isSafeInteger(response.next_cursor)) {
      throw new Error('The server returned an invalid sync response.');
    }

    changes.push(...response.changes);
    if (!response.has_more) return { changes, cursor: response.next_cursor };
    if (response.next_cursor <= cursor) {
      throw new Error('The server sync cursor did not advance.');
    }
    cursor = response.next_cursor;
  }
}

async function runPull(): Promise<ServerPullResult> {
  const { changes: allChanges, cursor } = await fetchChanges();
  const changes = latestChanges(allChanges);

  await useSpeciesStore.getState().loadSpecies({ silent: true }).catch(() => {});
  const speciesById = new Map(
    useSpeciesStore.getState().species.map((species) => [species.id, species])
  );

  const storedPlants = await getLocalEntities<PlantRecord>('plant');
  const storedObservations = await getLocalEntities<ObservationVisit>('observation');
  const plantStatus = new Map(storedPlants.map((entity) => [entity.clientRecordId, entity.syncStatus]));
  const observationStatus = new Map(
    storedObservations.map((entity) => [entity.clientRecordId, entity.syncStatus])
  );
  const records = await loadOrMigrateRecords(useRecordStore.getState().records);
  const byClientId = new Map(records.map((record) => [record.id, record]));
  const byServerId = new Map(
    records.filter((record) => record.serverId).map((record) => [record.serverId as string, record])
  );

  let plants = 0;
  let observations = 0;
  let keptLocal = 0;
  const changedRecordIds = new Set<string>();

  const plantChanges = changes.filter((change) => change.entity_type === 'plants');
  for (const change of plantChanges) {
    const id = clientId(change);
    const existing = byClientId.get(id) ?? byServerId.get(change.entity_id);
    if (existing && plantStatus.get(existing.id) !== 'uploaded') {
      keptLocal += 1;
      continue;
    }

    if (isDeleted(change)) {
      if (!existing) continue;
      const hasUnsyncedVisit = existing.observations.some(
        (visit) => observationStatus.get(visit.id) !== 'uploaded'
      );
      if (hasUnsyncedVisit) {
        keptLocal += 1;
        continue;
      }
      for (const visit of existing.observations) {
        await removeUploadedLocalEntity('observation', visit.id);
      }
      await removeUploadedLocalEntity('plant', existing.id);
      byClientId.delete(existing.id);
      if (existing.serverId) byServerId.delete(existing.serverId);
      plants += 1;
      continue;
    }

    const payload = change.record_payload ?? {};
    const speciesId = textValue(payload.species_id) ?? existing?.speciesId ?? null;
    const species = speciesId ? speciesById.get(speciesId) : undefined;
    const position = coordinates(payload);
    const latitude = position.latitude ?? existing?.latitude;
    const longitude = position.longitude ?? existing?.longitude;
    const createdAtIso =
      textValue(payload.registered_at) ?? textValue(payload.created_at) ?? existing?.createdAtIso ?? change.changed_at;
    const record: PlantRecord = {
      ...existing,
      id: existing?.id ?? id,
      serverId: change.entity_id,
      rowVersion: change.row_version ?? numberValue(payload.row_version) ?? existing?.rowVersion,
      tagCode: textValue(payload.qr_code_value) ?? existing?.tagCode ?? null,
      scientificName: species?.scientific_name ?? existing?.scientificName ?? 'Unknown species',
      speciesId,
      commonName: species?.common_name ?? existing?.commonName ?? '',
      family: species?.taxonomy?.family ?? existing?.family ?? '',
      morphology: textValue(payload.morphology) ?? existing?.morphology,
      description: textValue(payload.description) ?? existing?.description,
      locationName:
        textValue(payload.location_description) ?? existing?.locationName ?? 'Niah National Park',
      latitude,
      longitude,
      gpsAccuracyM: numberValue(payload.gps_accuracy_m) ?? existing?.gpsAccuracyM ?? null,
      gpsCoordination:
        latitude !== undefined && longitude !== undefined
          ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
          : existing?.gpsCoordination ?? 'Not recorded',
      photoUris: existing?.photoUris ?? [],
      recordStatus: RecordStatus.COMPLETE,
      identificationStatus: speciesId ? IdentificationStatus.IDENTIFIED : IdentificationStatus.PENDING,
      syncStatus: SyncStatus.UPLOADED,
      reviewStatus: plantReview(payload.plant_status),
      reviewComment: existing?.reviewComment ?? null,
      createdAt: existing?.createdAt ?? displayDate(createdAtIso),
      createdAtIso,
      observations: existing?.observations ?? [],
    };
    byClientId.set(record.id, record);
    byServerId.set(change.entity_id, record);
    changedRecordIds.add(record.id);
    plants += 1;
  }

  const observationChanges = changes.filter((change) => change.entity_type === 'observations');
  for (const change of observationChanges) {
    const id = clientId(change);
    const existingRecord = [...byClientId.values()].find((record) =>
      record.observations.some((visit) => visit.id === id || visit.serverId === change.entity_id)
    );
    const existingVisit = existingRecord?.observations.find(
      (visit) => visit.id === id || visit.serverId === change.entity_id
    );
    if (existingVisit && observationStatus.get(existingVisit.id) !== 'uploaded') {
      keptLocal += 1;
      continue;
    }

    if (isDeleted(change)) {
      if (!existingRecord || !existingVisit) continue;
      await removeUploadedLocalEntity('observation', existingVisit.id);
      const updatedRecord = {
        ...existingRecord,
        observations: existingRecord.observations.filter((visit) => visit.id !== existingVisit.id),
      };
      byClientId.set(updatedRecord.id, updatedRecord);
      if (updatedRecord.serverId) byServerId.set(updatedRecord.serverId, updatedRecord);
      changedRecordIds.add(updatedRecord.id);
      observations += 1;
      continue;
    }

    const payload = change.record_payload ?? {};
    const parentServerId = textValue(payload.plant_id);
    const record = existingRecord ?? (parentServerId ? byServerId.get(parentServerId) : undefined);
    if (!record) continue;

    const position = coordinates(payload);
    const observedAt = textValue(payload.observed_at) ?? existingVisit?.observedAt ?? change.changed_at;
    const heightCm = numberValue(payload.height_cm) ?? existingVisit?.heightCm;
    const diameterCm = numberValue(payload.diameter_cm) ?? existingVisit?.diameterCm;
    const reviewStatus = observationReview(payload.review_status);
    const profile = useProfileStore.getState().me;
    const visit: ObservationVisit = {
      ...existingVisit,
      id: existingVisit?.id ?? id,
      serverId: change.entity_id,
      rowVersion: change.row_version ?? numberValue(payload.row_version) ?? existingVisit?.rowVersion,
      date: existingVisit?.date ?? displayDate(observedAt),
      observedAt,
      recordedBy: existingVisit?.recordedBy ?? profile?.full_name ?? profile?.email ?? 'Field Staff',
      health: healthStatus(payload.health_status) ?? existingVisit?.health,
      stage: lifeStage(payload.life_stage) ?? existingVisit?.stage,
      measurement: existingVisit?.measurement ?? measurement(heightCm, diameterCm),
      heightCm,
      diameterCm,
      notes: textValue(payload.notes) ?? existingVisit?.notes ?? 'Observation downloaded from server.',
      syncStatus: SyncStatus.UPLOADED,
      latitude: position.latitude ?? existingVisit?.latitude,
      longitude: position.longitude ?? existingVisit?.longitude,
      gpsAccuracyM: numberValue(payload.gps_accuracy_m) ?? existingVisit?.gpsAccuracyM ?? null,
      reviewStatus,
      submissionRequested: reviewStatus !== ReviewStatus.DRAFT,
      submittedForReview: reviewStatus === ReviewStatus.PENDING || reviewStatus === ReviewStatus.APPROVED,
    };
    const updatedRecord = {
      ...record,
      observations: existingVisit
        ? record.observations.map((item) => (item.id === existingVisit.id ? visit : item))
        : [visit, ...record.observations],
    };
    byClientId.set(updatedRecord.id, updatedRecord);
    if (updatedRecord.serverId) byServerId.set(updatedRecord.serverId, updatedRecord);
    changedRecordIds.add(updatedRecord.id);
    observations += 1;
  }

  for (const recordId of changedRecordIds) {
    const record = byClientId.get(recordId);
    if (record) await persistRecordSnapshot(record);
  }

  const refreshed = await loadOrMigrateRecords([...byClientId.values()]);
  useRecordStore.setState({ records: refreshed });
  await setSyncCursor(cursor);

  return {
    downloaded: plants + observations,
    plants,
    observations,
    keptLocal,
  };
}

export function pullServerRecords(): Promise<ServerPullResult> {
  if (activePull) return activePull;
  activePull = runPull().finally(() => {
    activePull = null;
  });
  return activePull;
}

export function serverPullError(error: unknown): string {
  if (error instanceof ApiError && error.status === 0) {
    return 'Uploads are safe, but the latest server records could not be downloaded. Check your connection.';
  }
  return error instanceof Error ? error.message : 'Could not download the latest server records.';
}
