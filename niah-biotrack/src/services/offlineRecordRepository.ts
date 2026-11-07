import { randomUUID } from 'expo-crypto';

import type {
  ObservationVisit,
  PlantPhotoEntry,
  PlantPhotoType,
  PlantRecord,
} from '../store/useRecordStore';

import {
  getLocalEntities,
  getPlantTagRefusals,
  saveEntityAndQueue,
  type LocalSyncStatus,
  type SyncOperationType,
} from './offlineDatabase';

const UPLOADED = 'Uploaded';
const NOT_UPLOADED = 'Not uploaded';
const FAILED = 'Upload failed';
const LOCAL_ONLY = 'Local only';

const LEGACY_PHOTO_TYPES: PlantPhotoType[] = [
  'whole_plant',
  'leaf',
  'flower',
  'bark',
];

function toLocalStatus(
  status: string
): LocalSyncStatus {
  if (status === UPLOADED) return 'uploaded';
  if (status === FAILED) return 'failed';
  if (status === LOCAL_ONLY) return 'local_only';

  return 'pending';
}

function toStoreStatus(
  status: LocalSyncStatus
): PlantRecord['syncStatus'] {
  if (status === 'uploaded') {
    return UPLOADED as PlantRecord['syncStatus'];
  }

  if (
    status === 'failed' ||
    status === 'conflict'
  ) {
    return FAILED as PlantRecord['syncStatus'];
  }

  if (status === 'local_only') {
    return LOCAL_ONLY as PlantRecord['syncStatus'];
  }

  return NOT_UPLOADED as PlantRecord['syncStatus'];
}

function recordCanUpload(
  record: PlantRecord
): boolean {
  return (
    record.recordStatus === 'complete' &&
    record.identificationStatus === 'identified' &&
    Boolean(record.speciesId) &&
    typeof record.latitude === 'number' &&
    typeof record.longitude === 'number'
  );
}

function normalizePhotoEntries(
  record: PlantRecord
): PlantRecord {
  const canUpload = recordCanUpload(record);

  if (
    Array.isArray(record.photoEntries) &&
    record.photoEntries.length > 0
  ) {
    let changed = false;

    const entries = record.photoEntries.map(
      (photo): PlantPhotoEntry => {
        let syncStatus = photo.syncStatus;

        // A draft photo becomes uploadable as soon as
        // an approved species completes the record.
        if (
          canUpload &&
          syncStatus === LOCAL_ONLY
        ) {
          syncStatus =
            NOT_UPLOADED as PlantPhotoEntry['syncStatus'];
          changed = true;
        }

        // A record that becomes an unfinished local draft
        // should not start uploading unsent photos.
        if (
          !canUpload &&
          syncStatus !== UPLOADED &&
          syncStatus !== LOCAL_ONLY
        ) {
          syncStatus =
            LOCAL_ONLY as PlantPhotoEntry['syncStatus'];
          changed = true;
        }

        return syncStatus === photo.syncStatus
          ? photo
          : {
              ...photo,
              syncStatus,
            };
      }
    );

    if (!changed) {
      return record;
    }

    return {
      ...record,
      photoEntries: entries,
      photoUris: entries.map(
        (photo) => photo.uri
      ),
    };
  }

  const legacyUris = (
    record.photoUris ?? []
  ).filter(Boolean);

  if (legacyUris.length === 0) {
    if (record.photoEntries) {
      return record;
    }

    return {
      ...record,
      photoEntries: [],
    };
  }

  // Records created before photo sync only stored URI order.
  // Best-effort migration:
  // 0 whole plant, 1 leaf, 2 flower, 3 bark.
  // These old photos have never been uploaded by this feature,
  // so complete records are deliberately marked pending.
  const entries: PlantPhotoEntry[] =
    legacyUris
      .slice(0, LEGACY_PHOTO_TYPES.length)
      .map((uri, index) => ({
        id: randomUUID(),
        uri,
        photoType: LEGACY_PHOTO_TYPES[index],
        syncStatus: canUpload
          ? (NOT_UPLOADED as PlantPhotoEntry['syncStatus'])
          : (LOCAL_ONLY as PlantPhotoEntry['syncStatus']),
      }));

  return {
    ...record,
    photoEntries: entries,
    photoUris: entries.map(
      (photo) => photo.uri
    ),
  };
}

