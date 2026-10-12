const express = require("express");
const { publicClient: supabase } = require("../config/supabase");

const router = express.Router();

// GET /api/knowledge/species
router.get("/species", async (req, res) => {
    const q = req.query.q;

    if (q !== undefined && typeof q !== "string") {
        return res.status(400).json({ message: "Invalid search text" });
    }

    const search = (q || "").trim();

    if (
        search.length > 60 ||
        (search && !/^[\p{L}\p{N} -]+$/u.test(search))
    ) {
        return res.status(400).json({ message: "Invalid search text" });
    }

    let query = supabase
        .from("species")
        .select(
            "id, scientific_name, common_name, local_name, conservation_status, description"
        )
        .eq("verification_status", "approved");

    if (search) {
        query = query.or(
            `scientific_name.ilike.%${search}%,common_name.ilike.%${search}%`
        );
    }

    const { data, error } = await query
        .order("scientific_name")
        .limit(50);

    if (error) {
        console.error("Species query error:", error);
        return res.status(500).json({ message: "Could not load species" });
    }

    res.json({ data });
});

// GET /api/knowledge/species/:id
router.get("/species/:id", async (req, res) => {
    const { id } = req.params;

    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(id)) {
        return res.status(400).json({ message: "Invalid species ID" });
    }

    const { data, error } = await supabase
        .from("species")
        .select(
            "id, scientific_name, common_name, local_name, species_category, conservation_status, description, morphology, habitat, distribution_notes, cultural_significance"
        )
        .eq("id", id)
        .eq("verification_status", "approved")
        .maybeSingle();

    if (error) {
        console.error("Species detail error:", error);
        return res.status(500).json({
            message: "Could not load species details",
        });
    }

    if (!data) {
        return res.status(404).json({ message: "Species not found" });
    }

    res.json({ data });
});

module.exports = router;
