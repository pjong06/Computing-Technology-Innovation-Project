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