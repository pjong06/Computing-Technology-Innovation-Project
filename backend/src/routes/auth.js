const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const recoveryClient = process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  : null;

const GENERIC_MESSAGE = 'If an account exists for that email, a password reset link will be sent.';
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 10;
const MAX_PER_EMAIL = 3;

function createAuthRouter(client = recoveryClient, now = () => Date.now()) {
  const router = express.Router();
  const attempts = new Map();

  function limited(key, max) {
    const time = now();
    const previous = attempts.get(key) || [];
    const recent = previous.filter((stamp) => time - stamp < WINDOW_MS);
    if (recent.length >= max) {
      attempts.set(key, recent);
      return true;
    }
    recent.push(time);
    attempts.set(key, recent);
    return false;
  }

  router.post('/forgot-password', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ipLimited = limited(`ip:${ip}`, MAX_PER_IP);
    const emailLimited = limited(`email:${email}`, MAX_PER_EMAIL);
    if (ipLimited || emailLimited) {
      res.set('Retry-After', '3600');
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    if (!client) {
      return res.status(503).json({ error: 'Password recovery is temporarily unavailable.' });
    }

    const redirectTo = process.env.PASSWORD_RESET_REDIRECT_URL;
    if (!redirectTo) {
      console.error('PASSWORD_RESET_REDIRECT_URL is not configured');
      return res.status(503).json({ error: 'Password recovery is temporarily unavailable.' });
    }

    try {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        console.warn('Password recovery request failed:', error.code || error.status || 'unknown');
      }
    } catch (error) {
      console.warn('Password recovery request failed:', error.code || 'network_error');
    }
    return res.status(202).json({ message: GENERIC_MESSAGE });
  });

  return router;
}

module.exports = createAuthRouter();
module.exports.createAuthRouter = createAuthRouter;
