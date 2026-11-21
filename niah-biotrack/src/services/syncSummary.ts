import { SyncStatus, type PlantRecord } from '../store/useRecordStore';

export type SyncStatusTone = 'neutral' | 'pending' | 'failed' | 'synced';

export interface SyncSummary {
  uploadedRecordCount: number;
  pendingRecordCount: number;
  failedRecordCount: number;
  localDraftCount: number;

  uploadedObservationCount: number;
  pendingObservationCount: number;
  failedObservationCount: number;

  pendingItemCount: number;
  failedItemCount: number;
  unsyncedRecordCount: number;

  overallStatus: string;
  overallMessage: string;
  overallTone: SyncStatusTone;
  observationSummary: string;
}

export function buildSyncSummary(
  records: PlantRecord[],
  isSyncing = false
): SyncSummary {
  const uploadedRecordCount = records.filter(
    (record) => record.syncStatus === SyncStatus.UPLOADED
  ).length;

  const pendingRecordCount = records.filter(
    (record) => record.syncStatus === SyncStatus.NOT_UPLOADED
  ).length;

  const failedRecordCount = records.filter(
    (record) => record.syncStatus === SyncStatus.FAILED
  ).length;

  const localDraftCount = records.filter(
    (record) => record.syncStatus === SyncStatus.LOCAL_ONLY
  ).length;

  const observations = records.flatMap((record) => record.observations);

  const uploadedObservationCount = observations.filter(
    (observation) => observation.syncStatus === SyncStatus.UPLOADED
  ).length;

  const pendingObservationCount = observations.filter(
    (observation) => observation.syncStatus === SyncStatus.NOT_UPLOADED
  ).length;

  const failedObservationCount = observations.filter(
    (observation) => observation.syncStatus === SyncStatus.FAILED
  ).length;

  const pendingItemCount =
    pendingRecordCount + pendingObservationCount;

  const failedItemCount =
    failedRecordCount + failedObservationCount;

  const unsyncedRecordCount = records.filter(
    (record) =>
      record.syncStatus !== SyncStatus.UPLOADED ||
      record.observations.some(
        (observation) =>
          observation.syncStatus !== SyncStatus.UPLOADED
      )
  ).length;

  let overallStatus = 'No records';
  let overallMessage =
    'Create a plant record to start the local sync queue.';
  let overallTone: SyncStatusTone = 'neutral';

  if (isSyncing) {
    overallStatus = 'Syncing...';
    overallMessage =
      'The application is processing local records and observations.';
    overallTone = 'pending';
  } else if (failedItemCount > 0) {
    overallStatus = 'Attention needed';
    overallMessage = `${failedItemCount} ${
      failedItemCount === 1 ? 'item has' : 'items have'
    } an upload failure.`;
    overallTone = 'failed';
  } else if (pendingItemCount > 0) {
    overallStatus = `${pendingItemCount} pending`;
    overallMessage =
      'Pending data is saved on this device and waiting for server upload.';
    overallTone = 'pending';
  } else if (localDraftCount > 0) {
    overallStatus = `${localDraftCount} local ${localDraftCount === 1 ? 'draft' : 'drafts'}`;
    overallMessage =
      'Draft field records remain on this device until their species identification is completed.';
    overallTone = 'neutral';
  } else if (records.length > 0) {
    overallStatus = 'Up to date';
    overallMessage =
      'All local records and observations have an uploaded status.';
    overallTone = 'synced';
  }

  let observationSummary = 'None recorded';

  if (observations.length > 0) {
    if (failedObservationCount > 0) {
      observationSummary =
        `${pendingObservationCount} pending · ` +
        `${failedObservationCount} failed`;
    } else if (pendingObservationCount > 0) {
      observationSummary = `${pendingObservationCount} pending`;
    } else {
      observationSummary = `${uploadedObservationCount} uploaded`;
    }
  }

  return {
    uploadedRecordCount,
    pendingRecordCount,
    failedRecordCount,
    localDraftCount,

    uploadedObservationCount,
    pendingObservationCount,
    failedObservationCount,

    pendingItemCount,
    failedItemCount,
    unsyncedRecordCount,

    overallStatus,
    overallMessage,
    overallTone,
    observationSummary,
  };
}
