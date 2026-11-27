// TC-APP-03 Forgot password: a fresh code works; "This code has expired, request a new one"
// only when it really has; a second request cancels the first code and the app says so.
// Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPIRED_TEXT,
  NEW_CODE_SENT_TEXT,
  NOT_NEWEST_TEXT,
  RESET_CODE_LIFETIME_MS,
  TOO_SOON_TEXT,
  WRONG_CODE_TEXT,
  afterSend,
  cleanResetCode,
  isTooSoon,
  resetCodeProblem,
  resetEmail,
  verifyErrorMessage,
} from './passwordReset.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

// What Supabase answers for a wrong OR an expired recovery code.
const refused = { name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' };
const minute = 60 * 1000;

test('a fresh code is accepted as typed or pasted (6 digits by default, up to 10)', () => {
  assert.equal(cleanResetCode(' 123 456 '), '123456');
  assert.equal(cleanResetCode('123-456'), '123456');
  assert.equal(resetCodeProblem('123456'), null);
  assert.equal(resetCodeProblem('12345678'), null);
  assert.equal(resetCodeProblem('1234567890'), null);
  assert.match(resetCodeProblem('12345'), /code from the email/);
  assert.match(resetCodeProblem('12345a'), /numbers only/);
  assert.match(resetCodeProblem('12345678901'), /code from the email/);
});

test('"This code has expired" only when the code really is older than its lifetime', () => {
  const sentAt = Date.parse('2026-11-27T08:00:00Z');
  const request = { email: 'botanist@example.org', sentAt, count: 1 };
  // Two minutes later: not expired, so it isn't called expired.
  assert.equal(verifyErrorMessage(refused, request, sentAt + 2 * minute), WRONG_CODE_TEXT);
  assert.notEqual(verifyErrorMessage(refused, request, sentAt + 2 * minute), EXPIRED_TEXT);
  // Past the lifetime (1 hour, Supabase's default).
  assert.equal(RESET_CODE_LIFETIME_MS, 60 * minute);
  assert.equal(verifyErrorMessage(refused, request, sentAt + 61 * minute), EXPIRED_TEXT);
  assert.equal(EXPIRED_TEXT, 'This code has expired, request a new one.');
  // Supabase's own words are never shown.
  for (const message of [
    verifyErrorMessage(refused, request, sentAt + 2 * minute),
    verifyErrorMessage(refused, request, sentAt + 61 * minute),
  ]) assert.doesNotMatch(message, /Token has expired or is invalid/);
});

test('a second request cancels the first code, and the app says to use the newest one', () => {
  const first = afterSend(null, 'botanist@example.org', { ok: true }, 1000);
  assert.deepEqual(first.request, { email: 'botanist@example.org', sentAt: 1000, count: 1 });
  assert.equal(first.ok, true);
  const second = afterSend(first.request, 'botanist@example.org', { ok: true }, 200000);
  assert.deepEqual(second.request, { email: 'botanist@example.org', sentAt: 200000, count: 2 });
  assert.equal(second.message, NEW_CODE_SENT_TEXT);
  // Typing the first email's code now is refused: not "expired", but "use the newest".
  assert.equal(verifyErrorMessage(refused, second.request, 260000), NOT_NEWEST_TEXT);
  // Another email starts again at 1.
  assert.equal(afterSend(second.request, 'other@example.org', { ok: true }, 300000).request.count, 1);
});

test('a request Supabase refuses as too soon keeps the earlier code (it still works)', () => {
  const tooSoon = { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' };
  assert.equal(isTooSoon(tooSoon), true);
  const first = afterSend(null, 'botanist@example.org', { ok: true }, 1000).request;
  const again = afterSend(first, 'botanist@example.org', { ok: false, error: tooSoon }, 20000);
  assert.equal(again.ok, false);
  assert.equal(again.request, first);
  assert.equal(again.message, TOO_SOON_TEXT);
  // The earlier code, typed wrong, is not called "not the newest".
  assert.equal(verifyErrorMessage(refused, again.request, 30000), WRONG_CODE_TEXT);
});

test('only an email address is accepted (a staff ID lookup cannot work before sign-in)', () => {
  assert.equal(resetEmail('  Botanist@Example.org '), 'botanist@example.org');
  assert.equal(resetEmail('BOT-001'), null);
  assert.equal(resetEmail('a@b'), null);
  assert.equal(resetEmail('a b@example.org'), null);
});

test('the screen asks Supabase for a recovery code and checks the newest one', () => {
  const screen = read('../../app/forgot-password.tsx');
  assert.match(screen, /supabase\.auth\.resetPasswordForEmail\(targetEmail\)/);
  assert.match(screen, /verifyOtp\(\{\s*email: resolvedEmail,\s*token: cleanCode,\s*type: 'recovery',\s*\}\)/);
  assert.match(screen, /const cleanCode = cleanResetCode\(verificationCode\);/);
  assert.match(screen, /text2: verifyErrorMessage\(error, request, Date\.now\(\)\)/);
  assert.match(screen, /afterSend\(request, targetEmail,/);
  // A new code clears the old one from the box.
  assert.match(screen, /if \(next\.ok\) \{[\s\S]*?setVerificationCode\(''\);/);
  assert.match(screen, /maxLength=\{RESET_CODE_MAX_DIGITS\}/);
  assert.match(screen, /Requesting a new code cancels the earlier ones\./);
  // No staff-ID lookup in profiles (it can't be read before sign-in) and no raw Supabase text.
  assert.doesNotMatch(screen, /from\('profiles'\)/);
  assert.doesNotMatch(screen, /error\.message \|\| 'Verification code failed or expired\.'/);
});
