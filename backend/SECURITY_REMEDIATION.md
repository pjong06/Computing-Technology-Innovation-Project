# Security remediation and recovery design

## Completed changes

- The unauthenticated `POST /api/auth/temp-password` endpoint now always returns 410. The route no longer creates an admin client, lists users, accepts a target user ID, or invokes `auth.admin.updateUserById`. This remains disabled even when legacy admin environment variables are configured.
- Login and registration screens and their Supabase calls were not changed. No existing passwords were changed during implementation or testing.
- Package-lock-only updates stay within the existing declared dependency ranges: body-parser 2.3.0 to 2.4.0, multer 2.4.0 to 2.5.0, qs 6.16.0 to 6.17.1. No --force and no major-version upgrade were used.
- GitHub installation uses `npm ci --ignore-scripts`. Both the benchmark and normal Express server disable X-Powered-By.
- backend/.gitignore now excludes `.env.*` while preserving the `.env.example` template. `.env.sender` is ignored and untracked.

## Token exposure review

The current tracked-text scan found no matching real private key, privileged Supabase key, GitHub token, JWT, credential URL or suspicious quoted credential assignment. The exact local sender token was compared against 1,075 blobs reachable from local refs and reflogs, including stash history: zero matches. The sender filename has no commit history in this clone. This is not a guarantee about inaccessible remote branches, other clones, deleted unreachable objects, CI logs, backups or messages.

No evidence requiring immediate rotation was found. If any external disclosure is suspected, coordinate rotation with the IoT owner: generate a new high-entropy ingestion token, replace it on receiver and sender using secret storage, restart/redeploy both, verify ingestion and confirm the old token is rejected. Do not print tokens in logs, commit them, or rewrite shared Git history without team agreement. Rotation was not performed here.

## Safe email recovery contract

The backend implementation is present but disabled by default. Enable it only after the client and Supabase email template are ready. No shared dashboard, template, user or database configuration was changed.

1. A client submits `{ "email": "user@example.test" }` to `POST /api/auth/forgot-password`.
2. The backend uses a fresh public-key Supabase client and `resetPasswordForEmail` with a server-configured redirect, never a caller-selected URL. It returns the same 202 message for known/unknown accounts and provider errors. Basic bounded per-IP and per-email throttles limit abuse.
3. Configure the Supabase **Reset Password** email template to deliver `{{ .TokenHash }}` to a trusted recovery page/app as a recovery proof, for example:

```html
<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
```

The configured destination must have no fragment already and must be allowlisted in Supabase Auth URL configuration. The fragment form avoids sending the token in the initial page request URL. Do not put tokens into analytics, access logs, third-party scripts, browser localStorage or crash reports.

4. The recovery client reads the fragment, removes it from address/history, collects the new password, and POSTs `{ "token_hash": "...", "password": "..." }` over HTTPS to `/api/auth/reset-password`. It must not consume the token with verifyOtp first: the backend performs that exchange once. Merely opening the form or making a GET must not reset a password.
5. The backend forces `verifyOtp({ token_hash, type: 'recovery' })`. It requires a returned session, a matching user ID and unexpired expires_at, then calls getUser against Supabase to verify the access token. Only then does updateUser change that verified user's password. Client-supplied IDs, access tokens and recovery-type claims are rejected.
6. A fresh Supabase client isolates each request. Recovery responses are no-store and expose no session tokens. The temporary recovery session is signed out locally in finally. Ask the user to log in again. This does not claim that every previously issued access token is immediately invalidated; access-token expiry and project-wide session policy remain relevant.
7. Invalid, expired, reused or wrong-purpose proofs must fail Supabase verification. An unsuccessful update after consuming a token requires a new email. Tests use fixtures only; no real email or password change was attempted.

## Deployment prerequisites and limits

Configure these on the backend only after reviewing the client and email template:

```dotenv
PASSWORD_RECOVERY_ENABLED=false
PASSWORD_RESET_REDIRECT_URL=https://your-approved-domain.example/recovery
```

Set ENABLED=true only after the setup is validated. HTTPS is required except explicit localhost development URLs; the registered niahbiotrack://change-password scheme is accepted only as an explicitly configured native destination. The existing mobile forgot-password page still calls the disabled old endpoint and therefore cannot generate a temporary password. Its change-password screen is not yet integrated with the new recovery contract. This deliberate break is the approved security-first behavior, not a completed mobile email-recovery rollout.

Use only SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY or a legacy anon key. No service-role secret is required. New passwords require 12 to 128 characters with uppercase, lowercase and a number; Supabase may enforce stronger configured requirements.

The request limiter is process-local and does not replace gateway/shared limits in a multi-instance deployment. Configure Supabase SMTP/rate limits and consider CAPTCHA before public rollout. Live end-to-end email delivery and existing-account login still need designated test accounts and owner-approved setup. This change adds no Login/Register API and does not alter existing registration authorization policies.

## Verification

Run a clean `npm ci --ignore-scripts`, `npm test`, and `npm audit` in backend. Tests mock all recovery, signup and sign-in network responses. Covered cases include old endpoint denial, missing/invalid/expired proof, mismatched identity, ordinary-login token rejection, weak passwords, provider failure, no-store responses, session cleanup, throttling and normal Supabase sign-in/signup contracts. See `security-results` for the recorded output. SonarQube must complete a fresh cloud analysis before its Quality Gate can be declared passed.

## Email validation follow-up

The recovery email regex was replaced by bounded linear string checks for a single @, a domain dot and whitespace. Two regression tests cover malformed/adversarial inputs and normal addresses. All 85 backend tests passed after this change; no live email or password operations were performed.
