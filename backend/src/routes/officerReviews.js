const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth, requireRole("officer"));

const OBSERVATION_COLUMNS =
    "id, plant_id, observer_id, observed_at, notes, review_status, " +
    "health_status, life_stage, height_cm, diameter_cm";

// Ids of the rows, without repeats or blanks.
function idsOf(rows, key) {
    return [...new Set(rows.map(row => row[key]).filter(Boolean))];
}

// Adds what an officer needs to review each observation: the plant (tag, location
// text, species names) and the botanist's name. Separate lookups (not embedded joins),
// so the queue still works if a plant or profile can't be read; those fields are null.
async function withReviewDetails(supabase, observations) {
    if (observations.length === 0) return [];

    const plantIds = idsOf(observations, "plant_id");
    const observerIds = idsOf(observations, "observer_id");

    const { data: plants, error: plantError } = plantIds.length
        ? await supabase
            .from("plants")
            .select("id, qr_code_value, location_description, species_id")
            .in("id", plantIds)
        : { data: [], error: null };
    if (plantError) throw plantError;

    const speciesIds = idsOf(plants || [], "species_id");
    const { data: species, error: speciesError } = speciesIds.length
        ? await supabase
            .from("species")
            .select("id, scientific_name, common_name")
            .in("id", speciesIds)
        : { data: [], error: null };
    if (speciesError) throw speciesError;

    const { data: observers, error: observerError } = observerIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", observerIds)
        : { data: [], error: null };
    if (observerError) throw observerError;

    const plantById = new Map((plants || []).map(row => [row.id, row]));
    const speciesById = new Map((species || []).map(row => [row.id, row]));
    const nameById = new Map((observers || []).map(row => [row.id, row.full_name]));

    return observations.map(observation => {
        const plant = plantById.get(observation.plant_id) || null;
        const plantSpecies = plant ? speciesById.get(plant.species_id) || null : null;
        return {
            ...observation,
            observer_name: nameById.get(observation.observer_id) || null,
            plant: plant
                ? {
                    id: plant.id,
                    tag_code: plant.qr_code_value || null,
                    location_description: plant.location_description || null,
                    scientific_name: plantSpecies ? plantSpecies.scientific_name : null,
                    common_name: plantSpecies ? plantSpecies.common_name : null,
                }
                : null,
        };
    });
}

// Observations waiting for an officer, oldest first, with plant, species and botanist.
router.get("/pending", async (req, res) => {
    const { data, error } = await req.supabase
        .from("observations")
        .select(OBSERVATION_COLUMNS)
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

    try {
        return res.json({ data: await withReviewDetails(req.supabase, data || []) });
    } catch (detailError) {
        console.error("Pending observation details error:", detailError);
        return res.status(500).json({ message: "Could not load pending observations" });
    }
});

// Observations an officer sent back, newest first, with the reason given. The botanist
// fixes and resubmits them from the app (PATCH /api/observations/:id/submit); they then
// return to /pending. Officers can't move them back here.
router.get("/rejected", async (req, res) => {
    const { data, error } = await req.supabase
        .from("observations")
        .select(OBSERVATION_COLUMNS)
        .eq("review_status", "rejected")
        .is("deleted_at", null)
        .order("observed_at", { ascending: false })
        .limit(100);

    if (error) {
        console.error("Rejected observations error:", error);
        return res.status(500).json({ message: "Could not load rejected observations" });
    }

    try {
        const rows = await withReviewDetails(req.supabase, data || []);
        const ids = rows.map(row => row.id);
        // The latest rejection comment for each observation.
        const { data: reviews, error: reviewError } = ids.length
            ? await req.supabase
                .from("observation_reviews")
                .select("observation_id, decision, comments, reviewed_at")
                .in("observation_id", ids)
                .eq("decision", "rejected")
                .order("reviewed_at", { ascending: false })
            : { data: [], error: null };
        if (reviewError) throw reviewError;

        const latest = new Map();
        for (const review of reviews || []) {
            if (!latest.has(review.observation_id)) latest.set(review.observation_id, review);
        }
        return res.json({
            data: rows.map(row => ({
                ...row,
                rejection_comment: latest.get(row.id)?.comments ?? null,
                rejected_at: latest.get(row.id)?.reviewed_at ?? null,
            })),
        });
    } catch (detailError) {
        console.error("Rejected observation details error:", detailError);
        return res.status(500).json({ message: "Could not load rejected observations" });
    }
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

// Approving needs the plant's species to be approved in the catalogue (a database rule).
// Returns a plain-language reason when it isn't, or null when approval can go ahead.
async function speciesBlocksApproval(supabase, plantId) {
    const { data: plant, error: plantError } = await supabase
        .from("plants")
        .select("id, species_id")
        .eq("id", plantId)
        .maybeSingle();
    if (plantError) throw plantError;
    if (!plant || !plant.species_id) {
        return "This plant has no species yet, so the observation can't be approved. " +
            "The botanist needs to choose a species first.";
    }

    const { data: species, error: speciesError } = await supabase
        .from("species")
        .select("id, scientific_name, verification_status")
        .eq("id", plant.species_id)
        .maybeSingle();
    if (speciesError) throw speciesError;
    if (!species || species.verification_status !== "approved") {
        const name = species && species.scientific_name ? species.scientific_name : "this plant's species";
        return `${name} is not an approved species yet. ` +
            "Approve it in the Species catalogue first, then approve this observation.";
    }
    return null;
}

// Turns a database refusal into a message the officer can act on. Rules written in the
// database (RAISE EXCEPTION / CHECK) already explain themselves, so their text is shown.
// Returns null for anything unexpected (then a generic message is sent and the details logged).
function reviewRefusal(error) {
    if (error.code === "23503") {
        return { status: 404, message: "Observation not found" };
    }
    if (error.code === "P0001" || error.code === "23514") {
        return { status: 409, message: error.message };
    }
    if (error.code === "42501") {
        return {
            status: 403,
            message: "The database did not allow this review for your account. " +
                "Check that you are signed in as an active officer.",
        };
    }
    return null;
}

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
        .select("id, plant_id, review_status, deleted_at")
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
            message: "This observation is no longer waiting for review. Reload the queue."
        });
    }

    // Check the species rule here, so the page can say exactly what to do instead of
    // the database's generic refusal.
    if (decision === "approved") {
        try {
            const reason = await speciesBlocksApproval(req.supabase, observation.plant_id);
            if (reason) return res.status(409).json({ message: reason, code: "species_not_approved" });
        } catch (speciesError) {
            console.error("Species check before approval error:", speciesError);
            return res.status(500).json({ message: "Could not check the plant's species" });
        }
    }

    if (decision === "rejected" && !(typeof comments === "string" && comments.trim())) {
        return res.status(400).json({ message: "Please give a reason for rejecting this observation" });
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

        const refusal = reviewRefusal(error);
        if (refusal) {
            console.warn("Observation review refused:", { code: error.code, message: error.message });
            return res.status(refusal.status).json({ message: refusal.message });
        }

        // Code, message, details and hint, so the Render log shows the real cause.
        console.error("Observation review error:", {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
        });
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