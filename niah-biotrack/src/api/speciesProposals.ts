import { apiFetch } from './client';

// A species proposal as the server returns it (POST /proposals and GET /proposals/mine).
export interface ServerProposal {
  id: string;
  client_record_id: string | null;
  scientific_name: string;
  common_name: string | null;
  local_name: string | null;
  proposed_family: string | null;
  description: string | null;
  habitat: string | null;
  // 'pending' until an officer reviews it. 'archived' if an officer later archives it.
  verification_status: string;
  review_comment: string | null;
}

export interface ProposalPayload {
  client_record_id: string;
  scientific_name: string;
  common_name?: string;
  local_name?: string;
  family?: string;
  description?: string;
  habitat?: string;
}

// 201 for a new proposal, 200 when this client_record_id was already saved (a retry).
// The server always stores it as pending, whatever the phone sends.
export async function createProposal(payload: ProposalPayload): Promise<ServerProposal> {
  const response = await apiFetch<{ data: ServerProposal }>('/api/knowledge/species/proposals', {
    method: 'POST',
    body: payload,
  });
  return response.data;
}

// The signed-in botanist's own proposals, with their current review status.
export async function fetchMyProposals(): Promise<ServerProposal[]> {
  const proposals: ServerProposal[] = [];
  for (let page = 1; ; page += 1) {
    const response = await apiFetch<{ data: ServerProposal[]; pagination: { total_pages: number } }>(
      `/api/knowledge/species/proposals/mine?page=${page}&page_size=100`
    );
    proposals.push(...response.data);
    if (page >= response.pagination.total_pages) return proposals;
  }
}
