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


## Officer species and taxonomy pagination

`GET /api/knowledge/species/manage` requires an active officer token and returns approved and archived species allowed by RLS. Default `page_size` is 50.

`GET /api/knowledge/taxonomy` is public. Default `page_size` is 100.

Both accept `page` (1–100000) and `page_size` (1–100), return the existing `data` array plus `pagination: { page, page_size, total, total_pages }`, and sort by name/genus then ID. Empty or out-of-range pages return an empty array with the matching total, not a 404. Invalid or repeated pagination values return 400. Clients must request subsequent pages to load the full catalogue.

## Species validation and errors

Create/update accept only the existing editable fields. Scientific names are required on creation and limited to 200 characters. Optional common/local names allow 200 characters; category/status allow 100; descriptive fields allow 10000. Optional fields accept trimmed non-empty text or null on both create and update; use null to clear a value and omit a field to leave it unchanged. Category and conservation-status values remain free text pending a project-approved vocabulary.

Malformed JSON returns 400; oversized JSON returns 413. Existing UUID, duplicate (409), missing taxonomy (400), missing resource (404), and officer permission checks remain. Unexpected Knowledge API failures return a generic JSON 500 without database details.

## Tests and performance evidence

Run `npm test`, `npm run test:knowledge`, or `npm run test:coverage`. The GitHub workflow runs tests after these changes are pushed. Run `npm run benchmark:knowledge` with Supabase URL and publishable key configured to benchmark read-only live searches. See [benchmark evidence](benchmark-results/README.md) and raw results in `benchmark-results/knowledge-search.json` for scope and limitations.
