// serverDeletes.ts - which plants on the phone a sync pull says were deleted on the server.
// Plain TypeScript with no imports (tested by serverDeletes.test.mjs).
//
// A plant deleted on the server (by an officer, or by the botanist on another phone) is
// removed from the phone, with its observations and anything still waiting to upload for it:
// that can never upload, because the plant no longer exists. Plants only on this phone (no
// server id) are never matched, so a pull can't remove unsent new plants.

export interface PullChangeLike {
  entity_type: string;
  entity_id: string;
  action: string;
  record_payload: Record<string, unknown> | null;
}

export interface PhoneRecordLike {
  id: string;
  serverId?: string | null;
  observations?: { id: string }[] | null;
}

export function isDeletedChange(change: PullChangeLike): boolean {
  return change.action === 'DELETE' || change.record_payload?.deleted_at != null;
}

// The last change per plant wins (a plant re-created after a delete is kept).
export function serverDeletedPlants<T extends PhoneRecordLike>(
  changes: PullChangeLike[],
  records: T[]
): { record: T; observationIds: string[] }[] {
  const latest = new Map<string, PullChangeLike>();
  for (const change of changes) {
    if (change.entity_type === 'plants' && change.entity_id) latest.set(change.entity_id, change);
  }
  const removed: { record: T; observationIds: string[] }[] = [];
  for (const change of latest.values()) {
    if (!isDeletedChange(change)) continue;
    const clientId = typeof change.record_payload?.client_record_id === 'string'
      ? change.record_payload.client_record_id
      : null;
    const record = records.find((item) =>
      Boolean(item.serverId) && (item.serverId === change.entity_id || (clientId !== null && item.id === clientId))
    );
    if (!record) continue;
    removed.push({
      record,
      observationIds: (Array.isArray(record.observations) ? record.observations : [])
        .map((visit) => visit?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    });
  }
  return removed;
}
