import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { ApiError } from '../api/client';
import { createProposal, fetchMyProposals, type ProposalPayload, type ServerProposal } from '../api/speciesProposals';
import {
  applySyncOperationResult,
  claimOutboxOperations,
  clearLocalProposals,
  getLocalEntities,
  getReadyOutboxOperations,
  removeLocalProposal,
  saveEntityAndQueue,
  type OutboxOperation,
} from '../services/offlineDatabase';
import { SyncStatus } from './useRecordStore';
import { useSpeciesStore } from './useSpeciesStore';
import { isSyncOffline, requestSyncRetry } from '../services/syncRetry';

// The officer's decision on a proposal. Only 'approved' species reach the species list
// and the New Record picker (those read approved species only). 'archived' = an officer
// approved it and later took it out of the list.
export type ProposalReview = 'pending' | 'approved' | 'rejected' | 'archived';

export interface SpeciesProposal {
  id: string; // UUID made on the phone; sent as client_record_id
  serverId?: string; // species.id on the server, saved once the upload succeeds
  scientificName: string;
  commonName?: string;
  localName?: string;
  family?: string;
  description?: string; // what it looks like
  habitat?: string;
  createdAt: string; // ISO
  syncStatus: SyncStatus; // Not uploaded / Upload failed / Uploaded (same as records)
  review: ProposalReview;
  reviewComment?: string | null; // officer's reason when rejected
  // TODO(photos): proposals have no photos yet. Add them once species photo upload
  // is open to botanists (POST /species/:id/photos is officer-only today).
}

export type ProposalSyncResult = { ok: true } | { ok: false; reason: string; retryable?: boolean };
export interface ProposalSyncAllResult {
  uploaded: number;
  failed: number;
  retryable: boolean;
  reasons: string[];
}

const LEGACY_KEY = 'niah-species-proposals';
let proposalWork: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = proposalWork.then(work);
  proposalWork = next.catch(() => {});
  return next;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function saveProposal(proposal: SpeciesProposal, queue: boolean) {
  return saveEntityAndQueue({
    entityType: 'proposal',
    clientRecordId: proposal.id,
    serverId: proposal.serverId,
    syncStatus: queue ? 'pending' : 'uploaded',
    snapshot: { ...proposal },
    operationType: queue ? 'create' : undefined,
    payload: queue ? {
      client_record_id: proposal.id,
      scientific_name: proposal.scientificName,
      common_name: proposal.commonName,
      local_name: proposal.localName,
      family: proposal.family,
      description: proposal.description,
      habitat: proposal.habitat,
    } : undefined,
  });
}

async function readProposals(): Promise<SpeciesProposal[]> {
  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (legacy !== null) {
    const { state } = JSON.parse(legacy) as { state?: { proposals?: SpeciesProposal[] } };
    if (!Array.isArray(state?.proposals)) throw new Error('Could not read saved species proposals.');
    const existing = new Set((await getLocalEntities('proposal')).map((row) => row.clientRecordId));
    for (const proposal of state.proposals) {
      if (existing.has(proposal.id)) continue;
      await saveProposal(proposal, proposal.syncStatus !== SyncStatus.UPLOADED);
      existing.add(proposal.id);
    }
    // Each entry and its outbox operation are committed before removing the old copy.
    await AsyncStorage.removeItem(LEGACY_KEY);
  }

  const rows = await getLocalEntities<SpeciesProposal>('proposal');
  return rows.map((row) => ({
    ...row.snapshot,
    serverId: row.serverId ?? undefined,
    syncStatus: row.syncStatus === 'uploaded'
      ? SyncStatus.UPLOADED
      : row.syncStatus === 'failed' || row.syncStatus === 'conflict'
        ? SyncStatus.FAILED
        : SyncStatus.NOT_UPLOADED,
  }));
}

async function uploadProposal(operation: OutboxOperation, proposal: SpeciesProposal): Promise<ProposalSyncResult> {
  if (await isSyncOffline()) return { ok: false, reason: 'Waiting for an internet connection.' };
  const [claimed] = await claimOutboxOperations([operation.operationId]);
  if (!claimed) return { ok: false, reason: 'No upload is queued for this proposal.' };
  let saved: ServerProposal;
  try {
    saved = await createProposal(claimed.payload as unknown as ProposalPayload);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
    const reason = error instanceof ApiError ? error.message : 'Could not upload the proposal. Try again later.';
    await applySyncOperationResult({
      operation_id: operation.operationId,
      status: retryable ? 'retry' : 'failed',
      message: reason,
      retryAfterMs: error instanceof ApiError ? error.retryAfterMs : undefined,
    });
    if (retryable) requestSyncRetry();
    return { ok: false, reason, retryable };
  }
  await applySyncOperationResult({
    operation_id: operation.operationId,
    status: 'success',
    server_id: saved.id,
    snapshot: {
      ...proposal,
      review: reviewFromServer(saved.verification_status),
      reviewComment: saved.review_comment,
    },
  });
  return { ok: true };
}

function reviewFromServer(status: string): ProposalReview {
  if (status === 'approved' || status === 'rejected' || status === 'archived') return status;
  return 'pending';
}

