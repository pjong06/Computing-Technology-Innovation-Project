import { ApiError, apiFetch } from '../api/client';
import {
  applySyncOperationResult,
  getReadyOutboxOperations,
  markOperationsProcessing,
  retryFailedOperations,
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

async function runPush(): Promise<SyncRunResult> {
  await retryFailedOperations();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let conflicts = 0;

  while (true) {
    const operations = await getReadyOutboxOperations(50);
    if (operations.length === 0) {
      if (processed > 0) await setLastSuccessfulSync();
      return {
        processed,
        succeeded,
        failed,
        conflicts,
        remaining: false,
      };
    }

    const operationIds = operations.map((operation) => operation.operationId);
    await markOperationsProcessing(operationIds);

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

      for (const operation of operations) {
        await applySyncOperationResult({
          operation_id: operation.operationId,
          status: 'retry',
          message,
        });
      }

      return {
        processed,
        succeeded,
        failed,
        conflicts,
        remaining: true,
        error: message,
      };
    }

    const received = new Set<string>();
    for (const result of response.results ?? []) {
      if (!result.operation_id) continue;
      received.add(result.operation_id);
      await applySyncOperationResult(result);
      processed += 1;
      if (result.status === 'success') succeeded += 1;
      else if (result.status === 'conflict') conflicts += 1;
      else failed += 1;
    }

    // A missing result must not strand an operation in Processing.
    for (const operation of operations) {
      if (received.has(operation.operationId)) continue;
      await applySyncOperationResult({
        operation_id: operation.operationId,
        status: 'retry',
        message: 'The server did not return a result for this operation.',
      });
      failed += 1;
    }

    // Stop after permanent failures/conflicts so the UI can show attention is
    // required instead of immediately looping over the same batch.
    if (failed > 0 || conflicts > 0) {
      return {
        processed,
        succeeded,
        failed,
        conflicts,
        remaining: true,
      };
    }
  }
}

export function runOutboxSync(): Promise<SyncRunResult> {
  if (activeSync) return activeSync;

  activeSync = runPush().finally(() => {
    activeSync = null;
  });
  return activeSync;
}
