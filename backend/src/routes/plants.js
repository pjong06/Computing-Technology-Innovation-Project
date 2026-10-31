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

// List plants visible to the signed-in staff member.
router.get("/", requireRole("botanist", "officer", "researcher"), async (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = 50;

    if (!Number.isSafeInteger(page) || page < 1) {
        return res.status(400).json({ message: "page must be a positive integer" });
    }

    const firstRow = (page - 1) * pageSize;

    const { data, error, count } = await req.supabase
        .from("plants")
        .select(
            "id, species_id, qr_code_value, plant_status, registered_at",
            { count: "exact" }
        )
        .order("registered_at", { ascending: false })
        .range(firstRow, firstRow + pageSize - 1);

    if (error) {
        console.error("List plants error:", error);
        return res.status(500).json({ message: "Could not load plants" });
    }

    return res.json({
        data: data.map(plant => ({
            ...plant,
            plant_id: plant.id
        })),
        pagination: {
            page,
            page_size: pageSize,
            total: count
        }
    });
});

// GET one plant by ID
// Load one plant visible to the signed-in staff member.
router.get("/:id", requireRole("botanist", "officer", "researcher"), async (req, res) => {
    const plantId = req.params.id;
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(plantId)) {
        return res.status(400).json({ message: "Valid plant ID is required" });
    }

    const { data, error } = await req.supabase
        .from("plants")
        .select(
            "id, species_id, qr_code_value, plant_status, registered_at, " +
            "gps_accuracy_m, location_description"
        )
        .eq("id", plantId)
        .maybeSingle();

    if (error) {
        console.error("Get plant error:", error);
        return res.status(500).json({ message: "Could not load plant" });
    }

    if (!data) {
        return res.status(404).json({ message: "Plant not found" });
    }

    return res.json({
        ...data,
        plant_id: data.id
    });
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


const locationDescription =
    req.body?.location_description ?? req.body?.location_name;

if (
    locationDescription != null &&
    (typeof locationDescription !== "string" ||
        locationDescription.trim().length > 500)
) {
    return res.status(400).json({
        message: "location must be text up to 500 characters"
    });
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

    //allow unknown species
    if ((speciesId !== null || scientificName) && !species) {
        return res.status(400).json({
            message: "Selected species must be approved; omit species fields for an unidentified plant"
        });
    }

    const clientRecordId = req.body?.client_record_id || randomUUID();
    if (typeof clientRecordId !== "string" || !uuidPattern.test(clientRecordId)) {
        return res.status(400).json({ message: "client_record_id must be a UUID" });
    }

    // Use the physical tag when present; keep an internal value until a tag is attached.
    const inputTag = req.body?.qr_code_value;
    const qrCodeValue =
        inputTag == null
            ? `plant:${clientRecordId}`
            : typeof inputTag === "string"
                ? inputTag.trim().toUpperCase()
                : "";

    if (inputTag != null && !/^NIAH-PLT-\d{5}$/.test(qrCodeValue)) {
        return res.status(400).json({
            message: "qr_code_value must look like NIAH-PLT-00001"
        });
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
        qr_code_value: qrCodeValue,
        location: `POINT(${longitude} ${latitude})`,
        gps_accuracy_m: req.body.gps_accuracy_m ?? null,
        location_description: locationDescription?.trim() || null,
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
            message: "Client record ID or QR tag is already in use",
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
            //unknown species shows null instead of server throwing error
            scientific_name: species?.scientific_name ?? null,
            common_name: species?.common_name ?? null,
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

// Find the signed-in botanist's plant and its physical QR tag.
async function findOwnedPlantQrTag(req, res) {
    const plantId = req.params.id;
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(plantId)) {
        res.status(400).json({ message: "Valid plant ID is required" });
        return null;
    }

    const { data, error } = await req.supabase
        .from("plants")
        .select("id, qr_code_value")
        .eq("id", plantId)
        .eq("registered_by", req.user.id)
        .maybeSingle();

    if (error) {
        console.error("Plant QR lookup error:", error);
        res.status(500).json({ message: "Could not load plant QR tag" });
        return null;
    }

    if (!data) {
        res.status(404).json({ message: "Plant not found" });
        return null;
    }

    if (!/^NIAH-PLT-\d{5}$/.test(data.qr_code_value)) {
        res.status(409).json({
            message: "Attach a NIAH-PLT tag before generating its QR code"
        });
        return null;
    }

    return data.qr_code_value;
}

// Generate QR data for a plant owned by the signed-in botanist.
router.get("/:id/qr", requireRole("botanist"), async (req, res) => {
    const qrValue = await findOwnedPlantQrTag(req, res);
    if (!qrValue) return;

    try {
        const qr = await generatePlantQR(qrValue);
        return res.json({
            message: "QR code generated successfully",
            plant_id: req.params.id,
            qr_value: qr.qrValue,
            qr_code: qr.qrCode
        });
    } catch (error) {
        console.error("Plant QR generation error:", error);
        return res.status(500).json({ message: "Failed to generate QR code" });
    }
});

// Return a QR image for a plant owned by the signed-in botanist.
router.get("/:id/qr/image", requireRole("botanist"), async (req, res) => {
    const qrValue = await findOwnedPlantQrTag(req, res);
    if (!qrValue) return;

    try {
        const qr = await generatePlantQR(qrValue);
        const base64Data = qr.qrCode.replace(/^data:image\/png;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, "base64");

        res.setHeader("Content-Type", "image/png");
        return res.send(imageBuffer);
    } catch (error) {
        console.error("Plant QR image error:", error);
        return res.status(500).json({ message: "Failed to generate QR image" });
    }
});

module.exports = router;