function plantPayload(
  record: PlantRecord
): Record<string, unknown> {
  return {
    species_id: record.speciesId,
    qr_code_value: record.tagCode,
    latitude: record.latitude,
    longitude: record.longitude,
    gps_accuracy_m:
      record.gpsAccuracyM ?? null,
    location_description:
      record.locationName.trim(),
    morphology:
      record.morphology?.trim() || null,
    description:
      record.description?.trim() || null,
  };
}

function observationPayload(
  record: PlantRecord,
  observation: ObservationVisit
): Record<string, unknown> {
  return {
    ...(record.serverId
      ? { plant_id: record.serverId }
      : { plant_client_record_id: record.id }),
    observed_at:
      observation.observedAt ??
      new Date().toISOString(),
    notes:
      observation.notes?.trim() || null,
    height_cm:
      observation.heightCm ?? null,
    diameter_cm:
      observation.diameterCm ?? null,
    life_stage:
      observation.stage?.toLowerCase() ??
      null,
    health_status:
      observation.health?.toLowerCase() ??
      null,
    latitude: observation.latitude,
    longitude: observation.longitude,
    gps_accuracy_m:
      observation.gpsAccuracyM ?? null,
  };
}

function operationFor(
  serverId: string | undefined,
  rowVersion: number | undefined
): SyncOperationType {
  return serverId && rowVersion
    ? 'update'
    : 'create';
}

export async function getPlantMetadataSyncStatus(
  clientRecordId: string
): Promise<LocalSyncStatus | null> {
  const entities =
    await getLocalEntities<PlantRecord>(
      'plant'
    );

  return (
    entities.find(
      (entity) =>
        entity.clientRecordId ===
        clientRecordId
    )?.syncStatus ?? null
  );
}

export async function getObservationMetadataSyncStatus(
  clientRecordId: string
): Promise<LocalSyncStatus | null> {
  const entities =
    await getLocalEntities<ObservationVisit>(
      'observation'
    );

  return (
    entities.find(
      (entity) =>
        entity.clientRecordId ===
        clientRecordId
    )?.syncStatus ?? null
  );
}

