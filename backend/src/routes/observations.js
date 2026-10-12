const express = require("express");
const upload = require("../services/storageService");
const { requireAuth, requireRole } = require("../middleware/auth");
const { randomUUID } = require("node:crypto");

const router = express.Router();

// All observation endpoints require an authenticated botanist
router.use(requireAuth, requireRole("botanist"));

// Upload a photo for an existing observation
router.post("/:id/photo", async (req, res, next) => {
    const { id } = req.params;

    // Check that the observation exists and belongs to this botanist
    const { data: observation, error } = await req.supabase
        .from("observations")
        .select("id, observer_id, review_status")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        return res.status(500).json({
            message: "Failed to check observation"
        });
    }

    if (!observation) {
        return res.status(404).json({
            message: "Observation not found"
        });
    }

    if (observation.observer_id !== req.user.id) {
        return res.status(403).json({
            message: "You do not own this observation"
        });
    }

    // Only drafts or rejected observations may be edited
    if (!["draft", "rejected"].includes(observation.review_status)) {
        return res.status(403).json({
            message: "This observation cannot be edited"
        });
    }

    next();
}, upload.single("photo"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            message: "No photo uploaded"
        });
    }

    const observationId = req.params.id;
    const extension = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp"
    }[req.file.mimetype];

    const filePath = `${req.user.id}/${observationId}/${randomUUID()}.${extension}`;

    try {
        // Upload the photo to Supabase Storage
        const { error: uploadError } = await req.supabase.storage
            .from("observation-media")
            .upload(filePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (uploadError) {
            return res.status(500).json({
                message: "Failed to upload photo"
            });
        }

        // Save photo information in the database
        const { data: media, error: mediaError } = await req.supabase
            .from("observation_media")
            .insert({
                observation_id: observationId,
                uploaded_by: req.user.id,
                file_path: filePath,
                media_type: "image"
            })
            .select()
            .single();

        if (mediaError) {
            // Remove the uploaded file if saving the database record fails
            await req.supabase.storage
                .from("observation-media")
                .remove([filePath]);

            return res.status(500).json({
                message: "Failed to save photo record"
            });
        }

        return res.status(201).json({
            message: "Photo uploaded successfully",
            media
        });

    } catch (error) {
        console.error("Observation photo error:", error);

        return res.status(500).json({
            message: "Photo upload failed"
        });
    }
});

module.exports = router;