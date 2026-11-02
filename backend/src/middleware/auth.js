// Import Supabase clients for token verification and user-specific requests
const { verifier, forUser } = require("../config/supabase");
const { hasExpectedClaims } = require('./verifiedJwtClaims');

// Define the roles that are considered staff
const STAFF_ROLES = new Set(["botanist", "officer", "researcher", "admin"]);

// Middleware: check whether the user is authenticated
async function requireAuth(req, res, next) {
    // Get the Bearer token from the Authorization header
    const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ message: "Bearer token required" });

    try {
        // Use the token to verify and get the logged-in user
        const { data: { user }, error: userError } = await verifier.auth.getUser(match[1]);
        if (userError || !user) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }

        if (!hasExpectedClaims(match[1], user.id, process.env.SUPABASE_URL)) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }

        // Create a Supabase client using this user's token
        const userClient = forUser(match[1]);

        // Get the user's role and account status from profiles
        const { data: profile, error: profileError } = await userClient
            .from("profiles")
            .select("id, role, account_status")
            .eq("id", user.id)
            .maybeSingle();

        // Return error if profile permissions cannot be checked
        if (profileError) {
            return res.status(503).json({ message: "Unable to check account permissions" });
        }

        // Only allow active staff accounts
        if (!profile || profile.account_status !== "active" || !STAFF_ROLES.has(profile.role)) {
            return res.status(403).json({ message: "Active staff profile required" });
        }

        // Store user information for the next middleware/route
        req.user = user;
        req.profile = profile;
        req.supabase = userClient;

        // Continue to the next middleware/route
        next();
    } catch (error) {
        return res.status(503).json({ message: "Authentication service unavailable" });
    }
}

// Middleware: check whether the user has an allowed role
function requireRole(...roles) {
    return (req, res, next) => {
        // Reject users whose role is not allowed
        if (!req.profile || !roles.includes(req.profile.role)) {
            return res.status(403).json({ message: "Insufficient permissions" });
        }

        // Role is allowed, continue
        next();
    };
}

// Export functions so other files can use them
module.exports = { requireAuth, requireRole, STAFF_ROLES };
