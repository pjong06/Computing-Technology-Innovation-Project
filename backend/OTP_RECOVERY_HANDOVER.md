# OTP recovery compatibility / security

Keep new mobile POST /send-reset-code {identifier} and POST /verify-and-change-password {email,code,newPassword}; email field can carry the echoed staff identifier. Existing /forgot-password and /reset-password token-hash clients remain supported. Export both Express router and injectable createAuthRouter for tests.

Recovery uses an isolated public-key client per request, verifyOtp(type=recovery), unexpired matching session/user, getUser verification and updateUser. Admin updateUserById is not used. Staff ID resolution is a separate exact profiles.staff_id read using the existing backend-only service credential when required; it does not list auth users. It does not grant that credential limited privileges. Staff lookup needs existing SELECT access to profile email/staff_id; no grants are changed.

Configure PASSWORD_RECOVERY_ENABLED=true and a trusted PASSWORD_RESET_REDIRECT_URL only after owner verifies Supabase recovery email template (OTP token for OTP screen), allowed redirects and device delivery. Public-key recovery client needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY. Staff lookup needs existing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY, never a mobile key. Keep all values private. No production settings were changed.

Responses for email submission are generic 202 success, including unknown staff; returned email echoes caller input, not resolved account email. Mobile must treat 202 as accepted, not proof account/email delivery exists. Rate limits are bounded and process-local; multi-instance/proxy behavior still requires deployed acceptance.

Password policy remains the earlier security contract: 12–128 characters with upper/lowercase and number. The newer mobile UI's 8-character minimum should be aligned by its owner; weaker input is safely rejected by backend. OTP is six decimal digits, not trimmed/coerced. Caller-selected user IDs/tokens are rejected. Provider errors are sanitized; recovery sessions are cleaned locally. Legacy unsafe /temp-password stays 410.

172 mock/local HTTP backend tests passed including OTP success, invalid/expired OTP, identity overposting, staff flow, enumeration protection, throttling and existing token-hash security tests. No email, real password reset or Supabase credential was used. Real mobile/email template/configuration acceptance remains pending; please coordinate with Guan Ming before merging/deploying.
