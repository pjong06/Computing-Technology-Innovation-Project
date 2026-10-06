const express = require("express");
const upload = require("../services/storageService");
const { generatePlantQR } = require("../services/qrService");

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

// GET all plants
router.get("/", (req, res) => {
    res.json(plants);
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

    res.json(plant);
});

// CREATE a new plant
router.post("/", (req, res) => {
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
        gps_accuracy_m: req.body.gps_accuracy_m
    };

    plants.push(newPlant);

    res.status(201).json({
        message: "Plant created successfully",
        plant: newPlant
    });
});

// UPDATE a plant by ID
router.put("/:id", (req, res) => {
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
router.delete("/:id", (req, res) => {
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
router.post("/:id/photo", upload.single("photo"), (req, res) => {
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
router.get("/:id/qr", async (req, res) => {
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
router.get("/:id/qr/image", async (req, res) => {
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

