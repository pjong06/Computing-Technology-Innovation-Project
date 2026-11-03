import { fetch as expoFetch } from 'expo/fetch';
import type { File } from 'expo-file-system';
import { supabase } from '../lib/supabase';

// Trim spaces and any trailing "/" so small typos in .env.local don't break the address.
export const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');

const TIMEOUT_MS = 15000; // weak signal in the field
const UPLOAD_TIMEOUT_MS = 60000; // photos are bigger; give a weak connection longer

// An error from a backend call. status 0 = never reached the server.
export class ApiError extends Error {
  status: number;
  // The server's machine-readable reason when it sends one, e.g. 'photos_locked'.
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
      const { message, code } = (json as { message?: string; code?: string } | null) ?? {};
      throw new ApiError(message ?? `Server returned ${response.status}`, response.status, code);
    }

    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

// Uploads one photo as multipart/form-data (field "photo" plus text fields), with the
// login token. Same errors as apiFetch: ApiError, status 0 = never reached the server.
// Uses expo/fetch, which sends an expo-file-system File as the file part (SDK 58 docs).
export async function apiUpload<T>(path: string, fields: Record<string, string>, file: File): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError('EXPO_PUBLIC_API_BASE_URL is not set', 0);
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('You are not signed in', 401);

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('photo', file);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await expoFetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: form,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(`Could not reach the server at ${BASE_URL}`, 0);
    }

    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON - leave as null
    }
    if (!response.ok) {
      const { message, code } = (json as { message?: string; code?: string } | null) ?? {};
      throw new ApiError(message ?? `Server returned ${response.status}`, response.status, code);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}