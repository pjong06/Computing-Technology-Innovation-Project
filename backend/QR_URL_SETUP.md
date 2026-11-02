# Public QR URL and local visitor page

## What changed

- Individual QR PNGs and batch PDF labels encode a configured public URL ending in `/p/NIAH-PLT-00001` instead of only the raw tag.
- The database tag and existing `qr_value` response remain unchanged. The individual QR JSON response adds `public_url`.
- `/p/:tag` provides a minimal server-rendered public page using the existing `public_plant_by_qr_v2` RPC and an anonymous publishable-key client. It does not add or change database tables, policies, approvals or tag reservations.
- The page explicitly selects public text fields and never renders coordinates, location_description, staff identity or tokens. Content is HTML-escaped, with restrictive CSP, no-store, no-referrer, nosniff and frame protections.
- DEMO-labelled records display a prominent notice that they are not real research data and do not represent Officer review.
- Existing botanist ownership checks remain required for printing. The mobile parser accepts both new URL-form tags and old raw tags; mobile server lookup and staff record views were not changed.

## Local use

From `backend`, install the locked dependencies using `npm ci --ignore-scripts`. Set the destination before starting the server:

```powershell
$env:PUBLIC_PLANT_BASE_URL = 'http://localhost:3000/p/'
npm start
```

Alternatively set PUBLIC_PLANT_BASE_URL in the ignored backend/.env. Then open:

```text
http://localhost:3000/p/NIAH-PLT-90001
```

The same-computer localhost URL does not work from a separate phone: on the phone, localhost means the phone itself. For phone testing, explicitly configure the computer's private LAN address, for example `http://192.168.1.10:3000/p/`, replacing the example with the actual address. The devices must share a reachable network. No LAN address or firewall setting was changed automatically.

For deployment, configure a stable HTTPS destination such as `https://your-approved-domain.example/p/`, ensure the web route and stylesheet are served at that origin, and restart the service. Production rejects HTTP. Development HTTP is allowed only for loopback/private LAN addresses. Userinfo, query strings, fragments and mismatched path prefixes are rejected. Never derive the QR origin from untrusted Host headers.

Do not use local development QR prints as permanent field labels. Once a tag is printed, its encoded URL is fixed; changing the configuration only affects newly generated images. Keep the final public domain stable or maintain a redirect from the old domain.

## Verification recorded on 31 October 2026

- 113 backend tests passed: the previous 85 plus 28 QR/visitor-page tests.
- Actual PNG and rasterized PDF QR content decoded to the same local URL for NIAH-PLT-90001.
- Existing mobile parseTagCode accepted that URL and the legacy raw tag.
- Live anonymous RPC returned the user-created DEMO record, with latitude, longitude and location_description null.
- Live local visitor request returned 200 and displayed the explicit DEMO warning; a missing tag returned 404.
- Actual browser screenshots cover normal desktop and 390px mobile layouts; no horizontal overflow was observed at 390px.
- Tests cover unsafe URL configuration, production HTTP denial, invalid tags, duplicate PDF inputs, multi-page PDFs, owner/role checks, safe error pages, XSS escaping, location exclusion and request throttling.

Evidence is in backend/qr-results/verification.json and the DEMO screenshots in that folder. These are local demo checks, not a physical phone-camera test or a deployed HTTPS end-to-end test. No shared database records were modified by this implementation or its verification. C17 reservation and C10 mobile server lookup remain separate work.

## Configuration and compatibility

A missing/invalid PUBLIC_PLANT_BASE_URL makes QR generation return 503 rather than printing a misleading destination. Plain tags remain visible beneath the printed QR. Previously printed raw-tag codes are not rewritten.

The visitor page intentionally omits all structured location fields, including LC locations that the existing RPC might otherwise return. The existing JSON public API is unchanged. The page's process-local rate limiter allows 60 valid-tag requests per minute per source IP and uses bounded memory; shared/gateway limits are still needed for multiple instances and appropriate proxy settings must be reviewed at deployment.

A public 404 may mean that a plant, species or required observation is not approved, or that the tag does not exist. It does not disclose which internal approval condition failed. The demo's approved status is only a demonstration fixture, not evidence of a real officer review.
