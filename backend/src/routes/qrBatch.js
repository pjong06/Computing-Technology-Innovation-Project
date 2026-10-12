const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { generateQRBatchPDF } = require("../services/qrPdfService");

const router = express.Router();

// Generate a printable PDF from supplied QR tag values
router.post(
    "/print",
    requireAuth,
    requireRole("botanist"),
    async (req, res) => {
        try {
const { tags } = req.body;

// Validate the submitted QR tags
if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.length > 100 ||
    tags.some(tag =>
        typeof tag !== "string" ||
        !/^NIAH-PLT-\d{5}$/.test(tag)
    ) ||
    new Set(tags).size !== tags.length
) {
    return res.status(400).json({
        message: "Invalid or duplicate QR tags"
    });
}

// Check which tags exist in Supabase
const { data: plants, error } = await req.supabase
    .from("plants")
    .select("qr_code_value, registered_by")
    .in("qr_code_value", tags);

if (error) {
    console.error("QR tag lookup failed:", error);
    return res.status(500).json({
        message: "Failed to verify QR tags"
    });
}

// Only allow printing tags belonging to the logged-in botanist
const allowedTags = new Set(
    plants
        .filter(plant => plant.registered_by === req.user.id)
        .map(plant => plant.qr_code_value)
);

if (tags.some(tag => !allowedTags.has(tag))) {
    return res.status(403).json({
        message: "One or more QR tags are unavailable"
    });
}

const pdf = await generateQRBatchPDF(tags);

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader(
                "Content-Disposition",
                'attachment; filename="plant-qr-tags.pdf"'
            );

            return res.send(pdf);
        } catch (error) {
            return res.status(400).json({
                message: error.message
            });
        }
    }
);

module.exports = router;