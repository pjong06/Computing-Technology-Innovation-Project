const express = require('express');
const { createHash } = require('node:crypto');

const GENERIC_MESSAGE = 'If an account exists, recovery instructions will be sent to its email.';
const INVALID_RECOVERY = 'Recovery link is invalid or expired. Request a new email.';

function defaultClient() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Recovery configuration unavailable');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Bounded process-local throttling. Use shared gateway limits for multi-instance deployments.
function createLimiter(now) {
  const buckets = new Map();
  return (key, maximum) => {
    const time = now();
    for (const [id, item] of buckets) if (item.until <= time) buckets.delete(id);
    let item = buckets.get(key);
    if (!item) {
      if (buckets.size >= 10000) return false;
      item = { count: 0, until: time + 10 * 60 * 1000 };
      buckets.set(key, item);
    }
    item.count += 1;
    return item.count <= maximum;
  };
}

// Basic email shape check with bounded linear scans and no backtracking regex.
function validEmail(email) {
  if (!email || email.length > 254) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const dot = email.lastIndexOf('.');
  if (dot <= at + 1 || dot === email.length - 1) return false;
  for (const character of email) {
    if (character.trim() === '') return false;
  }
  return true;
}

function validRedirect(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash &&
      (url.protocol === 'https:' ||
       (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) ||
       (url.protocol === 'niahbiotrack:' && url.hostname === 'change-password'));
  } catch { return false; }
}

// Optional staff lookup is read-only and separate from the recovery session.
async function defaultStaffEmail(identifier) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('Staff lookup unavailable');
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(process.env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.from('profiles').select('email')
    .eq('staff_id', identifier).maybeSingle();
  if (error) throw new Error('Staff lookup unavailable');
  return typeof data?.email === 'string' ? data.email.trim().toLowerCase() : null;
}

function validStaffId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

function createAuthRouter({ createRecoveryClient = defaultClient, resolveStaffEmail = defaultStaffEmail,
  now = Date.now, config = process.env } = {}) {
  const router = express.Router();
  const allow = createLimiter(now);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // Permanently disabled: caller-selected identities/passwords must not reach admin APIs.
  router.post('/temp-password', (_req, res) => res.status(410).json({
    code: 'TEMP_PASSWORD_DISABLED',
    message: 'Temporary password reset is disabled. Use verified email recovery.',
  }));

  router.post(['/forgot-password', '/send-reset-code'], async (req, res) => {
    if (!allow(`request:${req.ip}`, 20)) {
      return res.status(429).json({ message: 'Too many requests. Try again later.' });
    }
    const input = req.path === '/send-reset-code' ? req.body?.identifier : req.body?.email;
    const identifier = typeof input === 'string' ? input.trim() : '';
    let email = identifier.toLowerCase();
    const staffMode = req.path === '/send-reset-code' && !validEmail(email) && validStaffId(identifier);
    if (!validEmail(email) && !staffMode) {
      return res.status(400).json({ message: 'A valid email address is required.' });
    }
    // Do not send mail until the owner has configured the recovery client and email template.
    if (config.PASSWORD_RECOVERY_ENABLED !== 'true' ||
        !validRedirect(config.PASSWORD_RESET_REDIRECT_URL)) {
      return res.status(503).json({ message: 'Email recovery is not configured. Contact support.' });
    }
    const emailKey = createHash('sha256').update(email).digest('hex');
    if (!allow(`email:${emailKey}`, 3)) {
      return res.status(429).json({ message: 'Too many requests. Try again later.' });
    }
    try {
      if (staffMode) email = await resolveStaffEmail(identifier);
      if (!email || !validEmail(email)) return res.status(202).json({ success: true, email: identifier, message: GENERIC_MESSAGE });
      const client = createRecoveryClient();
      await client.auth.resetPasswordForEmail(email, { redirectTo: config.PASSWORD_RESET_REDIRECT_URL });
      // Identical response for existing/unknown accounts and upstream errors.
    } catch {
      console.warn('Recovery email request failed');
    }
    return res.status(202).json({ success: true, email: staffMode ? identifier : identifier.toLowerCase(), message: GENERIC_MESSAGE });
  });

  router.post(['/reset-password', '/verify-and-change-password'], async (req, res) => {
    if (!allow(`reset:${req.ip}`, 20)) {
      return res.status(429).json({ message: 'Too many requests. Try again later.' });
    }
    if (config.PASSWORD_RECOVERY_ENABLED !== 'true') {
      return res.status(503).json({ message: 'Email recovery is not configured. Contact support.' });
    }
    const otpMode = req.path === '/verify-and-change-password';
    const inputBody = req.body;
    if (otpMode && (!inputBody || typeof inputBody !== 'object' || Array.isArray(inputBody) ||
        Object.keys(inputBody).some(key => !['email', 'code', 'newPassword'].includes(key)))) {
      return res.status(400).json({ message: 'Provide only email, code and newPassword.' });
    }
    const body = otpMode ? { token_hash: inputBody.code, password: inputBody.newPassword } : inputBody;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['token_hash', 'password'].includes(key))) {
      return res.status(400).json({ message: 'Provide only token_hash and password.' });
    }
    const { token_hash: tokenHash, password } = body;
    const otpIdentifier = typeof inputBody?.email === 'string' ? inputBody.email.trim() : '';
    let otpEmail = otpIdentifier.toLowerCase();
    const validProof = otpMode ? (validEmail(otpEmail) || validStaffId(otpIdentifier)) && typeof tokenHash === 'string' && /^[0-9]{6}$/.test(tokenHash)
      : typeof tokenHash === 'string' && /^[A-Za-z0-9_-]{20,256}$/.test(tokenHash);
    if (!validProof) {
      return res.status(401).json({ message: INVALID_RECOVERY });
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128 ||
        !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ message: 'Use 12 to 128 characters with uppercase, lowercase and a number.' });
    }
    let client;
    try {
      if (otpMode && !validEmail(otpEmail)) otpEmail = await resolveStaffEmail(otpIdentifier);
      if (otpMode && !validEmail(otpEmail)) return res.status(401).json({ message: INVALID_RECOVERY });
      client = createRecoveryClient();
      const { data, error } = await client.auth.verifyOtp(otpMode ? { email: otpEmail, token: tokenHash, type: 'recovery' }
        : { token_hash: tokenHash, type: 'recovery' });
      const session = data?.session;
      if (error || !session?.access_token || !data?.user?.id ||
          session.user?.id !== data.user.id || !Number.isFinite(session.expires_at) ||
          session.expires_at * 1000 <= now()) {
        return res.status(401).json({ message: INVALID_RECOVERY });
      }
      const verified = await client.auth.getUser(session.access_token);
      if (verified.error || verified.data?.user?.id !== data.user.id) {
        return res.status(401).json({ message: INVALID_RECOVERY });
      }
      const updated = await client.auth.updateUser({ password });
      if (updated.error) {
        return res.status(400).json({ message: 'Password could not be updated. Request a new recovery email.' });
      }
      return res.json({ success: true, message: 'Password updated. Sign in again.' });
    } catch {
      return res.status(503).json({ message: 'Recovery service unavailable. Try again later.' });
    } finally {
      if (client) {
        try { await client.auth.signOut({ scope: 'local' }); }
        catch { console.warn('Recovery session cleanup failed'); }
      }
    }
  });

  return router;
}

module.exports = createAuthRouter();
module.exports.createAuthRouter = createAuthRouter;
