const express = require("express");
const { randomUUID } = require("node:crypto");
const upload = require("../services/storageService");
const { generatePlantQR } = require("../services/qrService");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Temporary plant data for testing
const plants = [
    {
        plant_id: 1,
        scientific_name: "Clerodendrum paniculatum",
        common_name: "Pagoda Flower",
        latitude: 3.8176,
        longitude: 113.7810,
        gps_accuracy_m: 5
    },
    {
        plant_id: 2,
        scientific_name: "Shorea macrophylla",
        common_name: "Engkabang",
        latitude: 3.8180,
        longitude: 113.7820,
        gps_accuracy_m: 8
    }
];

// The public QR visitor endpoint belongs to the visitor feature, not this staff API.
router.use(requireAuth);

function canReadPlant(plant, profile) {
    if (profile.role === "officer") return true;
    if (profile.role === "botanist" && plant.registered_by === profile.id) return true;
    return plant.plant_status === "approved" &&
        ["botanist", "researcher", "admin"].includes(profile.role);
}

function visiblePlant(plant, profile) {
    if (profile.role === "officer" ||
        (profile.role === "botanist" && plant.registered_by === profile.id)) return plant;

    const { registered_by, ...approvedData } = plant;
    if (profile.role === "botanist" || profile.role === "researcher") return approvedData;

    // Admins receive public fields only. Unknown species sensitivity hides GPS.
    const publicData = {
        plant_id: plant.plant_id,
        scientific_name: plant.scientific_name,
        common_name: plant.common_name
    };
    if (plant.photo) publicData.photo = plant.photo;
    if (plant.species_endangered === false) {
        publicData.latitude = plant.latitude;
        publicData.longitude = plant.longitude;
        publicData.gps_accuracy_m = plant.gps_accuracy_m;
    }
    return publicData;
}

function denyUnspecifiedMutation(req, res) {
    return res.status(403).json({ message: "Generic plant updates and deletes are not authorized" });
}

function requireOwnPlant(req, res, next) {
    const plant = plants.find(p => p.plant_id === parseInt(req.params.id));
    if (!plant) return res.status(404).json({ message: "Plant not found" });
    if (plant.registered_by !== req.user.id) {
        return res.status(403).json({ message: "Only the record owner may upload a photo" });
    }
    req.plant = plant;
    next();
}

// GET all plants
router.get("/", (req, res) => {
    res.json(plants.filter(p => canReadPlant(p, req.profile)).map(p => visiblePlant(p, req.profile)));
});

// GET one plant by ID
router.get("/:id", (req, res) => {
    const plantId = parseInt(req.params.id);

    const plant = plants.find(p => p.plant_id === plantId);

    if (!plant) {
        return res.status(404).json({
            message: "Plant not found"
        });
    }

    if (!canReadPlant(plant, req.profile)) {
        return res.status(404).json({ message: "Plant not found" });
    }

    res.json(visiblePlant(plant, req.profile));
});

// Save a field record in Supabase under the signed-in botanist.
router.post("/", requireRole("botanist"), async (req, res) => {
    const { latitude, longitude } = req.body || {};
    const scientificName =
        typeof req.body?.scientific_name === "string"
            ? req.body.scientific_name.trim()
            : "";
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (
        typeof latitude !== "number" ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        typeof longitude !== "number" ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
    ) {
        return res.status(400).json({ message: "Valid latitude and longitude are required" });
    }

    if (
        req.body?.gps_accuracy_m !== undefined &&
        (typeof req.body.gps_accuracy_m !== "number" ||
            !Number.isFinite(req.body.gps_accuracy_m) ||
            req.body.gps_accuracy_m < 0)
    ) {
        return res.status(400).json({ message: "gps_accuracy_m must be a non-negative number" });
    }

    if (
        req.body?.location_description !== undefined &&
        (typeof req.body.location_description !== "string" ||
            req.body.location_description.trim().length > 500)
    ) {
        return res.status(400).json({ message: "location_description must be text up to 500 characters" });
    }

    let speciesId = req.body?.species_id || null;
    let species = null;

    if (speciesId !== null) {
        if (typeof speciesId !== "string" || !uuidPattern.test(speciesId)) {
            return res.status(400).json({ message: "Invalid species_id" });
        }

        const { data, error } = await req.supabase
            .from("species")
            .select("id, scientific_name, common_name")
            .eq("id", speciesId)
            .eq("verification_status", "approved")
            .maybeSingle();

        if (error) {
            console.error("Plant species lookup error:", error);
            return res.status(500).json({ message: "Could not check the selected species" });
        }
        species = data;
    } else if (scientificName) {
        const { data, error } = await req.supabase
            .from("species")
            .select("id, scientific_name, common_name")
            .eq("scientific_name", scientificName)
            .eq("verification_status", "approved")
            .maybeSingle();

        if (error) {
            console.error("Plant species lookup error:", error);
            return res.status(500).json({ message: "Could not check the selected species" });
        }
        species = data;
        speciesId = data?.id || null;
    }

    if (!species) {
        return res.status(400).json({
            message: "Choose an approved species before saving the plant record",
        });
    }

    const clientRecordId = req.body?.client_record_id || randomUUID();
    if (typeof clientRecordId !== "string" || !uuidPattern.test(clientRecordId)) {
        return res.status(400).json({ message: "client_record_id must be a UUID" });
    }

    // Repeated sync requests with the same client ID return the saved row.
    const { data: existing, error: existingError } = await req.supabase
        .from("plants")
        .select("id, client_record_id, species_id, qr_code_value, gps_accuracy_m, location_description, plant_status, registered_by, registered_at, row_version")
        .eq("client_record_id", clientRecordId)
        .maybeSingle();

    if (existingError) {
        console.error("Plant duplicate check error:", existingError);
        return res.status(500).json({ message: "Could not check for an existing plant record" });
    }
    if (existing) {
        return res.status(200).json({ message: "Plant record already saved", plant: existing });
    }

    const plant = {
        client_record_id: clientRecordId,
        species_id: speciesId,
        qr_code_value: `plant:${clientRecordId}`,
        location: `POINT(${longitude} ${latitude})`,
        gps_accuracy_m: req.body.gps_accuracy_m ?? null,
        location_description: req.body.location_description?.trim() || null,
        plant_status: "pending",
        registered_by: req.user.id,
    };

    const { data, error } = await req.supabase
        .from("plants")
        .insert(plant)
        .select("id, client_record_id, species_id, qr_code_value, gps_accuracy_m, location_description, plant_status, registered_by, registered_at, row_version")
        .single();

    if (error?.code === "23505") {
        return res.status(409).json({
            message: "This client record has already been saved",
        });
    }
    if (error?.code === "42501") {
        return res.status(403).json({ message: "Botanist access is required to save plant records" });
    }
    if (error) {
        console.error("Create plant error:", error);
        return res.status(500).json({ message: "Could not save plant record" });
    }

    return res.status(201).json({
        message: "Plant record saved to Supabase",
        plant: {
            ...data,
            plant_id: data.id,
            scientific_name: species.scientific_name,
            common_name: species.common_name,
            latitude,
            longitude,
        },
    });
});

