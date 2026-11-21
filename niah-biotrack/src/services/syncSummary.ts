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
    'Nothing to upload yet.';
  let overallTone: SyncStatusTone = 'neutral';

  if (isSyncing) {
    overallStatus = 'Syncing...';
    overallMessage =
      'Uploading your plants and observations…';
    overallTone = 'pending';
  } else if (failedItemCount > 0) {
    overallStatus = 'Attention needed';
    overallMessage = `${failedItemCount} ${
      failedItemCount === 1 ? 'item has' : 'items have'
    } an upload failure.`;
    overallTone = 'failed';
  } else if (pendingItemCount > 0) {
    overallStatus = `${pendingItemCount} waiting to upload`;
    overallMessage =
      'Data waiting to upload is saved on this device.';
    overallTone = 'pending';
  } else if (localDraftCount > 0) {
    overallStatus = `${localDraftCount} local ${localDraftCount === 1 ? 'draft' : 'drafts'}`;
    overallMessage =
      'Draft field records remain on this device until their species identification is completed.';
    overallTone = 'neutral';
  } else if (records.length > 0) {
    overallStatus = 'Up to date';
    overallMessage =
      'Everything is uploaded.';
    overallTone = 'synced';
  }

  let observationSummary = 'None recorded';

  if (observations.length > 0) {
    if (failedObservationCount > 0) {
      observationSummary =
        `${pendingObservationCount} waiting to upload · ` +
        `${failedObservationCount} failed`;
    } else if (pendingObservationCount > 0) {
      observationSummary = `${pendingObservationCount} waiting to upload`;
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
