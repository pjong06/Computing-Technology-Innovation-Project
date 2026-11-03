import { randomUUID } from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

export type SyncEntityType = 'plant' | 'observation';
export type SyncOperationType = 'create' | 'update' | 'delete';

export type LocalSyncStatus =
  | 'local_only'
  | 'pending'
  | 'uploaded'
  | 'failed'
  | 'conflict';

export type OutboxStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'failed'
  | 'conflict'
  | 'complete';

export interface LocalEntity<T = Record<string, unknown>> {
  entityType: SyncEntityType;
  clientRecordId: string;
  serverId: string | null;
  rowVersion: number | null;
  syncStatus: LocalSyncStatus;
  snapshot: T;
  createdAt: string;
  updatedAt: string;
}

export interface OutboxOperation {
  operationId: string;
  entityType: SyncEntityType;
  operationType: SyncOperationType;
  clientRecordId: string;
  baseVersion: number | null;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveEntityInput {
  entityType: SyncEntityType;
  clientRecordId: string;
  serverId?: string | null;
  snapshot: Record<string, unknown>;
  syncStatus: LocalSyncStatus;

  operationType?: SyncOperationType;
  baseVersion?: number | null;
  payload?: Record<string, unknown>;
}

export interface SyncOperationResult {
  operation_id: string;
  status: 'success' | 'retry' | 'failed' | 'conflict';
  server_id?: string;
  row_version?: number;
  message?: string;
  code?: string;
}

interface LocalEntityRow {
  entity_type: SyncEntityType;
  client_record_id: string;
  server_id: string | null;
  row_version: number | null;
  sync_status: LocalSyncStatus;
  snapshot_json: string;
  created_at: string;
  updated_at: string;
}

interface OutboxRow {
  operation_id: string;
  entity_type: SyncEntityType;
  operation_type: SyncOperationType;
  client_record_id: string;
  base_version: number | null;
  payload_json: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const DATABASE_NAME = 'niah-biotrack.db';
const DATABASE_VERSION = 1;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initializationPromise: Promise<void> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME);
  }

  return databasePromise;
}

