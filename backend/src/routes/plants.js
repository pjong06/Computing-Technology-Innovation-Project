const express = require("express");
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
    const result = {
        id: plant.id,
        client_record_id: plant.client_record_id,
        species_id: plant.species_id,
        scientific_name: plant.species?.scientific_name,
        common_name: plant.species?.common_name,
        qr_code_value: plant.qr_code_value,
        plant_status: plant.plant_status,
        registered_at: plant.registered_at
    };

    // Officers and record owners can see the full record
    if (
        profile.role === "officer" ||
        (profile.role === "botanist" &&
         plant.registered_by === profile.id)
    ) {
        return {
            ...plant,
            ...result
        };
    }

    // Other authorized staff can see approved records
    if (
        profile.role === "botanist" ||
        profile.role === "researcher"
    ) {
        return {
            ...result,
            location: plant.location,
            gps_accuracy_m: plant.gps_accuracy_m,
            location_description: plant.location_description
        };
    }

    // Admins receive approved public fields only.
    // Exact GPS is withheld until a trusted classification
    // explicitly confirms the species is non-endangered.
    return {
        id: result.id,
        scientific_name: result.scientific_name,
        common_name: result.common_name,
        plant_status: result.plant_status
    };
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

// GET all plants from Supabase
router.get("/", async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("plants")
            .select(`
                *,
                species:species_id (
                    scientific_name,    
                    common_name,
                    conservation_status
        )

    `);
        if (error) {
            console.error("Supabase plants error:", error);
            return res.status(500).json({
                message: "Failed to fetch plants"
            });
        }

        const visiblePlants = data
            .filter(plant => canReadPlant(plant, req.profile))
            .map(plant => visiblePlant(plant, req.profile));

        res.json(visiblePlants);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Server error"
        });
    }
});

// Find a plant using its scanned QR tag
router.get("/qr/:qrValue", async (req, res) => {
    const { qrValue } = req.params;

    if (!/^NIAH-PLT-\d{5}$/.test(qrValue)) {
        return res.status(400).json({
            message: "Invalid QR tag"
        });
    }

    try {
        const { data: plant, error } = await req.supabase
            .from("plants")
            .select(`
                *,
                species:species_id (
                    scientific_name,
                    common_name,
                    conservation_status
                )
            `)
            .eq("qr_code_value", qrValue)
            .maybeSingle();

        if (error) {
            console.error("QR lookup error:", error);
            return res.status(500).json({
                message: "Failed to look up plant"
            });
        }

        if (!plant || !canReadPlant(plant, req.profile)) {
            return res.status(404).json({
                message: "Plant not found"
            });
        }

        return res.status(200).json({
            message: "Plant found successfully",
            plant: visiblePlant(plant, req.profile)
        });
    } catch (error) {
        console.error("QR lookup error:", error);
        return res.status(500).json({
            message: "Server error"
        });
    }
});

// GET one plant by ID from Supabase
router.get("/:id", async (req, res) => {
    const { id } = req.params;

    // Supabase plant IDs are UUIDs
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(id)) {
        return res.status(400).json({
            message: "Invalid plant ID"
        });
    }

    try {
        const { data: plant, error } = await req.supabase
            .from("plants")
            .select(`
                *,
                species:species_id (
                    scientific_name,
                    common_name,
                    conservation_status
                )
            `)
            .eq("id", id)
            .maybeSingle();

        if (error) {
            console.error("Failed to fetch plant:", error);
            return res.status(500).json({
                message: "Failed to fetch plant"
            });
        }

        if (!plant || !canReadPlant(plant, req.profile)) {
            return res.status(404).json({
                message: "Plant not found"
            });
        }

        return res.json(visiblePlant(plant, req.profile));
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: "Server error"
        });
    }
});

