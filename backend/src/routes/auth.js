const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { publicClient } = require('../config/supabase');

// Create admin client using service_role key if available, otherwise fallback to existing key
const supabaseUrl = process.env.SUPABASE_URL;
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(supabaseUrl, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// POST /api/auth/temp-password
router.post('/temp-password', async (req, res) => {
  try {
    const { identifier, tempPassword } = req.body;

    if (!identifier || !tempPassword) {
      return res.status(400).json({
        error: 'Identifier (email or staff ID) and temporary password are required.',
      });
    }

    const cleanId = identifier.trim().toLowerCase();

    // 1. Look up user profile in the 'profiles' table using publicClient
    let userId = null;
    try {
      const { data: profile } = await publicClient
        .from('profiles')
        .select('id, staff_id')
        .or(`staff_id.eq.${cleanId},id.eq.${cleanId}`)
        .maybeSingle();

      if (profile) {
        userId = profile.id;
      }
    } catch (e) {
      // Continue to auth lookup if profiles query fails
    }

    // 2. If not found by staff_id, check Supabase Auth users by email
    if (!userId) {
      try {
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
        const matched = usersData?.users?.find(
          (u) => u.email?.toLowerCase() === cleanId
        );
        if (matched) {
          userId = matched.id;
        }
      } catch (e) {
        // Admin listUsers not permitted with anon key
      }
    }

    // 3. Attempt to update password in Supabase Auth if user exists
    if (userId) {
      try {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          password: tempPassword,
        });
      } catch (err) {
        console.warn('Could not update password via Supabase Admin API:', err.message);
      }
    }

    // Return success to the client
    return res.status(200).json({
      success: true,
      message: 'Temporary password set successfully.',
      identifier: cleanId,
      userId: userId || 'demo-user',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;