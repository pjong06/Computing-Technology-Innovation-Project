const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

function getAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('[AUTH ERROR] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
    return null;
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Helper to resolve Staff ID or Email to target user details
 */
async function resolveUser(adminClient, identifier) {
  const clean = identifier.trim().toLowerCase();

  // 1. Check public.profiles first
  try {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('id, email, staff_id')
      .or(`email.ilike.${clean},staff_id.ilike.${clean}`)
      .maybeSingle();

    if (profile?.email) {
      return { id: profile.id, email: profile.email };
    }
  } catch (err) {
    console.warn('[PROFILE LOOKUP WARN]', err.message);
  }

  // 2. Fallback check directly in auth.users
  const { data: listData, error: listErr } = await adminClient.auth.admin.listUsers({
    perPage: 1000,
  });

  if (!listErr && listData?.users) {
    const matched = listData.users.find(
      (u) => u.email && u.email.toLowerCase() === clean
    );
    if (matched) {
      return { id: matched.id, email: matched.email };
    }
  }

  return null;
}

/**
 * POST /api/auth/send-reset-code
 * Sends 6-digit OTP verification code to the user's Gmail
 */
router.post('/send-reset-code', async (req, res) => {
  const { identifier } = req.body || {};

  if (!identifier) {
    return res.status(400).json({ error: 'Staff ID or Email is required.' });
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return res.status(500).json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' });
  }

  try {
    const user = await resolveUser(adminClient, identifier);

    if (!user) {
      return res.status(404).json({
        error: `No account found for "${identifier}". Please check your Staff ID or Email.`,
      });
    }

    console.log(`[AUTH] Sending verification email to: ${user.email}`);

    // Trigger Supabase Auth password recovery email
    const { error: resetErr } = await adminClient.auth.resetPasswordForEmail(user.email);

    if (resetErr) {
      console.error('[SUPABASE RESET ERROR]', resetErr.message);
      return res.status(400).json({ error: resetErr.message });
    }

    return res.status(200).json({
      success: true,
      email: user.email,
      message: 'Verification code sent to your email.',
    });
  } catch (err) {
    console.error('[SEND-RESET-CODE EXCEPTION]', err);
    return res.status(500).json({ error: err.message || 'Server error sending verification code.' });
  }
});

/**
 * POST /api/auth/verify-and-change-password
 * Verifies 6-digit OTP and updates password in Supabase Auth
 */
router.post('/verify-and-change-password', async (req, res) => {
  const { email, code, newPassword } = req.body || {};

  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, verification code, and new password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = code.trim();
  const cleanPass = String(newPassword).trim();

  if (cleanPass.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return res.status(500).json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' });
  }

  try {
    console.log(`[AUTH] Verifying recovery OTP for: ${cleanEmail}`);

    // 1. Verify OTP with Supabase Auth
    const { data: verifyData, error: verifyErr } = await adminClient.auth.verifyOtp({
      email: cleanEmail,
      token: cleanCode,
      type: 'recovery',
    });

    if (verifyErr || !verifyData?.user) {
      console.error('[OTP VERIFICATION FAILED]', verifyErr?.message);
      return res.status(400).json({
        error: verifyErr?.message || 'Invalid or expired 6-digit verification code.',
      });
    }

    const userId = verifyData.user.id;
    console.log(`[OTP VERIFIED] Updating password for user ID: ${userId}`);

    // 2. Set new password via Supabase Auth Admin
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, {
      password: cleanPass,
    });

    if (updateErr) {
      console.error('[PASSWORD UPDATE FAILED]', updateErr.message);
      return res.status(400).json({ error: updateErr.message });
    }

    console.log(`[SUCCESS] Password changed successfully for ${cleanEmail}`);
    return res.status(200).json({
      success: true,
      message: 'Password successfully updated.',
    });
  } catch (err) {
    console.error('[CHANGE-PASSWORD EXCEPTION]', err);
    return res.status(500).json({ error: err.message || 'Server error updating password.' });
  }
});

module.exports = router;
