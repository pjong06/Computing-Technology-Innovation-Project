// Import Supabase clients for token verification and user-specific requests
const { verifier, forUser } = require("../config/supabase");
const { hasExpectedClaims } = require('./verifiedJwtClaims');
const { parseBearerToken } = require('./bearerToken');

// Define the roles that are considered staff
const STAFF_ROLES = new Set(["botanist", "officer", "researcher", "admin"]);

// Every signed-in account: staff plus visitor accounts (made by the mobile app's
// "Create a free account"). Only /api/me uses this; every other route uses requireAuth,
// so visitors can never reach staff data.
const ACCOUNT_ROLES = new Set([...STAFF_ROLES, "visitor"]);

// Builds the authentication middleware for one set of allowed roles.
function authenticateFor(allowedRoles, refusedMessage) {
    return async function authenticate(req, res, next) {
        // Get the Bearer token from the Authorization header
        const token = parseBearerToken(req.get("authorization"));
        if (!token) return res.status(401).json({ message: "Bearer token required" });

        try {
            // Use the token to verify and get the logged-in user
            const { data: { user }, error: userError } = await verifier.auth.getUser(token);
            if (userError || !user) {
                return res.status(401).json({ message: "Invalid or expired token" });
            }

            if (!hasExpectedClaims(token, user.id, process.env.SUPABASE_URL)) {
                return res.status(401).json({ message: "Invalid or expired token" });
            }

            // Create a Supabase client using this user's token
            const userClient = forUser(token);

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

            // Only allow active accounts with one of the allowed roles
            if (!profile || profile.account_status !== "active" || !allowedRoles.has(profile.role)) {
                return res.status(403).json({ message: refusedMessage });
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
    };
}

// Middleware: an active STAFF account (botanist, officer, researcher, admin). Used by every
// staff route.
const requireAuth = authenticateFor(STAFF_ROLES, "Active staff profile required");

// Middleware: any active account, including visitors. Only for /api/me.
const requireAccount = authenticateFor(ACCOUNT_ROLES, "Active account required");

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
module.exports = { requireAuth, requireAccount, requireRole, STAFF_ROLES, ACCOUNT_ROLES };
