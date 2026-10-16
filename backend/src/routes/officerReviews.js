const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth, requireRole("officer"));

router.get("/pending", async (req, res) => {
    const { data, error } = await req.supabase
        .from("observations")
        .select("id, plant_id, observer_id, observed_at, notes, review_status")
        .eq("review_status", "pending")
        .is("deleted_at", null)
        .order("observed_at", { ascending: true })
        .limit(100);

    if (error) {
        console.error("Pending observations error:", error);
        return res.status(500).json({
            message: "Could not load pending observations"
        });
    }

    return res.json({ data });
});

// Return short-lived photo links for an observation awaiting officer review.
router.get("/:observationId/photos", async (req, res) => {
    const observationId = req.params.observationId;
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(observationId)) {
        return res.status(400).json({
            message: "Valid observation ID is required"
        });
    }

    const { data: observation, error: observationError } = await req.supabase
        .from("observations")
        .select("id, review_status, deleted_at")
        .eq("id", observationId)
        .maybeSingle();

    if (observationError) {
        console.error("Observation photo check error:", observationError);
        return res.status(500).json({
            message: "Could not check observation"
        });
    }

    if (!observation) {
        return res.status(404).json({
            message: "Observation not found"
        });
    }

    if (observation.review_status !== "pending" || observation.deleted_at !== null) {
        return res.status(409).json({
            message: "Photos are available only for pending observations"
        });
    }

    const { data: media, error: mediaError } = await req.supabase
        .from("observation_media")
        .select("id, file_path, media_type, caption, captured_at, is_primary")
        .eq("observation_id", observationId);

    if (mediaError) {
        console.error("Observation media lookup error:", mediaError);
        return res.status(500).json({
            message: "Could not load observation photos"
        });
    }

    if (media.length === 0) {
        return res.json({ data: [] });
    }

    const paths = media.map(photo => photo.file_path);
    const { data: signedFiles, error: signedUrlError } = await req.supabase.storage
        .from("observation-media")
        .createSignedUrls(paths, 60);

    if (signedUrlError) {
        console.error("Observation photo link error:", signedUrlError);
        return res.status(500).json({
            message: "Could not create photo links"
        });
    }

    const signedUrlByPath = new Map(
        signedFiles.map(file => [file.path, file.signedUrl])
    );

    res.set("Cache-Control", "no-store");

    return res.json({
        data: media.map(photo => ({
            ...photo,
            url: signedUrlByPath.get(photo.file_path) || null,
            expires_in: 60
        }))
    });
});

router.patch("/plants/:plantId/species", async (req, res) => {
    const plantId = req.params.plantId;
    const speciesId = req.body?.species_id;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(plantId) || !uuidPattern.test(speciesId || "")) {
        return res.status(400).json({
            message: "Valid plant ID and species ID are required"
        });
    }

    const { data, error } = await req.supabase.rpc(
        "officer_assign_plant_species",
        {
            p_plant_id: plantId,
            p_species_id: speciesId
        }
    );

    if (error) {
        if (error.message === "Only an active officer can assign a species") {
            return res.status(403).json({ message: error.message });
        }

        if (error.message === "Species must be approved") {
            return res.status(400).json({ message: error.message });
        }

        if (error.message === "Plant must be unassigned and have a pending observation") {
            return res.status(409).json({ message: error.message });
        }

        console.error("Species assignment error:", error);
        return res.status(500).json({
            message: "Could not assign species"
        });
    }

    return res.json({
        plant_id: data,
        species_id: speciesId
    });
});

router.post("/:observationId/decision", async (req, res) => {
    const observationId = req.params.observationId;
    const { decision, comments } = req.body || {};
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(observationId)) {
        return res.status(400).json({ message: "Valid observation ID is required" });
    }

    if (!["approved", "rejected"].includes(decision)) {
        return res.status(400).json({
            message: "Decision must be approved or rejected"
        });
    }

    if (
        comments !== undefined &&
        comments !== null &&
        (typeof comments !== "string" || comments.length > 2000)
    ) {
        return res.status(400).json({
            message: "Comments must be text of 2000 characters or fewer"
        });
    }

    const { data: observation, error: lookupError } = await req.supabase
        .from("observations")
        .select("id, review_status, deleted_at")
        .eq("id", observationId)
        .maybeSingle();

    if (lookupError) {
        console.error("Observation lookup error:", lookupError);
        return res.status(500).json({
            message: "Could not check observation"
        });
    }

    if (!observation) {
        return res.status(404).json({
            message: "Observation not found"
        });
    }

    if (observation.review_status !== "pending" || observation.deleted_at !== null) {
        return res.status(409).json({
            message: "Observation is not available for review"
        });
    }

    const { data, error } = await req.supabase
        .from("observation_reviews")
        .insert({
            observation_id: observationId,
            reviewer_id: req.user.id,
            decision,
            comments: comments?.trim() || null
        })
        .select("id, observation_id, decision, comments, reviewed_at")
        .single();

    if (error) {
        if (
            error.message ===
            "Observation must be Pending; approval requires an approved species"
        ) {
            return res.status(409).json({ message: error.message });
        }

        if (
            error.message === "Reviewer must be an active officer" ||
            error.message === "Reviewer identity mismatch"
        ) {
            return res.status(403).json({ message: error.message });
        }

        if (error.code === "23503") {
            return res.status(404).json({
                message: "Observation not found"
            });
        }

        console.error("Observation review error:", error);
        return res.status(500).json({
            message: "Could not save observation review"
        });
    }

    return res.status(201).json({ data });
});

router.patch("/:observationId/visibility", async (req, res) => {
    const observationId = req.params.observationId;
    const action = req.body?.action;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(observationId)) {
        return res.status(400).json({
            message: "Valid observation ID is required"
        });
    }

    if (!["soft_delete", "restore"].includes(action)) {
        return res.status(400).json({
            message: "Action must be soft_delete or restore"
        });
    }

    const { data: observation, error: lookupError } = await req.supabase
        .from("observations")
        .select("id, review_status, deleted_at")
        .eq("id", observationId)
        .maybeSingle();

    if (lookupError) {
        console.error("Observation lookup error:", lookupError);
        return res.status(500).json({
            message: "Could not check observation"
        });
    }

    if (!observation) {
        return res.status(404).json({
            message: "Observation not found"
        });
    }

    if (observation.review_status !== "approved") {
        return res.status(409).json({
            message: "Only approved observations can be soft-deleted or restored"
        });
    }

    if (
        (action === "soft_delete" && observation.deleted_at !== null) ||
        (action === "restore" && observation.deleted_at === null)
    ) {
        return res.status(409).json({
            message: "Observation is already in the requested state"
        });
    }

    const { data, error } = await req.supabase
        .from("observations")
        .update({
            deleted_at: action === "soft_delete"
                ? new Date().toISOString()
                : null
        })
        .eq("id", observationId)
        .eq("review_status", "approved")
        .select("id, review_status, deleted_at, deleted_by")
        .maybeSingle();

    if (error) {
        console.error("Observation visibility error:", error);
        return res.status(500).json({
            message: "Could not change observation visibility"
        });
    }

    if (!data) {
        return res.status(409).json({
            message: "Observation changed; please try again"
        });
    }

    return res.json({ data });
});

module.exports = router;