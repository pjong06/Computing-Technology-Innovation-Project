# Authentication security changes and mobile handover

Prepared: 1 November 2026. Branch: `steven/sprint-2-security`.

## Changes in this authentication commit

- Verify issuer, authenticated audience and subject after Supabase `getUser` authenticates the original JWT. Wrong or missing claims receive the existing generic 401 before profile lookup.
- Retire `POST /api/auth/temp-password` with HTTP 410 / `TEMP_PASSWORD_DISABLED` and `Cache-Control: no-store`. Remove privileged client initialization, account lookup and caller-directed password replacement. No replacement recovery endpoint is implemented here.
- Update the backend dependency lockfile to body-parser 2.4.0, multer 2.5.0 and transitive qs 6.17.0, addressing the two previously reported advisories.
- Include repeatable JWT, account/session and endpoint checks plus sanitized final JWT/session and before/after endpoint evidence. No environment files or credentials are included.

## Verification and evidence scope

Run `npm ci`, then `npm test` in backend. Claim tests use an isolated trusted signing key and exercise the actual middleware; they do not reproduce Supabase internal signing verification. The live-session regression subsequently accepted a genuine project JWT.

Pre-commit validation on 1 November: a snapshot generated from the staged Git tree (excluding parallel tasks) passed all 28 included backend tests. Focused auth regressions passed 14/14. Tests used the isolated checkout's locked dependency installation through NODE_PATH; no claim is made here of a fresh dependency install or new production audit. `git diff --cached --check` passed. The working-tree 34-test total includes additional tests from parallel tasks and is not this commit's suite count.

Saved local evidence:

| File | Result and limit |
| --- | --- |
| jwt-expiry-1793349353029-results.json | 20/20 PASS: genuine expiry plus negative-token and error-body checks, original local baseline |
| auth-session-1793457073297-results.json | Four assertions PASS; old access JWT after local logout returned 401 as an observation, not a universal revocation guarantee |
| endpoint-auth-1793457585058-results.json | Pre-fix inventory; 72 staff-JWT assertions PASS and AUTH-RESET-01 OPEN |
| endpoint-auth-1793457876802-results.json | Post-fix inventory; 73 assertions PASS including retired-password 410 |

The saved endpoint inventory included uncommitted IoT/public-QR work from other tasks. Source hashes identify that working-tree snapshot; do not label its 47-route count as this auth-only commit's exact route count. The inventory script adapts to the optional ingestion mount. Run it against the final integrated/deployed source as appropriate.

Interactive scripts read backend/.env when available, otherwise the original local checkout's ignored .env as a development convenience. Never put a privileged service-role key in the public user-scoped client configuration. Test sessions are memory-only; passwords and tokens are not saved. The genuine-expiry test uses port 3002, session test 3003, endpoint test 3004; none starts the app on the user's existing port 3000.

## Mobile/auth owner handover

The mobile temporary-password caller must stop using the retired route. Implement a separately verified Supabase recovery/session flow; the disabled endpoint must not be re-enabled merely to restore the shortcut. Deploy the security fix before configuring any privileged key for that old route.

Current logout descriptions supplied by Steven: current-phone sign-out with local session removal; an unsynced-data warning before destructive logout; synced local records/photos may remain on the no-unsynced-data path. These descriptions are not a fresh device verification in this commit.

Decisions still required from the auth/mobile owner:

1. Current-device versus all-device logout.
2. Whether immediate old-access-JWT invalidation is a product requirement; client token deletion and refresh revocation are distinct.
3. Offline logout behavior and honest server-revocation status.
4. Whether unsynced work is retained per account or deleted after an explicit warning, and how account-switch isolation is enforced.

Steven's recommendation, awaiting team approval: default current-device logout; clear local credentials immediately; revoke the current refresh session online; clearly distinguish offline local logout from confirmed server revocation; retain unsynced work under account isolation rather than silently delete it. Fix synced-cache cross-account exposure. Do not mark these recommendations as implemented.

Mobile SecureStore/offline encryption implementation and device testing remain on hold for Steven. This commit changes no mobile files. It includes no IoT persistence, public QR limiter or Storage implementation from the parallel tasks.

## Release follow-up

- Review and merge through the team's PR process.
- Auth/mobile owner acknowledges retired endpoint and chooses logout/recovery behavior.
- Record actual deployed HTTPS URL and commit, then repeat required rejection/role tests there.
- Keep the original historical evidence; no need to rerun the one-hour expiry solely for documentation.
