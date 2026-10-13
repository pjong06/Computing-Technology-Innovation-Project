import { apiFetch } from './client';

export type Role = 'botanist' | 'officer' | 'researcher' | 'admin';

// What GET /api/me returns.
export interface Me {
  id: string;
  email: string;
  role: Role;
  full_name?: string | null; // not sent by the backend yet (asked Steven)
  staff_id?: string | null;  // not sent by the backend yet (asked Steven)
}

export function fetchMe(): Promise<Me> {
  return apiFetch<Me>('/api/me');
}
