import { randomUUID } from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

export type SyncEntityType = 'plant' | 'observation' | 'proposal';
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
  snapshot?: Record<string, unknown>;
  retryAfterMs?: number;
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
  retry_count: number;
  next_retry_at: number | null;
  created_at: string;
  updated_at: string;
}

const DATABASE_NAME = 'niah-biotrack.db';
const DATABASE_VERSION = 3;
const RETRY_DELAYS_MS = [30_000, 120_000, 300_000];

const READY_DEPENDENCIES = `
  AND (
    entity_type <> 'observation'
    OR operation_type <> 'create'
    OR json_extract(payload_json, '$.plant_client_record_id') IS NULL
    OR EXISTS (
      SELECT 1 FROM local_entities AS plant
      WHERE plant.entity_type = 'plant'
        AND plant.client_record_id = json_extract(sync_outbox.payload_json, '$.plant_client_record_id')
        AND plant.server_id IS NOT NULL
    )
  )
`;

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

    const tables = `
      CREATE TABLE IF NOT EXISTS local_entities (
        entity_type TEXT NOT NULL
          CHECK (entity_type IN ('plant', 'observation', 'proposal')),

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
          CHECK (entity_type IN ('plant', 'observation', 'proposal')),

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
    `;

    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await db.withExclusiveTransactionAsync(async (transaction) => {
      const version = await transaction.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if (version?.user_version === 1) {
        await transaction.execAsync(`
          ALTER TABLE local_entities RENAME TO local_entities_v1;
          ALTER TABLE sync_outbox RENAME TO sync_outbox_v1;
          ${tables}
          INSERT INTO local_entities SELECT * FROM local_entities_v1;
          INSERT INTO sync_outbox SELECT * FROM sync_outbox_v1;
          DROP TABLE local_entities_v1;
          DROP TABLE sync_outbox_v1;
        `);
      }
      await transaction.execAsync(`
      ${tables}
      CREATE INDEX IF NOT EXISTS idx_local_entities_status
        ON local_entities(sync_status);

      CREATE INDEX IF NOT EXISTS idx_sync_outbox_ready
        ON sync_outbox(status, created_at);

      CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity
        ON sync_outbox(entity_type, client_record_id, created_at);

      `);
      if ((version?.user_version ?? 0) < DATABASE_VERSION) {
        await transaction.execAsync(`
          ALTER TABLE sync_outbox ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE sync_outbox ADD COLUMN next_retry_at INTEGER;
          UPDATE sync_outbox SET next_retry_at = 0 WHERE status = 'retry';
          PRAGMA user_version = ${DATABASE_VERSION};
        `);
      }
      // The previous process may have stopped before storing a response.
      await transaction.execAsync(`
        UPDATE sync_outbox SET status = 'retry', next_retry_at = COALESCE(next_retry_at, 0)
        WHERE status = 'processing';
      `);
    });
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
      if (input.entityType === 'proposal' && input.syncStatus === 'uploaded') {
        await transaction.runAsync(
          `UPDATE sync_outbox SET status = 'complete', last_error = NULL, updated_at = ?
            WHERE entity_type = 'proposal' AND client_record_id = ?`,
          timestamp,
          input.clientRecordId
        );
      }
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
  limit = 50,
  queue: 'records' | 'proposals' = 'records',
  proposalId: string | null = null
): Promise<OutboxOperation[]> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  const rows = await db.getAllAsync<OutboxRow>(
    `
      SELECT *
      FROM sync_outbox
      WHERE (status = 'pending' OR (status = 'retry' AND next_retry_at <= ?))
        AND (entity_type = 'proposal') = ?
        AND (? IS NULL OR client_record_id = ?)
        ${READY_DEPENDENCIES}
      ORDER BY created_at ASC, rowid ASC
      LIMIT ?
    `,
    Date.now(),
    queue === 'proposals' ? 1 : 0,
    proposalId,
    proposalId,
    limit
  );

  return rows.map(toOutboxOperation);
}

export async function getNextOutboxRetryAt(): Promise<number | null> {
  await initializeOfflineDatabase();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ next_at: number | null }>(`
    SELECT MIN(next_retry_at) AS next_at FROM sync_outbox
    WHERE status = 'retry' AND next_retry_at IS NOT NULL
    ${READY_DEPENDENCIES}
  `);
  return row?.next_at ?? null;
}

export async function resumePausedRecordRetries(plantId: string, observationIds: string[]): Promise<void> {
  await initializeOfflineDatabase();
  const db = await getDatabase();
  await db.runAsync(`
    UPDATE sync_outbox SET retry_count = 0, next_retry_at = 0
    WHERE status = 'retry' AND next_retry_at IS NULL AND (
      (entity_type = 'plant' AND client_record_id = ?) OR
      (entity_type = 'observation' AND client_record_id IN (SELECT value FROM json_each(?)))
    )
  `, plantId, JSON.stringify(observationIds));
}

function toOutboxOperation(row: OutboxRow): OutboxOperation {
  return {
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
  };
}