// CREATE a new plant
router.post("/", requireRole("botanist"), async (req, res) => {
const {
    client_record_id,
    species_id,
    qr_code_value,
    latitude,
    longitude,
    gps_accuracy_m,
    location_description
} = req.body;

if (
    typeof client_record_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(client_record_id) ||
    typeof qr_code_value !== "string" ||
    !qr_code_value.trim()
) {
    return res.status(400).json({
        message: "Valid client_record_id and qr_code_value are required"
    });
}

if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
) {
    return res.status(400).json({
        message: "Invalid GPS coordinates"
    });
}
const location = `POINT(${longitude} ${latitude})`;

const newPlant = {
    client_record_id,
    species_id: species_id || null,
    qr_code_value,
    location,
    gps_accuracy_m: gps_accuracy_m ?? null,
    location_description: location_description || null,
    registered_by: req.user.id,
    plant_status: "pending"
};

const { data: existingPlant, error: lookupError } = await req.supabase
    .from("plants")
    .select("*")
    .eq("client_record_id", client_record_id)
    .maybeSingle();

    if (lookupError) {
    console.error("Plant lookup error:", lookupError);

    return res.status(500).json({
        message: "Failed to check existing plant"
    });
}


if (existingPlant) {
    return res.status(200).json({
        message: "Plant already registered",
        plant: existingPlant
    });
}
const { data, error } = await req.supabase
    .from("plants")
    .insert(newPlant)
    .select()
    .single();

if (error) {
    if (error.code === "23505") {
        return res.status(409).json({
            message: "Plant already registered or QR tag already exists"
        });
    }

    console.error("Plant registration error:", error);

    return res.status(500).json({
        message: "Failed to register plant"
    });
}

return res.status(201).json({
    message: "Plant created successfully",
    plant: data
});
});

// UPDATE a plant by ID
router.put("/:id", denyUnspecifiedMutation, (req, res) => {
    const plantId = parseInt(req.params.id);

        const { latitude, longitude } = req.body;

if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
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


// GENERATE QR code for a plant
router.get("/:id/qr", requireRole("botanist"), async (req, res) => {
    const { id } = req.params;

    try {
        const { data: plant, error } = await req.supabase
            .from("plants")
            .select("id, qr_code_value, registered_by")
            .eq("id", id)
            .maybeSingle();

        if (error) {
            console.error("Failed to fetch plant:", error);
            return res.status(500).json({
                message: "Failed to fetch plant"
            });
        }

        if (!plant) {
            return res.status(404).json({
                message: "Plant not found"
            });
        }

        // Only the botanist who registered the plant can generate its QR
        if (plant.registered_by !== req.user.id) {
            return res.status(403).json({
                message: "Only the plant owner can generate its QR code"
            });
        }

        const qr = await generatePlantQR(plant.qr_code_value);

        return res.json({
            message: "QR code generated successfully",
            plant_id: plant.id,
            qr_value: qr.qrValue,
            qr_code: qr.qrCode
        });
    } catch (error) {
        console.error("QR generation error:", error);
        return res.status(500).json({
            message: "Failed to generate QR code"
        });
    }
});

// DISPLAY QR code as a PNG image
router.get("/:id/qr/image", requireRole("botanist"), async (req, res) => {
    const { id } = req.params;

    try {
        const { data: plant, error } = await req.supabase
            .from("plants")
            .select("id, qr_code_value, registered_by")
            .eq("id", id)
            .maybeSingle();

        if (error) {
            console.error("Failed to fetch plant:", error);
            return res.status(500).json({
                message: "Failed to fetch plant"
            });
        }

        if (!plant) {
            return res.status(404).json({
                message: "Plant not found"
            });
        }

        // Only the botanist who registered the plant can access its QR image
        if (plant.registered_by !== req.user.id) {
            return res.status(403).json({
                message: "Only the plant owner can access its QR code"
            });
        }

        const qr = await generatePlantQR(plant.qr_code_value);

        const base64Data = qr.qrCode.replace(
            /^data:image\/png;base64,/,
            ""
        );

        const imageBuffer = Buffer.from(base64Data, "base64");

        res.setHeader("Content-Type", "image/png");
        return res.send(imageBuffer);

    } catch (error) {
        console.error("QR image error:", error);
        return res.status(500).json({
            message: "Failed to generate QR image"
        });
    }
});

module.exports = router;

