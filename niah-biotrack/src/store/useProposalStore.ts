import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { ApiError } from '../api/client';
import { createProposal, fetchMyProposals, type ServerProposal } from '../api/speciesProposals';
import { SyncStatus } from './useRecordStore';
import { useSpeciesStore } from './useSpeciesStore';

// The officer's decision on a proposal. Only 'approved' species reach the species list
// and the New Record picker (those read approved species only).
export type ProposalReview = 'pending' | 'approved' | 'rejected';

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

export type ProposalSyncResult = { ok: true } | { ok: false; reason: string };

// Proposals currently uploading, so Retry and Sync now never send one twice at once.
const uploadsInProgress = new Set<string>();

function reviewFromServer(status: string): ProposalReview {
  return status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending';
}

interface ProposalState {
  proposals: SpeciesProposal[];
  addProposal: (
    data: Pick<SpeciesProposal, 'scientificName' | 'commonName' | 'localName' | 'family' | 'description' | 'habitat'>
  ) => SpeciesProposal;
  removeProposal: (id: string) => void;
  syncProposal: (id: string) => Promise<ProposalSyncResult>;
  syncAllProposals: () => Promise<{ uploaded: number; failed: number }>;
  refreshProposalStatuses: () => Promise<void>;
  clearProposals: () => void;
}

export const useProposalStore = create<ProposalState>()(
  persist(
    (set, get) => ({
      proposals: [],

      // Saved on the phone first, so proposing works without signal.
      addProposal: (data) => {
        const proposal: SpeciesProposal = {
          ...data,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          syncStatus: SyncStatus.NOT_UPLOADED,
          review: 'pending',
        };
        set((state) => ({ proposals: [proposal, ...state.proposals] }));
        return proposal;
      },

      // Only a proposal the server hasn't seen can be removed (e.g. one the server
      // refused as a duplicate); after upload only an officer can change it.
      removeProposal: (id) =>
        set((state) => ({
          proposals: state.proposals.filter((p) => p.id !== id || p.syncStatus === SyncStatus.UPLOADED),
        })),

      // Uploads one proposal. Never throws: the screen gets a message it can show.
      syncProposal: async (id) => {
        const proposal = get().proposals.find((p) => p.id === id);
        if (!proposal) return { ok: false, reason: 'Proposal not found' };
        if (proposal.syncStatus === SyncStatus.UPLOADED) return { ok: true };
        if (uploadsInProgress.has(id)) return { ok: false, reason: 'This proposal is already uploading' };

        const update = (changes: Partial<SpeciesProposal>) =>
          set((state) => ({ proposals: state.proposals.map((p) => (p.id === id ? { ...p, ...changes } : p)) }));

        uploadsInProgress.add(id);
        try {
          const saved = await createProposal({
            client_record_id: proposal.id,
            scientific_name: proposal.scientificName,
            common_name: proposal.commonName || undefined,
            local_name: proposal.localName || undefined,
            family: proposal.family || undefined,
            description: proposal.description || undefined,
            habitat: proposal.habitat || undefined,
          });
          update({
            serverId: saved.id,
            syncStatus: SyncStatus.UPLOADED,
            review: reviewFromServer(saved.verification_status),
            reviewComment: saved.review_comment,
          });
          return { ok: true };
        } catch (error) {
          update({ syncStatus: SyncStatus.FAILED });
          // e.g. 409 "A species with this scientific name already exists or is already proposed"
          if (error instanceof ApiError) return { ok: false, reason: error.message };
          return { ok: false, reason: 'Upload failed unexpectedly. Please try again.' };
        } finally {
          uploadsInProgress.delete(id);
        }
      },

      // One at a time, like syncAll for records.
      syncAllProposals: async () => {
        const ids = get()
          .proposals.filter((p) => p.syncStatus !== SyncStatus.UPLOADED)
          .map((p) => p.id);
        let uploaded = 0;
        let failed = 0;
        for (const id of ids) {
          if (uploadsInProgress.has(id)) continue;
          const result = await get().syncProposal(id);
          if (result.ok) uploaded += 1;
          else failed += 1;
        }
        return { uploaded, failed };
      },

      // Reads the officer's decisions from the server. Quietly does nothing offline:
      // the phone keeps showing the last known status.
      refreshProposalStatuses: async () => {
        let mine: ServerProposal[];
        try {
          mine = await fetchMyProposals();
        } catch {
          return;
        }

        const local = get().proposals;
        const newlyApproved = mine.some((server) => {
          const known = local.find((p) => p.serverId === server.id || p.id === server.client_record_id);
          return server.verification_status === 'approved' && known?.review !== 'approved';
        });

        set((state) => {
          const updated = state.proposals.map((p) => {
            const server = mine.find((s) => s.id === p.serverId || s.client_record_id === p.id);
            return server
              ? {
                  ...p,
                  serverId: server.id,
                  syncStatus: SyncStatus.UPLOADED,
                  review: reviewFromServer(server.verification_status),
                  reviewComment: server.review_comment,
                }
              : p;
          });
          // Proposals sent from this account before (e.g. before logging out or
          // reinstalling) are shown too, so the botanist sees every decision.
          const missing = mine
            .filter((s) => !updated.some((p) => p.serverId === s.id))
            .map<SpeciesProposal>((s) => ({
              id: s.client_record_id ?? s.id,
              serverId: s.id,
              scientificName: s.scientific_name,
              commonName: s.common_name ?? undefined,
              localName: s.local_name ?? undefined,
              family: s.proposed_family ?? undefined,
              description: s.description ?? undefined,
              habitat: s.habitat ?? undefined,
              createdAt: new Date().toISOString(),
              syncStatus: SyncStatus.UPLOADED,
              review: reviewFromServer(s.verification_status),
              reviewComment: s.review_comment,
            }));
          return { proposals: [...updated, ...missing] };
        });

        // An approved species now belongs in the cached list (and the New Record picker).
        if (newlyApproved) void useSpeciesStore.getState().loadSpecies();
      },

      clearProposals: () => set({ proposals: [] }),
    }),
    {
      name: 'niah-species-proposals',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    }
  )
);