export async function claimOutboxOperations(
  operationIds: string[]
): Promise<OutboxOperation[]> {
  if (operationIds.length === 0) return [];

  await initializeOfflineDatabase();

  const db = await getDatabase();
  const timestamp = nowIso();
  const claimed: OutboxOperation[] = [];

  await db.withExclusiveTransactionAsync(async (transaction) => {
    for (const operationId of operationIds) {
      const row = await transaction.getFirstAsync<OutboxRow>(
        `
          UPDATE sync_outbox
          SET status = 'processing',
              attempts = attempts + 1,
              updated_at = ?
          WHERE operation_id = ?
            AND (status = 'pending' OR (status = 'retry' AND next_retry_at <= ?))
            ${READY_DEPENDENCIES}
          RETURNING *
        `,
        timestamp,
        operationId,
        Date.now()
      );
      if (row) claimed.push(toOutboxOperation(row));
    }
  });
  return claimed;
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

    if (operation?.status !== 'processing') {
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
              snapshot_json = COALESCE(?, snapshot_json),
              sync_status = ?,
              updated_at = ?
          WHERE entity_type = ?
            AND client_record_id = ?
        `,
        result.server_id ?? null,
        result.row_version ?? null,
        result.snapshot ? JSON.stringify(result.snapshot) : null,
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

    const delay = RETRY_DELAYS_MS[operation.retry_count];
    const nextRetryAt = result.status === 'retry' && delay !== undefined
      ? Date.now() + Math.max(delay, result.retryAfterMs ?? 0)
      : null;
    const localStatus: LocalSyncStatus =
      result.status === 'retry'
        ? (nextRetryAt === null ? 'failed' : 'pending')
        : result.status === 'conflict'
          ? 'conflict'
          : 'failed';

    await transaction.runAsync(
      `
        UPDATE sync_outbox
        SET status = ?,
            last_error = ?,
            retry_count = ?,
            next_retry_at = ?,
            updated_at = ?
        WHERE operation_id = ?
      `,
      outboxStatus,
      // Tag refusals keep their code, so the plant screen can explain them
      // (see getPlantTagRefusals). Everything else keeps the server's message.
      result.code && TAG_REFUSAL_CODES.has(result.code)
        ? result.code
        : (result.message ?? result.code ?? 'Synchronization failed'),
      operation.retry_count + (result.status === 'retry' && nextRetryAt !== null ? 1 : 0),
      nextRetryAt,
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

export async function removeLocalProposal(id: string): Promise<void> {
  await initializeOfflineDatabase();
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      "DELETE FROM sync_outbox WHERE entity_type = 'proposal' AND client_record_id = ?",
      id
    );
    await transaction.runAsync(
      "DELETE FROM local_entities WHERE entity_type = 'proposal' AND client_record_id = ?",
      id
    );
  });
}

export async function clearLocalProposals(): Promise<void> {
  await initializeOfflineDatabase();
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(`
      DELETE FROM sync_outbox WHERE entity_type = 'proposal';
      DELETE FROM local_entities WHERE entity_type = 'proposal';
    `);
  });
}

// Server codes for a plant tag it refused (backend/src/routes/sync.js). They come
// back as 'conflict', which the outbox leaves alone: sending the same
// tag again would fail the same way. Attaching another tag queues a new operation.
export type TagRefusalCode = 'tag_in_use' | 'plant_locked';

const TAG_REFUSAL_CODES = new Set<string>(['tag_in_use', 'plant_locked']);

/**
 * Plants whose LATEST outbox operation was a refused tag, by client record ID.
 * A later operation (e.g. a different tag) replaces the old refusal.
 */
export async function getPlantTagRefusals(): Promise<
  Map<string, TagRefusalCode>
> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  const rows = await db.getAllAsync<{
    client_record_id: string;
    status: OutboxStatus;
    last_error: string | null;
  }>(
    `
      SELECT o.client_record_id, o.status, o.last_error
      FROM sync_outbox o
      WHERE o.entity_type = 'plant'
        AND o.created_at = (
          SELECT MAX(latest.created_at)
          FROM sync_outbox latest
          WHERE latest.entity_type = 'plant'
            AND latest.client_record_id = o.client_record_id
        )
    `
  );

  const refusals = new Map<string, TagRefusalCode>();
  for (const row of rows) {
    if (
      row.status === 'conflict' &&
      row.last_error &&
      TAG_REFUSAL_CODES.has(row.last_error)
    ) {
      refusals.set(row.client_record_id, row.last_error as TagRefusalCode);
    }
  }
  return refusals;
}

/**
 * Plants the server already has (server_id known) whose row_version the phone never
 * learned, with a queued create. These were uploaded before the outbox existed
 * (POST /api/plants). A create for an existing plant is answered "success" without
 * changing anything, so a later edit or tag would be silently lost.
 */
export async function getUploadedPlantsQueuedAsCreate(): Promise<
  { clientRecordId: string; serverId: string }[]
> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  const rows = await db.getAllAsync<{
    client_record_id: string;
    server_id: string;
  }>(
    `
      SELECT DISTINCT e.client_record_id, e.server_id
      FROM local_entities e
      JOIN sync_outbox o
        ON o.entity_type = e.entity_type
       AND o.client_record_id = e.client_record_id
      WHERE e.entity_type = 'plant'
        AND e.server_id IS NOT NULL
        AND e.row_version IS NULL
        AND o.operation_type = 'create'
        AND o.status IN ('pending', 'retry')
    `
  );

  return rows.map((row) => ({
    clientRecordId: row.client_record_id,
    serverId: row.server_id,
  }));
}

/**
 * Saves the server's current row_version for such a plant and turns its queued
 * create into an update based on that version, so the change really is applied.
 */
export async function rebaseQueuedCreateAsUpdate(
  clientRecordId: string,
  rowVersion: number
): Promise<void> {
  await initializeOfflineDatabase();

  const db = await getDatabase();
  const timestamp = nowIso();

  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `
        UPDATE local_entities
        SET row_version = ?,
            updated_at = ?
        WHERE entity_type = 'plant'
          AND client_record_id = ?
          AND row_version IS NULL
      `,
      rowVersion,
      timestamp,
      clientRecordId
    );

    await transaction.runAsync(
      `
        UPDATE sync_outbox
        SET operation_type = 'update',
            base_version = ?,
            updated_at = ?
        WHERE entity_type = 'plant'
          AND client_record_id = ?
          AND operation_type = 'create'
          AND status IN ('pending', 'retry')
      `,
      rowVersion,
      timestamp,
      clientRecordId
    );
  });
}

export async function getRecordSyncErrors(): Promise<Map<string, string>> {
  await initializeOfflineDatabase();

  const db = await getDatabase();

  const rows = await db.getAllAsync<{ entity_type: string; client_record_id: string; last_error: string | null }>(`
    SELECT entity_type, client_record_id, status, last_error
    FROM sync_outbox
    WHERE entity_type IN ('plant', 'observation')
      AND rowid = (
        SELECT MAX(latest.rowid)
        FROM sync_outbox AS latest
        WHERE latest.entity_type = sync_outbox.entity_type
          AND latest.client_record_id = sync_outbox.client_record_id
      )
      AND status IN ('failed', 'conflict', 'retry')
  `);
  const errors = new Map<string, string>();
  for (const row of rows) {
    if (row.last_error) errors.set(`${row.entity_type}:${row.client_record_id}`, row.last_error);
  }
  return errors;
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

export interface DeletePlantLocalInput {
  clientRecordId: string;
  serverId?: string | null;
  rowVersion?: number | null;
  observationIds: string[];
}

export async function deletePlantLocallyAndQueueServerDelete(
  input: DeletePlantLocalInput
): Promise<{ queuedForServer: boolean }> {
  await initializeOfflineDatabase();

  if (
    input.serverId &&
    (input.rowVersion === null ||
      input.rowVersion === undefined)
  ) {
    throw new Error(
      'This uploaded record is missing its server version and cannot be safely deleted yet.'
    );
  }

  const db = await getDatabase();
  const timestamp = nowIso();

  let queuedForServer = false;

  await db.withExclusiveTransactionAsync(
    async (transaction) => {
      // Any unsent observation changes become irrelevant
      // when the whole plant is deleted.
      for (const observationId of input.observationIds) {
        await transaction.runAsync(
          `
            UPDATE sync_outbox
            SET status = 'complete',
                last_error = 'Superseded by plant deletion',
                updated_at = ?
            WHERE entity_type = 'observation'
              AND client_record_id = ?
              AND status <> 'complete'
          `,
          timestamp,
          observationId
        );

        await transaction.runAsync(
          `
            DELETE FROM local_entities
            WHERE entity_type = 'observation'
              AND client_record_id = ?
          `,
          observationId
        );
      }

      // Cancel unsent create/update operations for the plant.
      await transaction.runAsync(
        `
          UPDATE sync_outbox
          SET status = 'complete',
              last_error = 'Superseded by plant deletion',
              updated_at = ?
          WHERE entity_type = 'plant'
            AND client_record_id = ?
            AND status <> 'complete'
        `,
        timestamp,
        input.clientRecordId
      );

      /*
       * If the record has reached the server before,
       * queue a server delete.
       *
       * If it has never been uploaded, there is nothing
       * to delete remotely.
       */
      if (
        input.serverId &&
        input.rowVersion !== null &&
        input.rowVersion !== undefined
      ) {
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
            VALUES (
              ?,
              'plant',
              'delete',
              ?,
              ?,
              '{}',
              'pending',
              0,
              NULL,
              ?,
              ?
            )
          `,
          operationId,
          input.clientRecordId,
          input.rowVersion,
          timestamp,
          timestamp
        );

        queuedForServer = true;
      }

      // Remove the visible local plant immediately.
      await transaction.runAsync(
        `
          DELETE FROM local_entities
          WHERE entity_type = 'plant'
            AND client_record_id = ?
        `,
        input.clientRecordId
      );
    }
  );

  return { queuedForServer };
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
