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

// CREATE a new plant
router.post("/", requireRole("botanist"), (req, res) => {
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

    const newPlant = {
        plant_id: plants.length + 1,
        scientific_name: req.body.scientific_name,
        common_name: req.body.common_name,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        gps_accuracy_m: req.body.gps_accuracy_m,
        registered_by: req.user.id,
        plant_status: "pending"
    };

    plants.push(newPlant);

    res.status(201).json({
        message: "Plant created successfully",
        plant: newPlant
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

