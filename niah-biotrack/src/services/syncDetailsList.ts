import { buildSyncSummary } from './syncSummary';
import type { PlantRecord } from '../store/useRecordStore';

export async function countSyncDetailItems(records: PlantRecord[]): Promise<number> {
  const summary = buildSyncSummary(records, false);
  return summary.failedRecordCount;
}