// UPDATE a plant by ID
router.put("/:id", denyUnspecifiedMutation, (req, res) => {
    const plantId = parseInt(req.params.id);

        const { latitude, longitude } = req.body;

    if (
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
    ) {
        return res.status(400).json({
            message: "Invalid GPS coordinates"
        });
    }

    const plant = plants.find(p => p.plant_id === plantId);

    if (!plant) {
        return res.status(404).json({
            message: "Plant not found"
        });
    }

    plant.scientific_name = req.body.scientific_name;
    plant.common_name = req.body.common_name;
    plant.latitude = req.body.latitude;
    plant.longitude = req.body.longitude;
    plant.gps_accuracy_m = req.body.gps_accuracy_m;

    res.json({
        message: "Plant updated successfully",
        plant: plant
    });
});

// DELETE a plant by ID
router.delete("/:id", denyUnspecifiedMutation, (req, res) => {
    const plantId = parseInt(req.params.id);

    const plantIndex = plants.findIndex(p => p.plant_id === plantId);

    if (plantIndex === -1) {
        return res.status(404).json({
            message: "Plant not found"
        });
    }

    const deletedPlant = plants.splice(plantIndex, 1);

    res.json({
        message: "Plant deleted successfully",
        plant: deletedPlant[0]
    });
});

// UPLOAD a photo for a plant
router.post("/:id/photo", requireRole("botanist"), requireOwnPlant, upload.single("photo"), (req, res) => {
    const plantId = parseInt(req.params.id);

    const plant = plants.find(p => p.plant_id === plantId);

    if (!plant) {
        return res.status(404).json({
            message: "Plant not found"
        });
    }

    if (!req.file) {
        return res.status(400).json({
            message: "No photo uploaded"
        });
    }

    plant.photo = req.file.filename;

    res.status(200).json({
        message: "Photo uploaded successfully",
        plant_id: plantId,
        photo: req.file.filename
    });
});

// GENERATE QR code for a plant
router.get("/:id/qr", requireRole("botanist"), async (req, res) => {
    const plantId = parseInt(req.params.id);

    const plant = plants.find(p => p.plant_id === plantId);

    if (!plant) {
        return res.status(404).json({
            message: "Plant not found"
        });
    }

    try {
        const qr = await generatePlantQR(plantId);

        res.json({
            message: "QR code generated successfully",
            plant_id: plantId,
            qr_value: qr.qrValue,
            qr_code: qr.qrCode
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to generate QR code"
        });
    }
});

// DISPLAY QR code as an image
router.get("/:id/qr/image", requireRole("botanist"), async (req, res) => {
    const plantId = parseInt(req.params.id);

    const plant = plants.find(p => p.plant_id === plantId);

    if (!plant) {
        return res.status(404).json({
            message: "Plant not found"
        });
    }

    try {
        const qr = await generatePlantQR(plantId);

        const base64Data = qr.qrCode.replace(
            /^data:image\/png;base64,/,
            ""
        );

        const imageBuffer = Buffer.from(base64Data, "base64");

        res.setHeader("Content-Type", "image/png");
        res.send(imageBuffer);
    } catch (error) {
        res.status(500).json({
            message: "Failed to generate QR code"
        });
    }
});

module.exports = router;