export async function initializeOfflineDatabase(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const db = await getDatabase();

    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS local_entities (
        entity_type TEXT NOT NULL
          CHECK (entity_type IN ('plant', 'observation')),

        client_record_id TEXT NOT NULL,
        server_id TEXT,
        row_version INTEGER,

        sync_status TEXT NOT NULL
          CHECK (
            sync_status IN (
              'local_only',
              'pending',
              'uploaded',
              'failed',
              'conflict'
            )
          ),

        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        PRIMARY KEY (entity_type, client_record_id)
      );

      CREATE TABLE IF NOT EXISTS sync_outbox (
        operation_id TEXT PRIMARY KEY NOT NULL,

        entity_type TEXT NOT NULL
          CHECK (entity_type IN ('plant', 'observation')),

        operation_type TEXT NOT NULL
          CHECK (operation_type IN ('create', 'update', 'delete')),

        client_record_id TEXT NOT NULL,
        base_version INTEGER,
        payload_json TEXT NOT NULL,

        status TEXT NOT NULL
          CHECK (
            status IN (
              'pending',
              'processing',
              'retry',
              'failed',
              'conflict',
              'complete'
            )
          ),

        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        state_key TEXT PRIMARY KEY NOT NULL,
        state_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_local_entities_status
        ON local_entities(sync_status);

      CREATE INDEX IF NOT EXISTS idx_sync_outbox_ready
        ON sync_outbox(status, created_at);

      CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity
        ON sync_outbox(entity_type, client_record_id, created_at);

      PRAGMA user_version = ${DATABASE_VERSION};
    `);
  })();

  try {
    await initializationPromise;
  } catch (error) {
    initializationPromise = null;
    throw error;
  }
}

/**
 * Saves the local entity and its outbox operation inside one transaction.
 *
 * For local drafts, omit operationType and payload. The entity will be saved
 * locally but will not be queued for server upload.
 */
export async function saveEntityAndQueue(
  input: SaveEntityInput
): Promise<void> {
  await initializeOfflineDatabase();

  const db = await getDatabase();
  const timestamp = nowIso();

  await db.withExclusiveTransactionAsync(async (transaction) => {
    const existing = await transaction.getFirstAsync<{
      created_at: string;
    }>(
      `
        SELECT created_at
        FROM local_entities
        WHERE entity_type = ?
          AND client_record_id = ?
      `,
      input.entityType,
      input.clientRecordId
    );

    await transaction.runAsync(
      `
        INSERT INTO local_entities (
          entity_type,
          client_record_id,
          server_id,
          row_version,
          sync_status,
          snapshot_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, client_record_id)
        DO UPDATE SET
          server_id = COALESCE(
            excluded.server_id,
            local_entities.server_id
          ),
          row_version = COALESCE(
            excluded.row_version,
            local_entities.row_version
          ),
          sync_status = excluded.sync_status,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `,
      input.entityType,
      input.clientRecordId,
      input.serverId ?? null,
      input.baseVersion ?? null,
      input.syncStatus,
      JSON.stringify(input.snapshot),
      existing?.created_at ?? timestamp,
      timestamp
    );

    if (!input.operationType || !input.payload) {
      if (input.syncStatus === 'local_only') {
        await transaction.runAsync(
          `
            UPDATE sync_outbox
            SET status = 'complete',
                last_error = 'Superseded by a local draft',
                updated_at = ?
            WHERE entity_type = ?
              AND client_record_id = ?
              AND status IN ('pending', 'processing', 'retry')
          `,
          timestamp,
          input.entityType,
          input.clientRecordId
        );
      }
      return;
    }

    /*
     * If a record was created offline and then edited again before its create
     * operation was uploaded, update the existing create payload instead of
     * adding an update operation that has no server row_version yet.
     */
    if (input.operationType === 'update') {
      const pendingCreate =
        await transaction.getFirstAsync<OutboxRow>(
          `
            SELECT *
            FROM sync_outbox
            WHERE entity_type = ?
              AND client_record_id = ?
              AND operation_type = 'create'
              AND status IN ('pending', 'retry')
            ORDER BY created_at ASC
            LIMIT 1
          `,
          input.entityType,
          input.clientRecordId
        );

      if (pendingCreate) {
        const previousPayload = parseJson<Record<string, unknown>>(
          pendingCreate.payload_json
        );

        await transaction.runAsync(
          `
            UPDATE sync_outbox
            SET payload_json = ?,
                status = 'pending',
                last_error = NULL,
                updated_at = ?
            WHERE operation_id = ?
          `,
          JSON.stringify({
            ...previousPayload,
            ...input.payload,
          }),
          timestamp,
          pendingCreate.operation_id
        );

        return;
      }

      /*
       * Several offline edits to the same uploaded record are represented by
       * one latest pending update operation.
       */
      const pendingUpdate =
        await transaction.getFirstAsync<OutboxRow>(
          `
            SELECT *
            FROM sync_outbox
            WHERE entity_type = ?
              AND client_record_id = ?
              AND operation_type = 'update'
              AND status IN ('pending', 'retry')
            ORDER BY created_at DESC
            LIMIT 1
          `,
          input.entityType,
          input.clientRecordId
        );

      if (pendingUpdate) {
        const previousPayload = parseJson<Record<string, unknown>>(
          pendingUpdate.payload_json
        );

        await transaction.runAsync(
          `
            UPDATE sync_outbox
            SET payload_json = ?,
                base_version = ?,
                status = 'pending',
                last_error = NULL,
                updated_at = ?
            WHERE operation_id = ?
          `,
          JSON.stringify({
            ...previousPayload,
            ...input.payload,
          }),
          input.baseVersion ?? pendingUpdate.base_version,
          timestamp,
          pendingUpdate.operation_id
        );

        return;
      }
    }

    const operationId = randomUUID();

    await transaction.runAsync(
      `
        INSERT INTO sync_outbox (
          operation_id,
          entity_type,
          operation_type,
          client_record_id,
          base_version,
          payload_json,
          status,
          attempts,
          last_error,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)
      `,
      operationId,
      input.entityType,
      input.operationType,
      input.clientRecordId,
      input.baseVersion ?? null,
      JSON.stringify(input.payload),
      timestamp,
      timestamp
    );
  });
}

export async function getLocalEntities<T = Record<string, unknown>>(
  entityType?: SyncEntityType
): Promise<LocalEntity<T>[]> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  const rows = entityType
    ? await db.getAllAsync<LocalEntityRow>(
        `
          SELECT *
          FROM local_entities
          WHERE entity_type = ?
          ORDER BY updated_at DESC
        `,
        entityType
      )
    : await db.getAllAsync<LocalEntityRow>(
        `
          SELECT *
          FROM local_entities
          ORDER BY updated_at DESC
        `
      );

  return rows.map((row) => ({
    entityType: row.entity_type,
    clientRecordId: row.client_record_id,
    serverId: row.server_id,
    rowVersion: row.row_version,
    syncStatus: row.sync_status,
    snapshot: parseJson<T>(row.snapshot_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getReadyOutboxOperations(
  limit = 50
): Promise<OutboxOperation[]> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  /*
   * A previous app shutdown may leave an operation as processing. It is safe
   * to retry because the server stores operation_id for idempotency.
   */
  await db.runAsync(
    `
      UPDATE sync_outbox
      SET status = 'retry',
          updated_at = ?
      WHERE status = 'processing'
    `,
    nowIso()
  );

  const rows = await db.getAllAsync<OutboxRow>(
    `
      SELECT *
      FROM sync_outbox
      WHERE status IN ('pending', 'retry')
      ORDER BY created_at ASC
      LIMIT ?
    `,
    limit
  );

  return rows.map((row) => ({
    operationId: row.operation_id,
    entityType: row.entity_type,
    operationType: row.operation_type,
    clientRecordId: row.client_record_id,
    baseVersion: row.base_version,
    payload: parseJson<Record<string, unknown>>(row.payload_json),
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function markOperationsProcessing(
  operationIds: string[]
): Promise<void> {
  if (operationIds.length === 0) {
    return;
  }

  await initializeOfflineDatabase();

  const db = await getDatabase();
  const timestamp = nowIso();

  await db.withExclusiveTransactionAsync(async (transaction) => {
    for (const operationId of operationIds) {
      await transaction.runAsync(
        `
          UPDATE sync_outbox
          SET status = 'processing',
              attempts = attempts + 1,
              updated_at = ?
          WHERE operation_id = ?
            AND status IN ('pending', 'retry')
        `,
        timestamp,
        operationId
      );
    }
  });
}

export async function applySyncOperationResult(
  result: SyncOperationResult
): Promise<void> {
  await initializeOfflineDatabase();

  const db = await getDatabase();
  const timestamp = nowIso();

  await db.withExclusiveTransactionAsync(async (transaction) => {
    const operation = await transaction.getFirstAsync<OutboxRow>(
      `
        SELECT *
        FROM sync_outbox
        WHERE operation_id = ?
      `,
      result.operation_id
    );

    if (!operation) {
      return;
    }

    if (result.status === 'success') {
      await transaction.runAsync(
        `
          UPDATE sync_outbox
          SET status = 'complete',
              last_error = NULL,
              updated_at = ?
          WHERE operation_id = ?
        `,
        timestamp,
        result.operation_id
      );

      const laterOperation = await transaction.getFirstAsync<{
        operation_id: string;
      }>(
        `
          SELECT operation_id
          FROM sync_outbox
          WHERE entity_type = ?
            AND client_record_id = ?
            AND operation_id <> ?
            AND status IN ('pending', 'processing', 'retry')
          LIMIT 1
        `,
        operation.entity_type,
        operation.client_record_id,
        result.operation_id
      );

      await transaction.runAsync(
        `
          UPDATE local_entities
          SET server_id = COALESCE(?, server_id),
              row_version = COALESCE(?, row_version),
              sync_status = ?,
              updated_at = ?
          WHERE entity_type = ?
            AND client_record_id = ?
        `,
        result.server_id ?? null,
        result.row_version ?? null,
        laterOperation ? 'pending' : 'uploaded',
        timestamp,
        operation.entity_type,
        operation.client_record_id
      );

      return;
    }

    const outboxStatus: OutboxStatus =
      result.status === 'retry'
        ? 'retry'
        : result.status === 'conflict'
          ? 'conflict'
          : 'failed';

    const localStatus: LocalSyncStatus =
      result.status === 'retry'
        ? 'pending'
        : result.status === 'conflict'
          ? 'conflict'
          : 'failed';

    await transaction.runAsync(
      `
        UPDATE sync_outbox
        SET status = ?,
            last_error = ?,
            updated_at = ?
        WHERE operation_id = ?
      `,
      outboxStatus,
      result.message ?? result.code ?? 'Synchronization failed',
      timestamp,
      result.operation_id
    );

    await transaction.runAsync(
      `
        UPDATE local_entities
        SET sync_status = ?,
            updated_at = ?
        WHERE entity_type = ?
          AND client_record_id = ?
      `,
      localStatus,
      timestamp,
      operation.entity_type,
      operation.client_record_id
    );
  });
}

export async function retryFailedOperations(): Promise<void> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  await db.runAsync(
    `
      UPDATE sync_outbox
      SET status = 'retry',
          last_error = NULL,
          updated_at = ?
      WHERE status = 'failed'
    `,
    nowIso()
  );

  await db.runAsync(
    `
      UPDATE local_entities
      SET sync_status = 'pending',
          updated_at = ?
      WHERE sync_status = 'failed'
    `,
    nowIso()
  );
}

export async function getSyncCursor(): Promise<number> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  const row = await db.getFirstAsync<{ state_value: string }>(
    `
      SELECT state_value
      FROM sync_state
      WHERE state_key = 'server_cursor'
    `
  );

  const cursor = Number(row?.state_value ?? 0);

  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
}

export async function setSyncCursor(cursor: number): Promise<void> {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error('Sync cursor must be a non-negative integer');
  }

  await initializeOfflineDatabase();

  const db = await getDatabase();
  const timestamp = nowIso();

  await db.runAsync(
    `
      INSERT INTO sync_state (
        state_key,
        state_value,
        updated_at
      )
      VALUES ('server_cursor', ?, ?)
      ON CONFLICT(state_key)
      DO UPDATE SET
        state_value = excluded.state_value,
        updated_at = excluded.updated_at
    `,
    String(cursor),
    timestamp
  );
}

export async function setLastSuccessfulSync(
  completedAt = nowIso()
): Promise<void> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  await db.runAsync(
    `
      INSERT INTO sync_state (
        state_key,
        state_value,
        updated_at
      )
      VALUES ('last_successful_sync', ?, ?)
      ON CONFLICT(state_key)
      DO UPDATE SET
        state_value = excluded.state_value,
        updated_at = excluded.updated_at
    `,
    completedAt,
    completedAt
  );
}

export async function getLastSuccessfulSync(): Promise<string | null> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  const row = await db.getFirstAsync<{ state_value: string }>(
    `
      SELECT state_value
      FROM sync_state
      WHERE state_key = 'last_successful_sync'
    `
  );

  return row?.state_value ?? null;
}

export async function clearOfflineDatabase(): Promise<void> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(`
      DELETE FROM sync_outbox;
      DELETE FROM sync_state;
      DELETE FROM local_entities;
    `);
  });
}
