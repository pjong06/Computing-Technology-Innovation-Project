import type {
  ObservationVisit,
  PlantRecord,
} from '../store/useRecordStore';
import {
  getLocalEntities,
  saveEntityAndQueue,
  type LocalSyncStatus,
  type SyncOperationType,
} from './offlineDatabase';

const UPLOADED = 'Uploaded';
const NOT_UPLOADED = 'Not uploaded';
const FAILED = 'Upload failed';
const LOCAL_ONLY = 'Local only';

function toLocalStatus(status: string): LocalSyncStatus {
  if (status === UPLOADED) return 'uploaded';
  if (status === FAILED) return 'failed';
  if (status === LOCAL_ONLY) return 'local_only';
  return 'pending';
}

function toStoreStatus(status: LocalSyncStatus): PlantRecord['syncStatus'] {
  if (status === 'uploaded') return UPLOADED as PlantRecord['syncStatus'];
  if (status === 'failed' || status === 'conflict') {
    return FAILED as PlantRecord['syncStatus'];
  }
  if (status === 'local_only') return LOCAL_ONLY as PlantRecord['syncStatus'];
  return NOT_UPLOADED as PlantRecord['syncStatus'];
}

function recordCanUpload(record: PlantRecord): boolean {
  return (
    record.recordStatus === 'complete' &&
    record.identificationStatus === 'identified' &&
    Boolean(record.speciesId) &&
    typeof record.latitude === 'number' &&
    typeof record.longitude === 'number'
  );
}

function plantPayload(record: PlantRecord): Record<string, unknown> {
  return {
    species_id: record.speciesId,
    qr_code_value: record.tagCode,
    latitude: record.latitude,
    longitude: record.longitude,
    gps_accuracy_m: record.gpsAccuracyM ?? null,
    location_description: record.locationName.trim(),
    morphology: record.morphology?.trim() || null,
    description: record.description?.trim() || null,
  };
}

function observationPayload(
  record: PlantRecord,
  observation: ObservationVisit
): Record<string, unknown> {
  return {
    plant_client_record_id: record.id,
    observed_at: observation.observedAt ?? new Date().toISOString(),
    notes: observation.notes?.trim() || null,
    height_cm: observation.heightCm ?? null,
    diameter_cm: observation.diameterCm ?? null,
    life_stage: observation.stage?.toLowerCase() ?? null,
    health_status: observation.health?.toLowerCase() ?? null,
    latitude: observation.latitude,
    longitude: observation.longitude,
    gps_accuracy_m: observation.gpsAccuracyM ?? null,
  };
}

function operationFor(
  serverId: string | undefined,
  rowVersion: number | undefined
): SyncOperationType {
  // A legacy direct upload may have a serverId but no version. Sending create
  // is safe because the backend deduplicates it by client_record_id.
  return serverId && rowVersion ? 'update' : 'create';
}

export async function persistPlantRecord(
  record: PlantRecord,
  queueChange: boolean
): Promise<void> {
  const canUpload = recordCanUpload(record);
  const shouldQueue = queueChange && canUpload;

  await saveEntityAndQueue({
    entityType: 'plant',
    clientRecordId: record.id,
    serverId: record.serverId ?? null,
    baseVersion: record.rowVersion ?? null,
    snapshot: record as unknown as Record<string, unknown>,
    syncStatus: canUpload ? toLocalStatus(record.syncStatus) : 'local_only',
    operationType: shouldQueue
      ? operationFor(record.serverId, record.rowVersion)
      : undefined,
    payload: shouldQueue ? plantPayload(record) : undefined,
  });
}

export async function persistObservation(
  record: PlantRecord,
  observation: ObservationVisit,
  queueChange: boolean
): Promise<void> {
  await saveEntityAndQueue({
    entityType: 'observation',
    clientRecordId: observation.id,
    serverId: observation.serverId ?? null,
    baseVersion: observation.rowVersion ?? null,
    snapshot: observation as unknown as Record<string, unknown>,
    syncStatus: toLocalStatus(observation.syncStatus),
    operationType: queueChange
      ? operationFor(observation.serverId, observation.rowVersion)
      : undefined,
    payload: queueChange
      ? observationPayload(record, observation)
      : undefined,
  });
}

export async function persistRecordSnapshot(
  record: PlantRecord,
  options: {
    queuePlant?: boolean;
    queueObservationIds?: string[];
  } = {}
): Promise<void> {
  await persistPlantRecord(record, options.queuePlant ?? false);

  const queuedIds = new Set(options.queueObservationIds ?? []);
  for (const observation of record.observations) {
    await persistObservation(record, observation, queuedIds.has(observation.id));
  }
}

export async function loadOrMigrateRecords(
  cachedRecords: PlantRecord[]
): Promise<PlantRecord[]> {
  const storedPlants = await getLocalEntities<PlantRecord>('plant');

  if (storedPlants.length === 0) {
    for (const record of cachedRecords) {
      const queuePlant =
        recordCanUpload(record) && record.syncStatus !== UPLOADED;
      const queueObservationIds = record.observations
        .filter(
          (observation) =>
            queuePlant && observation.syncStatus !== UPLOADED
        )
        .map((observation) => observation.id);

      await persistRecordSnapshot(record, {
        queuePlant,
        queueObservationIds,
      });
    }

    return cachedRecords;
  }

  const storedObservations = await getLocalEntities<ObservationVisit>(
    'observation'
  );
  const observationById = new Map(
    storedObservations.map((entity) => [entity.clientRecordId, entity])
  );

  return storedPlants.map((entity) => {
    const snapshot = entity.snapshot;
    const observations = (snapshot.observations ?? []).map((observation) => {
      const stored = observationById.get(observation.id);
      if (!stored) return observation;

      return {
        ...observation,
        serverId: stored.serverId ?? observation.serverId,
        rowVersion: stored.rowVersion ?? observation.rowVersion,
        syncStatus: toStoreStatus(stored.syncStatus),
      };
    });

    const observationFailed = observations.some(
      (observation) => observation.syncStatus === FAILED
    );
    const observationPending = observations.some(
      (observation) => observation.syncStatus !== UPLOADED
    );
    const plantStatus = toStoreStatus(entity.syncStatus);
    const aggregateStatus =
      plantStatus === LOCAL_ONLY
        ? LOCAL_ONLY
        : plantStatus === FAILED || observationFailed
          ? FAILED
          : plantStatus === UPLOADED && !observationPending
            ? UPLOADED
            : NOT_UPLOADED;

    return {
      ...snapshot,
      serverId: entity.serverId ?? snapshot.serverId,
      rowVersion: entity.rowVersion ?? snapshot.rowVersion,
      syncStatus: aggregateStatus as PlantRecord['syncStatus'],
      observations,
    };
  });
}
