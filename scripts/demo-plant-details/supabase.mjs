// supabase.mjs - the small REST client shared by fill.mjs and remove.mjs. The URL and the
// service-role key are read from the environment only (never from .env or a file).

let serviceRoleKey = '';
let root = '';
const PAGE = 1000;

export function connect() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!rawUrl || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (see README.md).');
  }
  const base = new URL(rawUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS URL without credentials or query parameters.');
  }
  root = `${base.toString().replace(/\/+$/, '')}/`;
}

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(new URL(`rest/v1/${path}`, root), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Supabase answered HTTP ${response.status}${data?.message ? `: ${data.message}` : ''}`);
  return data;
}

// Every row of a table (paged), with PostgREST filters such as { deleted_at: 'is.null' }.
export async function readAll(table, select, filters) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({ select, ...filters, order: 'id.asc', limit: String(PAGE), offset: String(offset) });
    const page = await rest(`${table}?${params}`);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export function safe(error) {
  let message = error instanceof Error ? error.message : String(error);
  if (serviceRoleKey) message = message.split(serviceRoleKey).join('[REDACTED]');
  return message.slice(0, 300);
}
