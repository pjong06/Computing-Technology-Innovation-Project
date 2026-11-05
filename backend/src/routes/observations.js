
const express = require("express");
const upload = require("../services/storageService");
const { requireAuth, requireRole } = require("../middleware/auth");
const { randomUUID } = require("node:crypto");

const router = express.Router();

// All observation endpoints require an authenticated botanist
router.use(requireAuth, requireRole("botanist"));


// GET /api/observations/review-status?ids=<uuid>,<uuid>,...
// The officer's decision on the signed-in botanist's OWN observations, so the phone can
// show Approved / Rejected (with the reason) / Pending. Other botanists' observations are
// simply not returned. Read-only: nothing is changed.
const REVIEW_STATUS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REVIEW_STATUS_IDS = 100;

router.get("/review-status", async (req, res) => {
    const raw = req.query.ids;
    if (typeof raw !== "string" || raw.trim() === "") {
        return res.status(400).json({ message: "ids is required" });
    }
    const ids = [...new Set(raw.split(",").map(id => id.trim()).filter(Boolean))];
    if (ids.length > MAX_REVIEW_STATUS_IDS || !ids.every(id => REVIEW_STATUS_UUID.test(id))) {
        return res.status(400).json({
            message: `ids must be at most ${MAX_REVIEW_STATUS_IDS} observation IDs`
        });
    }

    const { data: observations, error } = await req.supabase
        .from("observations")
        .select("id, review_status")
        .eq("observer_id", req.user.id)
        .in("id", ids)
        .is("deleted_at", null);

    if (error) {
        console.error("Observation review status error:", error);
        return res.status(500).json({ message: "Could not load review status" });
    }

    // The latest rejection reason for each rejected observation.
    const rejectedIds = (observations || [])
        .filter(row => row.review_status === "rejected")
        .map(row => row.id);
    const reasons = new Map();
    if (rejectedIds.length > 0) {
        const { data: reviews, error: reviewError } = await req.supabase
            .from("observation_reviews")
            .select("observation_id, comments, reviewed_at")
            .in("observation_id", rejectedIds)
            .eq("decision", "rejected")
            .order("reviewed_at", { ascending: false });
        if (reviewError) {
            // The statuses are still useful without the reasons.
            console.error("Observation rejection reason error:", reviewError);
        } else {
            for (const review of reviews || []) {
                if (!reasons.has(review.observation_id)) reasons.set(review.observation_id, review.comments);
            }
        }
    }

    return res.json({
        data: (observations || []).map(row => ({
            id: row.id,
            review_status: row.review_status,
            rejection_comment: row.review_status === "rejected" ? reasons.get(row.id) ?? null : null
        }))
    });
});

