const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and a Supabase publishable key must be configured");
}

const authOptions = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
};

// Public knowledge queries use the publishable key and database RLS.
const publicClient = createClient(supabaseUrl, supabaseKey, { auth: authOptions });
const verifier = publicClient;

// A separate client per request keeps one user's JWT out of other requests.
function forUser(accessToken) {
    return createClient(supabaseUrl, supabaseKey, {
        auth: authOptions,
        global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });
}

module.exports = { publicClient, verifier, forUser };
