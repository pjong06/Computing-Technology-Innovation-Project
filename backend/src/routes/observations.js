const express = require("express");
const upload = require("../services/storageService");
const { requireAuth, requireRole } = require("../middleware/auth");
const { randomUUID } = require("node:crypto");

const router = express.Router();

// All observation endpoints require an authenticated botanist
router.use(requireAuth, requireRole("botanist"));

// Create a new observation
router.post("/", async (req, res) => {
const {
    client_record_id,
    plant_id,
    observed_at,
    notes
} = req.body;


const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (
    typeof client_record_id !== "string" ||
    !uuidPattern.test(client_record_id) ||
    typeof plant_id !== "string" ||
    !uuidPattern.test(plant_id)
) {
    return res.status(400).json({
        message: "Valid client_record_id and plant_id are required"
    });
}

const { data: existingObservation, error: lookupError } = await req.supabase
    .from("observations")
    .select("*")
    .eq("client_record_id", client_record_id)
    .maybeSingle();

if (lookupError) {
    return res.status(500).json({
        message: "Failed to check existing observation"
    });
}

if (existingObservation) {
    return res.status(200).json({
        message: "Observation already exists",
        observation: existingObservation
    });
}

if (
    observed_at !== undefined &&
    (typeof observed_at !== "string" ||
        !Number.isFinite(Date.parse(observed_at)))
) {
    return res.status(400).json({
        message: "observed_at must be a valid date"
    });
}

const newObservation = {
    client_record_id,
    plant_id,
    observer_id: req.user.id,
    observed_at: observed_at || new Date().toISOString(),
    notes: notes || null,
    review_status: "draft"
};

const { data, error } = await req.supabase
    .from("observations")
    .insert(newObservation)
    .select()
    .single();

if (error) {
    if (error.code === "23505") {
    return res.status(409).json({
        message: "Observation already exists"
    });
}
    console.error("Observation creation error:", error);

    return res.status(500).json({
        message: "Failed to create observation"
    });
}

return res.status(201).json({
    message: "Observation created successfully",
    observation: data
});

});

// Submit an observation for review
router.patch("/:id/submit", async (req, res) => {
    const { id } = req.params;

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

    if (!["draft", "rejected"].includes(observation.review_status)) {
    return res.status(400).json({
        message: "Only draft or rejected observations can be submitted"
    });
    }

    const { data: updatedObservation, error: updateError } = await req.supabase
    .from("observations")
    .update({ review_status: "pending" })
    .eq("id", id)
    .eq("observer_id", req.user.id)
    .in("review_status", ["draft", "rejected"])
    .select()
    .maybeSingle();

    if (updateError) {
    console.error("Observation submission error:", updateError);

    return res.status(500).json({
        message: "Failed to submit observation"
    });
}

if (!updatedObservation) {
    return res.status(409).json({
        message: "Observation status has changed. Please try again."
    });
}

return res.status(200).json({
    message: "Observation submitted successfully",
    observation: updatedObservation
});

});

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