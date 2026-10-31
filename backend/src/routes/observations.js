
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
        measurement
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

    const newObservation = {
        client_record_id: observationClientId,
        plant_id,
        observer_id: req.user.id,
        observed_at: observed_at || new Date().toISOString(),
        notes: observationNotes,
        health_status: health_status?.trim() ?? null,
        life_stage: life_stage?.trim() ?? null,
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
module.exports = router;