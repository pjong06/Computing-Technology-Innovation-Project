require('dotenv').config();
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

function createAuthRouter({ createRecoveryClient = defaultClient,
  now = Date.now, config = process.env } = {}) {
  const router = express.Router();
  const allow = createLimiter(now);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.post('/temp-password', async (req, res) => {
    const { identifier, tempPassword } = req.body || {};
    if (!identifier || !tempPassword) {
      return res.status(400).json({ error: 'Identifier and tempPassword are required.' });
    }

    const clean = identifier.trim().toLowerCase();
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_KEY;

    if (!serviceKey) {
      console.error('Missing service key in backend/.env');
      return res.status(500).json({ error: 'Missing SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY in backend/.env' });
    }

    try {
      const { createClient } = require('@supabase/supabase-js');
      const adminClient = createClient(
        process.env.SUPABASE_URL,
        serviceKey,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );

      // 1. Fetch auth users directly — ignores any missing columns in public.profiles
      const { data, error: listErr } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });

      if (listErr) {
        console.error('List users error:', listErr);
        return res.status(500).json({ error: `Auth lookup failed: ${listErr.message}` });
      }

      const targetUser = data.users.find(
        (u) => u.email?.toLowerCase() === clean
      );

      if (!targetUser) {
        return res.status(404).json({ error: `No account found with email "${clean}".` });
      }

      // 2. Update password directly via Supabase Auth Admin
      const { error: updateErr } = await adminClient.auth.admin.updateUserById(targetUser.id, {
        password: tempPassword,
      });

      if (updateErr) {
        console.error('Auth admin update error:', updateErr);
        return res.status(500).json({ error: updateErr.message });
      }

      return res.status(200).json({
        success: true,
        message: 'Temporary password updated in database.',
        email: targetUser.email,
      });
    } catch (err) {
      console.error('Temp password exception:', err);
      return res.status(500).json({ error: err.message || 'Server error updating password' });
    }
  });
  
  router.post('/forgot-password', async (req, res) => {
    if (!allow(`request:${req.ip}`, 20)) {
      return res.status(429).json({ message: 'Too many requests. Try again later.' });
    }
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!validEmail(email)) {
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
      const client = createRecoveryClient();
      await client.auth.resetPasswordForEmail(email, { redirectTo: config.PASSWORD_RESET_REDIRECT_URL });
      // Identical response for existing/unknown accounts and upstream errors.
    } catch {
      console.warn('Recovery email request failed');
    }
    return res.status(202).json({ message: GENERIC_MESSAGE });
  });

  router.post('/reset-password', async (req, res) => {
    if (!allow(`reset:${req.ip}`, 20)) {
      return res.status(429).json({ message: 'Too many requests. Try again later.' });
    }
    if (config.PASSWORD_RECOVERY_ENABLED !== 'true') {
      return res.status(503).json({ message: 'Email recovery is not configured. Contact support.' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['token_hash', 'password'].includes(key))) {
      return res.status(400).json({ message: 'Provide only token_hash and password.' });
    }
    const { token_hash: tokenHash, password } = body;
    if (typeof tokenHash !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(tokenHash)) {
      return res.status(401).json({ message: INVALID_RECOVERY });
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128 ||
        !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ message: 'Use 12 to 128 characters with uppercase, lowercase and a number.' });
    }
    // A fresh client per request prevents recovery sessions leaking between users.
    let client;
    try {
      client = createRecoveryClient();
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      const session = data?.session;
      if (error || !session?.access_token || !data?.user?.id ||
          session.user?.id !== data.user.id || !Number.isFinite(session.expires_at) ||
          session.expires_at * 1000 <= now()) {
        return res.status(401).json({ message: INVALID_RECOVERY });
      }
      // Verify with Supabase Auth; do not trust locally decoded token claims or getSession alone.
      const verified = await client.auth.getUser(session.access_token);
      if (verified.error || verified.data?.user?.id !== data.user.id) {
        return res.status(401).json({ message: INVALID_RECOVERY });
      }
      const updated = await client.auth.updateUser({ password });
      if (updated.error) {
        return res.status(400).json({ message: 'Password could not be updated. Request a new recovery email.' });
      }
      return res.json({ message: 'Password updated. Sign in again.' });
    } catch {
      return res.status(503).json({ message: 'Recovery service unavailable. Try again later.' });
    } finally {
      // Revoke the newly created recovery session; do not expose tokens in responses.
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