interface ProposalState {
  proposals: SpeciesProposal[];
  hydrateOfflineProposals: () => Promise<void>;
  addProposal: (
    data: Pick<SpeciesProposal, 'scientificName' | 'commonName' | 'localName' | 'family' | 'description' | 'habitat'>
  ) => Promise<SpeciesProposal>;
  removeProposal: (id: string) => Promise<void>;
  syncProposal: (id: string) => Promise<ProposalSyncResult>;
  syncAllProposals: () => Promise<ProposalSyncAllResult>;
  refreshProposalStatuses: () => Promise<void>;
  clearProposals: () => Promise<void>;
}

export const useProposalStore = create<ProposalState>()((set) => {
    const reload = async () => {
      const proposals = await readProposals();
      set({ proposals });
      return proposals;
    };
    return {
      proposals: [],
      hydrateOfflineProposals: () => serialize(async () => {
        await reload();
      }),

      // Saved on the phone first, so proposing works without signal.
      addProposal: (data) => serialize(async () => {
        await reload();
        const proposal: SpeciesProposal = {
          ...data,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          syncStatus: SyncStatus.NOT_UPLOADED,
          review: 'pending',
        };
        await saveProposal(proposal, true);
        set((state) => ({ proposals: [proposal, ...state.proposals] }));
        return proposal;
      }),

      // Only a proposal the server hasn't seen can be removed (e.g. one the server
      // refused as a duplicate); after upload only an officer can change it.
      removeProposal: (id) => serialize(async () => {
        const proposals = await reload();
        const proposal = proposals.find((item) => item.id === id);
        if (!proposal || proposal.syncStatus === SyncStatus.UPLOADED) return;
        await removeLocalProposal(id);
        await reload();
      }),

      // Uploads one proposal. Never throws: the screen gets a message it can show.
      syncProposal: (id) => serialize<ProposalSyncResult>(async () => {
        const proposals = await reload();
        const proposal = proposals.find((p) => p.id === id);
        if (!proposal) return { ok: false, reason: 'Proposal not found' };
        if (proposal.syncStatus === SyncStatus.UPLOADED) return { ok: true };
        if (proposal.syncStatus === SyncStatus.FAILED) await saveProposal(proposal, true);
        const [operation] = await getReadyOutboxOperations(1, 'proposals', id);
        if (!operation) return { ok: false, reason: 'No upload is queued for this proposal.' };
        const result = await uploadProposal(operation, proposal);
        await reload();
        return result;
      }).catch((error: unknown) => ({
        ok: false,
        reason: errorMessage(error, 'Could not read or update the proposal on this phone.'),
      })),

      // One at a time, like syncAll for records.
      syncAllProposals: () => serialize(async () => {
        const proposals = await reload();
        let uploaded = 0;
        let failed = 0;
        let retryable = false;
        const reasons = new Set<string>();
        for (const operation of await getReadyOutboxOperations(-1, 'proposals')) {
          const proposal = proposals.find((item) => item.id === operation.clientRecordId);
          if (!proposal) continue;
          const result = await uploadProposal(operation, proposal);
          if (result.ok) uploaded += 1;
          else {
            failed += 1;
            retryable ||= result.retryable === true;
            reasons.add(result.reason);
          }
        }
        await reload();
        return { uploaded, failed, retryable, reasons: [...reasons] };
      }).catch((error: unknown) => ({
        uploaded: 0,
        failed: 1,
        retryable: false,
        reasons: [errorMessage(error, 'Could not read or update saved proposals on this phone.')],
      })),

      // Reads the officer's decisions from the server. Quietly does nothing offline:
      // the phone keeps showing the last known status.
      refreshProposalStatuses: () => serialize(async () => {
        const local = await reload();
        let mine: ServerProposal[];
        try {
          mine = await fetchMyProposals();
        } catch {
          return;
        }

        const newlyApproved = mine.some((server) => {
          const known = local.find((p) => p.serverId === server.id || p.id === server.client_record_id);
          return server.verification_status === 'approved' && known?.review !== 'approved';
        });

        for (const server of mine) {
          const known = local.find((p) => p.serverId === server.id || p.id === server.client_record_id);
          await saveProposal({
            id: known?.id ?? server.client_record_id ?? server.id,
            serverId: server.id,
            scientificName: server.scientific_name,
            commonName: server.common_name ?? undefined,
            localName: server.local_name ?? undefined,
            family: server.proposed_family ?? undefined,
            description: server.description ?? undefined,
            habitat: server.habitat ?? undefined,
            createdAt: known?.createdAt ?? new Date().toISOString(),
            syncStatus: SyncStatus.UPLOADED,
            review: reviewFromServer(server.verification_status),
            reviewComment: server.review_comment,
          }, false);
        }
        await reload();

        // An approved species now belongs in the cached list (and the New Record picker).
        if (newlyApproved) void useSpeciesStore.getState().loadSpecies();
      }).catch((error: unknown) => console.warn('Could not refresh species proposals', error)),

      clearProposals: () => serialize(async () => {
        await clearLocalProposals();
        await AsyncStorage.removeItem(LEGACY_KEY);
        set({ proposals: [] });
      }),
    };
});
