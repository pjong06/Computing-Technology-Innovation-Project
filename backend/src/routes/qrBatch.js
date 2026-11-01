const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { generateQRBatchPDF } = require("../services/qrPdfService");
const { TAG_PATTERN, QrConfigurationError } = require("../services/qrService");

function createQrBatchRouter({ authenticate = requireAuth, authorize = requireRole,
    generatePDF = generateQRBatchPDF } = {}) {
    const router = express.Router();
    // Printing still requires existing plants owned by the logged-in botanist; no reservation is added.
    router.post("/print", authenticate, authorize("botanist"), async (req, res) => {
        const tags = req.body?.tags;
        if (!Array.isArray(tags) || tags.length === 0 || tags.length > 100 ||
            tags.some(tag => typeof tag !== "string" || !TAG_PATTERN.test(tag)) ||
            new Set(tags).size !== tags.length) {
            return res.status(400).json({ message: "Invalid or duplicate QR tags" });
        }
        try {
            const { data: plants, error } = await req.supabase.from("plants")
                .select("qr_code_value, registered_by").in("qr_code_value", tags);
            if (error) return res.status(500).json({ message: "Failed to verify QR tags" });
            const allowedTags = new Set((plants || [])
                .filter(plant => plant.registered_by === req.user.id)
                .map(plant => plant.qr_code_value));
            if (tags.some(tag => !allowedTags.has(tag))) {
                return res.status(403).json({ message: "One or more QR tags are unavailable" });
            }
            const pdf = await generatePDF(tags);
            res.set({ "Content-Type": "application/pdf", "Cache-Control": "no-store",
                "Content-Disposition": 'attachment; filename="plant-qr-tags.pdf"' });
            return res.send(pdf);
        } catch (error) {
            if (error instanceof QrConfigurationError) {
                return res.status(503).json({ message: "Public QR URL is not configured" });
            }
            return res.status(500).json({ message: "Could not generate QR tags" });
        }
    });
    return router;
}

module.exports = createQrBatchRouter();
module.exports.createQrBatchRouter = createQrBatchRouter;
