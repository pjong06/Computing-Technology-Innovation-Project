const express = require("express");

const router = express.Router();

// Temporary plant data for testing
const plants = [
    {
        plant_id: 1,
        scientific_name: "Clerodendrum paniculatum",
        common_name: "Pagoda Flower"
    },
    {
        plant_id: 2,
        scientific_name: "Shorea macrophylla",
        common_name: "Engkabang"
    }
];

// GET all plants
router.get("/", (req, res) => {
    res.json(plants);
});

module.exports = router;