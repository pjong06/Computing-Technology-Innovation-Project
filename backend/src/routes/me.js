const express = require("express");
const { requireAccount } = require("../middleware/auth");

// GET /api/me: who is signed in. The ONLY route that admits visitor accounts
// (requireAccount); every staff route uses requireAuth, which refuses them.
function createMeRouter({ authenticate = requireAccount } = {}) {
    const router = express.Router();

    router.get("/", authenticate, (req, res) => {
        res.json({
            id: req.user.id,
            email: req.user.email,
            role: req.profile.role,
        });
    });

    return router;
}

module.exports = createMeRouter();
module.exports.createMeRouter = createMeRouter;
