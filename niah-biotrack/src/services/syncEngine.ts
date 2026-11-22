import { ApiError, apiFetch } from '../api/client';
import { isSyncOffline, requestSyncRetry } from './syncRetry';
import {
  applySyncOperationResult,
  claimOutboxOperations,
  getReadyOutboxOperations,
  getUploadedPlantsQueuedAsCreate,
  rebaseQueuedCreateAsUpdate,
  requeueLockedTagOperations,
  setLastSuccessfulSync,
  type OutboxOperation,
  type SyncOperationResult,
} from './offlineDatabase';

interface PushResponse {
  results: SyncOperationResult[];
  summary: {
    success: number;
    conflict: number;
    failed: number;
    retry: number;
  };
}

export interface SyncRunResult {
  processed: number;
  succeeded: number;
  failed: number;
  conflicts: number;
  remaining: boolean;
  error?: string;
}

let activeSync: Promise<SyncRunResult> | null = null;

function toApiOperation(operation: OutboxOperation) {
  return {
    operation_id: operation.operationId,
    entity_type: operation.entityType,
    operation_type: operation.operationType,
    client_record_id: operation.clientRecordId,
    base_version: operation.baseVersion,
    payload: operation.payload,
  };
}

// Plants uploaded before the outbox existed have a server ID but no row_version, so
// their changes were queued as creates (which the server answers without changing
// anything). Look up each one's current version and send the change as an update.
// If the lookup fails (offline, plant gone), the operation is left as it was.
async function adoptServerVersions(): Promise<void> {
  const plants = await getUploadedPlantsQueuedAsCreate();

  for (const plant of plants) {
    try {
      const response = await apiFetch<{ row_version?: number }>(
        `/api/plants/${encodeURIComponent(plant.serverId)}`
      );
      if (
        typeof response.row_version === 'number' &&
        response.row_version > 0
      ) {
        await rebaseQueuedCreateAsUpdate(
          plant.clientRecordId,
          response.row_version
        );
      }
    } catch {
      // Try again on the next sync.
    }
  }
}

async function runPush(): Promise<SyncRunResult> {
  if (await isSyncOffline()) {
    return { processed: 0, succeeded: 0, failed: 0, conflicts: 0, remaining: false, error: 'Waiting for an internet connection.' };
  }
  await adoptServerVersions();
  // Tags attached after submission that were refused before the server allowed it.
  await requeueLockedTagOperations();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let conflicts = 0;
  let remaining = false;

  while (true) {
    const queued = await getReadyOutboxOperations(50);
    if (queued.length === 0) break;
    const operations = await claimOutboxOperations(queued.map((operation) => operation.operationId));
    if (operations.length === 0) continue;
    const operationIds = operations.map((operation) => operation.operationId);

    let response: PushResponse;
    try {
      response = await apiFetch<PushResponse>('/api/sync/push', {
        method: 'POST',
        body: { operations: operations.map(toApiOperation) },
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Synchronization failed unexpectedly.';
      const status = error instanceof ApiError ? error.status : 0;
      const retryable = isRetryableStatus(status);

      for (const operation of operations) {
        await applySyncOperationResult({
          operation_id: operation.operationId,
          status: retryable ? 'retry' : 'failed',
          message,
          // For Sync details: no answer at all, or the HTTP status the server gave.
          code: status === 0 ? 'network' : `http_${status}`,
          retryAfterMs: error instanceof ApiError ? error.retryAfterMs : undefined,
        });
      }

      return {
        processed: processed + operations.length,
        succeeded,
        failed: failed + operations.length,
        conflicts,
        remaining: retryable,
        error: message,
      };
    }

    const expected = new Set(operationIds);
    const received = new Set<string>();
    for (const result of response?.results ?? []) {
      if (!expected.has(result.operation_id) || received.has(result.operation_id)) continue;
      received.add(result.operation_id);
      await applySyncOperationResult(result);
      processed += 1;
      if (result.status === 'success') succeeded += 1;
      else if (result.status === 'conflict') conflicts += 1;
      else failed += 1;
      if (result.status === 'retry') remaining = true;
    }

    // A missing result must not strand an operation in Processing.
    for (const operation of operations) {
      if (received.has(operation.operationId)) continue;
      await applySyncOperationResult({
        operation_id: operation.operationId,
        status: 'retry',
        message: 'The server did not return a result for this operation.',
        code: 'no_result',
      });
      processed += 1;
      failed += 1;
      remaining = true;
    }
  }

  if (succeeded > 0 && failed === 0 && conflicts === 0) await setLastSuccessfulSync();
  return { processed, succeeded, failed, conflicts, remaining };
}

export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}
export function runOutboxSync(): Promise<SyncRunResult> {
  if (activeSync) return activeSync;

  activeSync = runPush().then((result) => {
    if (result.remaining) requestSyncRetry();
    return result;
  }).finally(() => {
    activeSync = null;
  });
  return activeSync;
}
