// passwordReset.ts - "Forgot password" with an emailed code (Supabase recovery OTP).
//   - The code is the one in the NEWEST email: requesting a new code cancels the earlier
//     ones (Supabase keeps one recovery code per account). A request within about a minute
//     of the last one is refused by Supabase, and then the earlier code still works.
//   - Supabase answers both a wrong and an expired code with "Token has expired or is
//     invalid", so the app decides which it is from when the code was sent: "This code has
//     expired, request a new one" only once it really is older than the code's lifetime.
//   - Codes are 6 to 10 digits (the project's "Email OTP length"; 6 by default).
// Plain TypeScript with no imports, so Node can test it (passwordReset.test.mjs).

// Supabase "Email OTP Expiration" (Authentication > Providers > Email); 1 hour by default.
// Keep this the same as the project setting.
export const RESET_CODE_LIFETIME_MS = 60 * 60 * 1000;
export const RESET_CODE_MIN_DIGITS = 6;
export const RESET_CODE_MAX_DIGITS = 10;

export const EXPIRED_TEXT = 'This code has expired, request a new one.';
export const WRONG_CODE_TEXT = "That code isn't right. Check the code in the email and try again.";
export const NOT_NEWEST_TEXT =
  "That code isn't right. Only the code in the newest email works: requesting a new code cancels the earlier ones.";
export const TOO_SOON_TEXT =
  'A code was sent less than a minute ago. Use the code in that email, or wait a minute and request a new one.';
export const NEW_CODE_SENT_TEXT = 'New code sent. Only the code in the newest email works.';
export const EMAIL_NEEDED_TEXT = 'Enter the email address of your account.';

/** One "send code" request: who, when, and how many codes have been sent to them here. */
export interface ResetRequest {
  email: string;
  sentAt: number;
  count: number;
}

/** The typed code with spaces and dashes removed (a code pasted from the email). */
export function cleanResetCode(text: string): string {
  return String(text ?? '').replace(/[\s-]/g, '');
}

/** Why this code can't be checked yet, or null. */
export function resetCodeProblem(code: string): string | null {
  if (!/^\d+$/.test(code) || code.length < RESET_CODE_MIN_DIGITS || code.length > RESET_CODE_MAX_DIGITS) {
    return 'Enter the code from the email (numbers only).';
  }
  return null;
}

/** The email to send the code to, or null (the app takes an email address only). */
export function resetEmail(text: string): string | null {
  const email = String(text ?? '').trim().toLowerCase();
  const at = email.indexOf('@');
  return at > 0 && at === email.lastIndexOf('@') && email.lastIndexOf('.') > at + 1 && !/\s/.test(email) ? email : null;
}

interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

function errorOf(error: unknown): AuthErrorLike {
  return error && typeof error === 'object' ? (error as AuthErrorLike) : { message: String(error ?? '') };
}

/** Supabase refused a new request because one was sent moments ago (the old code still works). */
export function isTooSoon(error: unknown): boolean {
  const { message = '', code = '', status } = errorOf(error);
  return status === 429 || code === 'over_email_send_rate_limit' || /only request this after|rate limit/i.test(message);
}

/**
 * The request after "Send code": a new request (count 1), or the next one for the same
 * email (count + 1, which cancels the earlier codes). A request Supabase refused as too soon
 * keeps the previous one (its code still works).
 */
export function afterSend(
  previous: ResetRequest | null,
  email: string,
  result: { ok: true } | { ok: false; error: unknown },
  now: number
): { request: ResetRequest | null; message: string; ok: boolean } {
  if (!result.ok) {
    if (isTooSoon(result.error) && previous && previous.email === email) {
      return { request: previous, message: TOO_SOON_TEXT, ok: false };
    }
    return {
      request: previous,
      message: isTooSoon(result.error) ? TOO_SOON_TEXT : 'The code could not be sent. Check your connection and try again.',
      ok: false,
    };
  }
  const count = previous && previous.email === email ? previous.count + 1 : 1;
  return {
    request: { email, sentAt: now, count },
    message: count > 1 ? NEW_CODE_SENT_TEXT : `A code was sent to ${email}. Use the code in the newest email.`,
    ok: true,
  };
}

/** The message for a code Supabase refused. */
export function verifyErrorMessage(error: unknown, request: ResetRequest | null, now: number): string {
  const { message = '', code = '', status } = errorOf(error);
  const refusedCode = code === 'otp_expired' || code === 'otp_disabled' || /token has expired or is invalid|invalid.*otp|otp.*(expired|invalid)/i.test(message);
  if (refusedCode) {
    if (request && now - request.sentAt >= RESET_CODE_LIFETIME_MS) return EXPIRED_TEXT;
    return request && request.count > 1 ? NOT_NEWEST_TEXT : WRONG_CODE_TEXT;
  }
  if (status === 429 || /rate limit|too many/i.test(message)) return 'Too many tries. Wait a few minutes, then try again.';
  if (/network|fetch/i.test(message)) return 'No connection. Check your internet and try again.';
  if (/password/i.test(message)) return message;
  return 'The password could not be changed. Please try again.';
}
