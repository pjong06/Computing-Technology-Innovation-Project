# Tester password recovery

`POST /api/auth/forgot-password` accepts JSON `{ "email": "tester@example.com" }`.
A valid request returns HTTP 202 with the same message whether the account exists, Supabase reaches an email quota, or mail delivery fails. Invalid email returns 400. Local rate limits return 429 and `Retry-After: 3600`. The limit is 10 requests per IP and 3 per email per hour per backend process. For multiple replicas, use a shared rate-limit store and configure the trusted proxy before launch.

The endpoint uses `SUPABASE_PUBLISHABLE_KEY` through a dedicated recovery client. It never uses a service role. `/api/auth/temp-password` was removed because it allowed an unauthenticated caller to change a password by email or staff ID.

## Setup

1. Set `PASSWORD_RESET_REDIRECT_URL=niahbiotrack://change-password` on the backend. Add that exact URI to Supabase Auth URL Configuration > Redirect URLs.
2. Configure Supabase Auth email delivery with a production SMTP provider and a suitable sending quota. Supabase's default mail service has restrictive limits and may not deliver to arbitrary tester addresses. Confirm the reset email template and sender before testing.
3. Set `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the mobile app. Never put a service role or secret key in an `EXPO_PUBLIC_` variable.
4. Install and run the mobile app with its `niahbiotrack` URL scheme. A tester opens the emailed link on the device, enters a new password, and signs in again. The app uses the recovery session from the link and `supabase.auth.updateUser`. An email alone cannot authorize this step.

The separate `frontend/` officer portal uses local demo account storage, not Supabase Auth. This flow applies to the Expo mobile app's Supabase login. The portal would require an auth migration before its users could use Supabase recovery.


