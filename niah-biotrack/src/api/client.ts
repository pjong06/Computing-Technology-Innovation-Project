import { supabase } from '../lib/supabase';

// Trim spaces and any trailing "/" so small typos in .env.local don't break the address.
export const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');

const TIMEOUT_MS = 15000; // weak signal in the field

// An error from a backend call. status 0 = never reached the server.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;   // sent as JSON
  auth?: boolean;   // default true: attach the login token
}

// Every backend call goes through here.
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  if (!BASE_URL) {
    throw new ApiError('EXPO_PUBLIC_API_BASE_URL is not set', 0);
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    // getSession() renews the token first if it has expired.
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new ApiError('You are not signed in', 401);
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      // Network failure or our 15-second timeout.
      throw new ApiError(`Could not reach the server at ${BASE_URL}`, 0);
    }

    // Read the body once as text; some error responses aren't JSON.
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON - leave as null
    }

    if (!response.ok) {
      const message = (json as { message?: string } | null)?.message;
      throw new ApiError(message ?? `Server returned ${response.status}`, response.status);
    }

    return json as T;
  } finally {
    clearTimeout(timer);
  }
}