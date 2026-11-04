# Public QR protection — deployment decisions

Activity 7.6; report 4.5.7. Proposed defaults, not a signed-off team rate policy.

| Entry point | Current protection |
| --- | --- |
| GET /api/public/plants/by-qr | Per Express req.ip; QR_RATE_LIMIT default 60, QR_RATE_WINDOW_MS default 60000; response public allowlist and exact LC-only location |
| GET /p/:tag | Existing independent visitor-page limiter, 60 per minute; not changed in this patch |
| Direct Supabase public QR RPC | Bypasses Express; RPC location/approval filtering applies, Express rate limit does not |

Gerald/backend owner: confirm actual trusted Render proxy topology before enabling trust proxy. Do not trust arbitrary forwarding headers. Test two real clients and forged headers on deployment. Without proxy configuration users may share the proxy IP allowance.

Team confirmation requested: accept or replace provisional 60/min policy; confirm single-instance hosting versus shared rate state; decide whether direct anonymous RPC access requires upstream rate controls. Both Express limiters use process memory, reset on restart and are independent across replicas/routes. Do not revoke RPC grants casually: backend uses a public Supabase client.

Location policy: only exact LC returns location_description/latitude/longitude; other/unknown states are null. Confirm stored status mapping. This allowlist does not scrub location text embedded in permitted descriptions/habitat or media metadata.

Local unit/HTTP tests and owner-approved synthetic LC/EN database-backed HTTP controls passed. Fixtures were cleaned and production deployment was not tested. Final acceptance still requires deployed commit/URL, real proxy/client-IP checks, effective rate configuration and location response checks. No deployment configuration is changed by this document.