export async function persistPlantRecord(
  record: PlantRecord,
  queueChange: boolean
): Promise<void> {
  const normalized =
    normalizePhotoEntries(record);

  const canUpload =
    recordCanUpload(normalized);

  const shouldQueue =
    queueChange && canUpload;

  const existingEntities =
    await getLocalEntities<PlantRecord>(
      'plant'
    );

  const existing =
    existingEntities.find(
      (entity) =>
        entity.clientRecordId ===
        normalized.id
    );

  let localStatus: LocalSyncStatus;

  if (!canUpload) {
    localStatus = 'local_only';
  } else if (shouldQueue) {
    localStatus = 'pending';
  } else if (existing) {
    // Important:
    // record.syncStatus is an aggregate that also includes photos.
    // The SQLite entity status represents PLANT METADATA only.
    localStatus = existing.syncStatus;
  } else {
    localStatus = toLocalStatus(
      normalized.syncStatus
    );
  }

  await saveEntityAndQueue({
    entityType: 'plant',
    clientRecordId: normalized.id,
    serverId:
      normalized.serverId ?? null,
    baseVersion:
      normalized.rowVersion ?? null,
    snapshot:
      normalized as unknown as Record<
        string,
        unknown
      >,
    syncStatus: localStatus,

    operationType: shouldQueue
      ? operationFor(
          normalized.serverId,
          normalized.rowVersion
        )
      : undefined,

    payload: shouldQueue
      ? plantPayload(normalized)
      : undefined,
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
    serverId:
      observation.serverId ?? null,
    baseVersion:
      observation.rowVersion ?? null,
    snapshot:
      observation as unknown as Record<
        string,
        unknown
      >,
    syncStatus: toLocalStatus(
      observation.syncStatus
    ),

    operationType: queueChange
      ? operationFor(
          observation.serverId,
          observation.rowVersion
        )
      : undefined,

    payload: queueChange
      ? observationPayload(
          record,
          observation
        )
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
  const normalized =
    normalizePhotoEntries(record);

  await persistPlantRecord(
    normalized,
    options.queuePlant ?? false
  );

  const queuedIds = new Set(
    options.queueObservationIds ?? []
  );

  for (
    const observation of
    normalized.observations
  ) {
    await persistObservation(
      normalized,
      observation,
      queuedIds.has(observation.id)
    );
  }
}

export async function loadOrMigrateRecords(
  cachedRecords: PlantRecord[]
): Promise<PlantRecord[]> {
  const storedPlants =
    await getLocalEntities<PlantRecord>(
      'plant'
    );

  if (storedPlants.length === 0) {
    const migratedRecords: PlantRecord[] =
      [];

    for (const original of cachedRecords) {
      const record =
        normalizePhotoEntries(original);

      const queuePlant =
        recordCanUpload(record) &&
        record.syncStatus !== UPLOADED;

      const queueObservationIds =
        record.observations
          .filter(
            (observation) =>
              queuePlant &&
              observation.syncStatus !==
                UPLOADED
          )
          .map(
            (observation) =>
              observation.id
          );

      await persistRecordSnapshot(record, {
        queuePlant,
        queueObservationIds,
      });

      migratedRecords.push(record);
    }

    return migratedRecords;
  }

  const normalizedPlants =
    [];

  for (const entity of storedPlants) {
    const before = JSON.stringify(
      entity.snapshot.photoEntries ?? null
    );

    const snapshot =
      normalizePhotoEntries(
        entity.snapshot
      );

    const after = JSON.stringify(
      snapshot.photoEntries ?? null
    );

    if (before !== after) {
      await persistPlantRecord(
        snapshot,
        false
      );
    }

    normalizedPlants.push({
      ...entity,
      snapshot,
    });
  }

  const storedObservations =
    await getLocalEntities<ObservationVisit>(
      'observation'
    );

  // Tags the server refused for each plant (tag in use / plant locked).
  const tagRefusals =
    await getPlantTagRefusals();

  const observationById = new Map(
    storedObservations.map((entity) => [
      entity.clientRecordId,
      entity,
    ])
  );

  return normalizedPlants.map(
    (entity) => {
      const snapshot =
        entity.snapshot;

      const observations = (
        snapshot.observations ?? []
      ).map((observation) => {
        const stored =
          observationById.get(
            observation.id
          );

        if (!stored) {
          return observation;
        }

        return {
          ...observation,
          serverId:
            stored.serverId ??
            observation.serverId,
          rowVersion:
            stored.rowVersion ??
            observation.rowVersion,
          syncStatus:
            toStoreStatus(
              stored.syncStatus
            ),
        };
      });

      const observationFailed =
        observations.some(
          (observation) =>
            observation.syncStatus ===
            FAILED
        );

      const observationPending =
        observations.some(
          (observation) =>
            observation.syncStatus !==
            UPLOADED
        );

      const photoEntries =
        snapshot.photoEntries ?? [];

      const photoFailed =
        photoEntries.some(
          (photo) =>
            photo.syncStatus === FAILED
        );

      const photoPending =
        photoEntries.some(
          (photo) =>
            photo.syncStatus !==
            UPLOADED
        );

      const plantStatus =
        toStoreStatus(
          entity.syncStatus
        );

      const aggregateStatus =
        plantStatus === LOCAL_ONLY
          ? LOCAL_ONLY
          : plantStatus === FAILED ||
              observationFailed ||
              photoFailed
            ? FAILED
            : plantStatus ===
                  UPLOADED &&
                !observationPending &&
                !photoPending
              ? UPLOADED
              : NOT_UPLOADED;

      const tagRefusal =
        tagRefusals.get(
          entity.clientRecordId
        );

      return {
        ...snapshot,
        tagProblem:
          tagRefusal === 'tag_in_use'
            ? 'in_use'
            : tagRefusal === 'plant_locked'
              ? 'locked'
              : null,
        serverId:
          entity.serverId ??
          snapshot.serverId,
        rowVersion:
          entity.rowVersion ??
          snapshot.rowVersion,
        syncStatus:
          aggregateStatus as PlantRecord['syncStatus'],
        observations,
        photoEntries,
        photoUris:
          photoEntries.map(
            (photo) => photo.uri
          ),
      };
    }
  );
}