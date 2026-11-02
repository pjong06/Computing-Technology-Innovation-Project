
const express = require("express");
const upload = require("../services/storageService");
const { requireAuth, requireRole } = require("../middleware/auth");
const { randomUUID } = require("node:crypto");

const router = express.Router();

// All observation endpoints require an authenticated botanist
router.use(requireAuth, requireRole("botanist"));


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

module.exports = router;
