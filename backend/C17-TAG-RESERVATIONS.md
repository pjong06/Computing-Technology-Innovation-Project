# C17: tag reservation and printing

Status: backend implementation synchronised with main; PR readiness blocked by existing main authentication test failures. Shared Supabase has NOT been migrated.

## Endpoints

All endpoints require an active Botanist bearer session and use the existing user-scoped Supabase client.

- `GET /api/tag-reservations?page=1&page_size=50&status=reserved`
  - Lists only the signed-in Botanist's tags; `status` accepts `all`, `reserved` or `bound`.
  - Optional `request_id=<UUID>` filters one batch. Page size is 1–100, default 50.
  - Returns `data` and exact `pagination` totals, ordered by reservation time descending and tag ascending.
  - Includes request IDs for recovering/reprinting a batch. For reprinting use its original full quantity, not only the number of rows on one page.
- `POST /api/tag-reservations/reserve-and-print`
  - JSON: `{ "count": 2, "request_id": "<client-generated UUID>" }`
  - Returns a PDF containing the allocated physical tag IDs and their configured public URLs.
  - Persist the request UUID before sending. Reuse the same UUID and quantity after timeouts or print failures; it returns the same tags. A new UUID allocates a new batch.
  - Reprinting uses the same endpoint, UUID and count; labels do not expire.
- `POST /api/tag-reservations/<plant UUID>/attach`
  - JSON: `{ "tag": "NIAH-PLT-00002" }`
  - Attaches an owned reservation to an existing owned plant with an internal `plant:` code. Repeating the same binding is safe.
  - Physical labels and their owner cannot be replaced; consumed numbers are never recycled.
- Existing `POST /api/plants` can bind an owned reserved physical tag during creation; a database trigger enforces the rule even for direct client writes.
- Existing `/api/qr-batch/print` continues handling already-created owned plants. Use reserve-and-print to print reservations before plant creation.

## Rollout and behavior changes

1. Review `supabase/migrations/20261031090000_tag_reservations.sql` with the database owner. It adds two RLS-protected tables, two RPCs and a plant trigger. Existing physical tags are recorded as consumed; plant rows and users are not modified.
2. Apply the migration only after explicit approval. Back up the database and validate against a development environment first. This is a forward migration, not a reset.
3. Deploy backend code with `PUBLIC_PLANT_BASE_URL` configured. Missing RPCs fail closed with 503, without privileged fallback.
4. Integrate the printing UI and mobile attachment caller. The current mobile client has NOT been changed by this work.
5. After migration, supplying an unreserved physical tag to plant creation is rejected. Offline clients must acquire a reservation before using a physical label. Untagged creation retains the existing internal `plant:` identifier behavior.

## Security and validation

- Server-side atomic allocation skips existing and reserved numbers; PostgreSQL transaction advisory locking serializes concurrent allocation across backend instances.
- Requests allow 1–100 tags. Database repeats validation and verifies active role and auth.uid().
- RLS grants authenticated clients read access only to their own reservations; clients cannot directly insert, update or delete reservations.
- Attachment locks both the plant and reservation, enforces ownership, and is committed with reservation consumption in the same transaction.
- Deleted plants leave a permanent consumed reservation. Legacy physical labels are registered by the migration too.
- Errors hide database details. Printing uses the existing configured URL builder; no user-provided destination is accepted.

## Tests and remaining verification

- Verified on 2026-11-01 against main commit f29c1c0: 164 backend tests passed, 26 isolated SQL checks passed, backend npm audit reported 0 known vulnerabilities.
- Branch: `feat/tag-reservation-workflow`. This branch contains the implementation and tests; no new PR has been created. Web/mobile integration is assigned to the team.
- Backend tests: `npm test` or `node --test test/tagReservations.test.js` from backend.
- Isolated database tests use a temporary PGlite PostgreSQL runtime outside project dependencies. They exercise the actual migration, RPCs, RLS and triggers against synthetic local rows.
- Reproduce SQL tests from the repository root (PowerShell):

  ```powershell
  $c17TestDirectory = Join-Path $env:TEMP 'niah-c17-sql-test'
  npm install --prefix $c17TestDirectory --no-save --ignore-scripts --package-lock=false @electric-sql/pglite@0.3.14
  $env:NODE_PATH = Join-Path $c17TestDirectory 'node_modules'
  node supabase/tests/tag-reservations.cjs supabase/migrations/20261031090000_tag_reservations.sql
  Remove-Item Env:NODE_PATH
  ```
- PGlite does not prove production multi-connection races. Run concurrent real PostgreSQL transactions and real Supabase JWT/RLS tests in a development environment before shared rollout.
- No real Supabase writes, phone camera test, web/mobile UI integration or production deployment is included in local completion.

## Integration review: 2026-11-03

- Merged main at 58fe5d6, retaining the latest web-data routes and registering tag reservations exactly once.
- Tag reservation API: 43 tests passed. Isolated migration: 26 checks passed.
- Full backend suite: 201 tests, 177 passed and 24 failed. All failures are in auth.security.test.js because main's auth route no longer exports createAuthRouter. Both the auth route and its tests are unchanged from main in this branch. Do not remove or skip these tests to unblock CI.
- PR creation is deferred until the authentication implementation and regression tests agree and the full suite passes.
- Deployment acceptance still requires the migration, PUBLIC_PLANT_BASE_URL=https://niah-backend.onrender.com/p/, real Botanist sessions, independent PostgreSQL concurrency checks and the team's web/mobile callers. The migration changes physical-tag creation: reserve before binding. Do not apply it independently of client rollout coordination.
- Existing untracked Postman collections and manual SQL files are outside this change and are not included in the merge commit.