router.post("/", async (req, res) => {

const {
    client_record_id,
    plant_id,
    observed_at,
    notes,
    health_status,
    life_stage,
    measurement,
    height_cm,
    diameter_cm
} = req.body;


    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Use the mobile record ID when provided.
    // Fallback supports clients that do not yet send one.
    const observationClientId = client_record_id ?? randomUUID();

    if (
        typeof observationClientId !== "string" ||
        !uuidPattern.test(observationClientId) ||
        typeof plant_id !== "string" ||
        !uuidPattern.test(plant_id)
    ) {
        return res.status(400).json({
            message: "Valid client_record_id and plant_id are required"
        });
    }

    if (
        observed_at != null &&
        (typeof observed_at !== "string" ||
            !Number.isFinite(Date.parse(observed_at)))
    ) {
        return res.status(400).json({
            message: "observed_at must be a valid date"
        });
    }

    if (
        (health_status != null &&
            (typeof health_status !== "string" ||
                !health_status.trim() ||
                health_status.length > 100)) ||
        (life_stage != null &&
            (typeof life_stage !== "string" ||
                !life_stage.trim() ||
                life_stage.length > 100))
    ) {
        return res.status(400).json({
            message: "health_status and life_stage must be valid text"
        });
    }

    if (
        measurement != null &&
        (typeof measurement !== "string" ||
            measurement.length > 500)
    ) {
        return res.status(400).json({
            message: "measurement must be text of at most 500 characters"
        });
    }

    if (
        notes != null &&
        (typeof notes !== "string" ||
            notes.length > 5000)
    ) {
        return res.status(400).json({
            message: "notes must be text of at most 5000 characters"
        });
    }

    // Preserve the mobile measurement without assuming its units.
    const observationNotes = [
        measurement?.trim()
            ? `Measurement: ${measurement.trim()}`
            : null,
        notes?.trim() || null
    ].filter(Boolean).join("\n\n") || null;

    // Check for an existing observation belonging to this botanist.
    const {
        data: existingObservation,
        error: lookupError
    } = await req.supabase
        .from("observations")
        .select("*")
        .eq("client_record_id", observationClientId)
        .eq("observer_id", req.user.id)
        .maybeSingle();

    if (lookupError) {
        console.error("Observation lookup error:", lookupError);

        return res.status(500).json({
            message: "Failed to check existing observation"
        });
    }

    if (existingObservation) {
        if (existingObservation.plant_id !== plant_id) {
            return res.status(409).json({
                message: "Client record ID belongs to a different plant"
            });
        }

        return res.status(200).json({
            message: "Observation already exists",
            observation: existingObservation
        });
    }

    
for (const [field, value] of Object.entries({
    height_cm,
    diameter_cm
})) {
    if (
        value != null &&
        (typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < 0)
    ) {
        return res.status(400).json({
            message: `${field} must be a non-negative number in centimetres`
        });
    }
}

    const newObservation = {
        client_record_id: observationClientId,
        plant_id,
        observer_id: req.user.id,
        observed_at: observed_at || new Date().toISOString(),
        notes: observationNotes,
health_status: health_status?.trim() ?? null,
life_stage: life_stage?.trim() ?? null,
height_cm: height_cm ?? null,
diameter_cm: diameter_cm ?? null,
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

 // Submit an observation for officer review.
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

    // Only the observation owner can submit it.
    if (observation.observer_id !== req.user.id) {
        return res.status(403).json({
            message: "You do not own this observation"
        });
    }

    // Retrying an already-submitted observation is successful.
    if (observation.review_status === "pending") {
        return res.status(200).json({
            message: "Observation already submitted",
            observation
        });
    }

    if (!["draft", "rejected"].includes(observation.review_status)) {
        return res.status(400).json({
            message: "Only draft or rejected observations can be submitted"
        });
    }

    const { data: updatedObservation, error: updateError } =
        await req.supabase
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

    // Another request may have submitted it at the same time.
    if (!updatedObservation) {
        const { data: current, error: recheckError } = await req.supabase
            .from("observations")
            .select("id, observer_id, review_status")
            .eq("id", id)
            .maybeSingle();

        if (!recheckError &&
            current?.observer_id === req.user.id &&
            current.review_status === "pending") {
            return res.status(200).json({
                message: "Observation already submitted",
                observation: current
            });
        }

        return res.status(409).json({
            message: "Observation status has changed. Please try again."
        });
    }

    return res.status(200).json({
        message: "Observation submitted successfully",
        observation: updatedObservation
    });
});

// ---- Visit photos ----
// Same rules as the database: a botanist adds photos only to their own visit while it is
// still a draft or was sent back (RLS on observation_media and the observation-media
// bucket). Upload photos BEFORE submitting the visit for review.
const PHOTO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTOS_LOCKED_MESSAGE = "Photos can't be added after submission";

function isRlsRefusal(error) {
    return !!error && (
        error.code === "42501" ||
        String(error.statusCode) === "403" ||
        /row-level security/i.test(error.message || "")
    );
}

// UPLOAD a photo for a visit (multipart: photo, client_photo_id, optional caption)
router.post("/:id/photo", async (req, res, next) => {
    const observationId = req.params.id;
    if (!PHOTO_UUID.test(observationId)) {
        return res.status(400).json({ message: "Valid observation ID is required" });
    }

    const { data: observation, error } = await req.supabase
        .from("observations")
        .select("id, observer_id, review_status, deleted_at")
        .eq("id", observationId)
        .maybeSingle();

    if (error) {
        console.error("Observation photo lookup error:", error);
        return res.status(500).json({ message: "Failed to check observation" });
    }
    if (!observation || observation.deleted_at) {
        return res.status(404).json({ message: "Observation not found" });
    }
    if (observation.observer_id !== req.user.id) {
        return res.status(403).json({ message: "Only the observer may upload photos" });
    }
    if (!["draft", "rejected"].includes(observation.review_status)) {
        return res.status(409).json({ message: PHOTOS_LOCKED_MESSAGE, code: "photos_locked" });
    }

    next();
}, upload.single("photo"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "No photo uploaded" });
    }

    // The phone's own ID for this photo, so a retried upload isn't stored twice.
    const clientPhotoId = req.body.client_photo_id;
    if (typeof clientPhotoId !== "string" || !PHOTO_UUID.test(clientPhotoId)) {
        return res.status(400).json({ message: "client_photo_id must be a UUID" });
    }

    const caption = req.body.caption;
    if (caption !== undefined && (typeof caption !== "string" || caption.length > 500)) {
        return res.status(400).json({ message: "caption must be text of at most 500 characters" });
    }

    const extension = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp"
    }[req.file.mimetype];
    if (!extension) {
        return res.status(400).json({ message: "Unsupported image type" });
    }

    const observationId = req.params.id;

    // A retry of an upload that already reached the server: return the saved row.
    const { data: existing, error: existingError } = await req.supabase
        .from("observation_media")
        .select("*")
        .eq("observation_id", observationId)
        .eq("client_record_id", clientPhotoId)
        .maybeSingle();
    if (existingError) {
        console.error("Observation photo lookup error:", existingError);
        return res.status(500).json({ message: "Failed to check for an existing photo" });
    }
    if (existing) {
        return res.status(200).json({
            message: "Observation photo already saved",
            observation_id: observationId,
            media: existing
        });
    }

    // Storage RLS: the first folder must be the signed-in user's id.
    const filePath = `${req.user.id}/${observationId}/${randomUUID()}.${extension}`;

    try {
        const { error: uploadError } = await req.supabase.storage
            .from("observation-media")
            .upload(filePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (uploadError) {
            if (isRlsRefusal(uploadError)) {
                return res.status(409).json({ message: PHOTOS_LOCKED_MESSAGE, code: "photos_locked" });
            }
            console.error("Observation photo storage error:", uploadError);
            return res.status(500).json({ message: "Failed to upload observation photo" });
        }

        const { data: media, error: mediaError } = await req.supabase
            .from("observation_media")
            .insert({
                observation_id: observationId,
                uploaded_by: req.user.id,
                file_path: filePath,
                media_type: "image",
                caption: caption ? caption.trim() || null : null,
                client_record_id: clientPhotoId
            })
            .select()
            .single();

        if (mediaError) {
            // Remove the stored file so nothing unlinked is left behind. (Needs the
            // "botanists clean up unlinked observation image files" storage policy.)
            await req.supabase.storage.from("observation-media").remove([filePath]);

            if (mediaError.code === "23505") {
                // Another attempt with the same client_photo_id finished first.
                const { data: raced } = await req.supabase
                    .from("observation_media")
                    .select("*")
                    .eq("observation_id", observationId)
                    .eq("client_record_id", clientPhotoId)
                    .maybeSingle();
                if (raced) {
                    return res.status(200).json({
                        message: "Observation photo already saved",
                        observation_id: observationId,
                        media: raced
                    });
                }
            }
            if (isRlsRefusal(mediaError)) {
                return res.status(409).json({ message: PHOTOS_LOCKED_MESSAGE, code: "photos_locked" });
            }
            console.error("Observation media insert error:", mediaError);
            return res.status(500).json({ message: "Failed to save observation photo record" });
        }

        return res.status(201).json({
            message: "Observation photo uploaded successfully",
            observation_id: observationId,
            media
        });
    } catch (uploadFailure) {
        console.error("Observation photo upload error:", uploadFailure);
        return res.status(500).json({ message: "Observation photo upload failed" });
    }
});

module.exports = router;
