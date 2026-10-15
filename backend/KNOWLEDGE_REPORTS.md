# Knowledge search and reports API

Run the backend from `backend` with `npm start`. The server uses the existing
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `backend/.env`.

## Approved species search

`GET /api/knowledge/species` is public and returns approved species only.

Optional query parameters:

| Parameter | Meaning |
| --- | --- |
| `q` | Scientific, common, or local name contains this text. |
| `family` | Exact taxonomy family. |
| `conservation_status` | Exact status, or `Unknown` for an empty status. |
| `category` | Exact species category. |
| `page` | Page number, starting at 1. Default 1. |
| `page_size` | Rows per page, 1 to 100. Default 50. |

Example:

```text
GET /api/knowledge/species?q=Shorea&family=Dipterocarpaceae&page=1&page_size=20
```

The JSON response has `data` and `pagination`. The existing `data` field is
preserved for current API clients. Public responses exclude
`distribution_notes` and plant GPS coordinates.

## Officer reports

`GET /api/reports/:type` requires an active officer's Supabase access token in
`Authorization: Bearer <token>`. Types are `inventory`, `status`, and
`botanist`. The backend uses that person's token for database queries, so
Supabase RLS still applies.

Optional parameters:

| Parameter | Meaning |
| --- | --- |
| `from` | First date, `YYYY-MM-DD` (UTC). |
| `to` | Last date, `YYYY-MM-DD` (UTC, inclusive). |
| `format` | `json` (default), `csv`, or `pdf`. |

Examples:

```text
GET /api/reports/inventory?from=2026-10-01&to=2026-10-31
GET /api/reports/status?format=csv
GET /api/reports/botanist?format=pdf
```

JSON returns `{ "data": { "title", "columns", "rows", "total", ... } }`.
CSV and PDF download the same report rows. Inventory and conservation status
reports count approved species. Missing conservation status appears as
`Unknown`. The botanist report includes active observations at every review
stage; only officers can request it. Reports omit exact GPS coordinates.

The endpoint rejects reports over 1,000 source rows with HTTP 413 instead of
silently producing incomplete exports. Choose a shorter date range for these
reports.

The current `frontend/reports.html` and `frontend/species.html` still use
browser `localStorage` sample data. They do not show these API results yet.
The web login task must provide an officer access token before the reports
page can use the protected endpoint. The IoT alerts page already expects a
`window.getOfficerAccessToken()` hook; the reports page can use the same hook.
