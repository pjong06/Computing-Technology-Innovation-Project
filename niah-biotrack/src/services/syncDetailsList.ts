// Sync details list: EVERY item that can make sync fail, in one place, so the screen
// (Profile > Sync details), the "Sync needs attention" count and Home's sync message agree.
//   - outbox operations still waiting (plants, observations, tags, species requests);
//   - photo uploads that failed (plant photos and observation photos);
//   - observations whose "submit for review" was refused.
// Also the "Remove from phone" actions for the two record-level kinds: they delete only the
// unsent local item; nothing is sent to the server.

import { useRecordStore, type PlantRecord } from '../store/useRecordStore';
import {
  getWaitingOutboxRows,
  removeServerDeletedObservation,
  removeServerDeletedPlant,
  type WaitingOutboxRow,
} from './offlineDatabase';
import { loadOrMigrateRecords, persistRecordSnapshot } from './offlineRecordRepository';
import { KIND_LABELS, describeOutboxRow, itemTitle, type SyncDetailItem } from '../utils/syncDetails';
import { PLANT_GONE_CODES, recordSyncProblems } from '../utils/syncDetails';

export type SyncDetailRow = SyncDetailItem & {
  target:
    | { type: 'outbox'; operationId: string; entityType: string; clientRecordId: string; recordId: string | null }
    | { type: 'photo'; recordId: string; uri: string; obsId?: string }
    | { type: 'submit'; recordId: string; obsId: string };
};

function plantOfRow(row: WaitingOutboxRow, records: PlantRecord[]): PlantRecord | null {
  if (row.entityType === 'plant') return records.find((record) => record.id === row.clientRecordId) ?? null;
  if (row.entityType === 'observation') {
    return records.find((record) => record.observations?.some((visit) => visit.id === row.clientRecordId)) ?? null;
  }
  return null;
}

/** Problems inside the records (photos, submits), as Sync details rows. */
export function recordProblemRows(records: PlantRecord[]): SyncDetailRow[] {
  const rows: SyncDetailRow[] = [];
  for (const record of records) {
    const title = itemTitle(record.tagCode, record.scientificName);
    for (const problem of recordSyncProblems(record)) {
      rows.push({
        key: problem.key,
        kind: problem.kind,
        kindLabel: KIND_LABELS[problem.kind],
        title,
        attempts: null,
        code: problem.code,
        explanation: problem.explanation,
        final: problem.final,
        target:
          problem.kind === 'photo'
            ? { type: 'photo', recordId: record.id, uri: problem.uri ?? '', obsId: problem.obsId }
            : { type: 'submit', recordId: record.id, obsId: problem.obsId ?? '' },
      });
    }
  }
  return rows;
}

/** The whole list, outbox first (oldest first), then photos and submits. */
export async function loadSyncDetailRows(records: PlantRecord[]): Promise<SyncDetailRow[]> {
  const waiting = await getWaitingOutboxRows();
  const outboxRows: SyncDetailRow[] = waiting.map((row) => {
    const plant = plantOfRow(row, records);
    return {
      ...describeOutboxRow(row, plant),
      target: {
        type: 'outbox',
        operationId: row.operationId,
        entityType: row.entityType,
        clientRecordId: row.clientRecordId,
        recordId: plant?.id ?? null,
      },
    };
  });
  return [...outboxRows, ...recordProblemRows(records)];
}

/** How many items Sync details lists: the number the sync messages show. */
export async function countSyncDetailItems(records: PlantRecord[]): Promise<number> {
  return (await loadSyncDetailRows(records)).length;
}

async function refreshStore(records: PlantRecord[]): Promise<void> {
  // The records without the removed one, so nothing is migrated back from memory.
  useRecordStore.setState({ records: await loadOrMigrateRecords(records) });
}

/**
 * "Remove from phone" for a refused submit. Its plant removed on the server: the plant and
 * all its observations leave the phone (they can never upload). Otherwise only that
 * observation leaves the phone. Nothing is sent to the server.
 */
export async function removeRefusedSubmit(recordId: string, obsId: string, code: string): Promise<void> {
  const records = useRecordStore.getState().records;
  const record = records.find((item) => item.id === recordId);
  if (!record) return;
  if (PLANT_GONE_CODES.has(code)) {
    await removeServerDeletedPlant(record.id, record.observations.map((visit) => visit.id));
    await refreshStore(records.filter((item) => item.id !== record.id));
    return;
  }
  await removeServerDeletedObservation(obsId);
  const updated: PlantRecord = { ...record, observations: record.observations.filter((visit) => visit.id !== obsId) };
  await persistRecordSnapshot(updated);
  await refreshStore(records.map((item) => (item.id === record.id ? updated : item)));
}
