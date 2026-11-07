const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth, requireRole("officer"));

router.get("/plants", async (req, res) => {
    try {
        const { data: plantRows, error: plantsError } = await req.supabase
            .from("plant_map_points")
            .select("id, latitude, longitude, qr_code_value, plant_status, location_description, species_id")
            .limit(2000);
        if (plantsError) throw plantsError;

        const plants = (plantRows || []).filter(
            plant => !(plant.latitude === 0 && plant.longitude === 0)
        );
        const speciesIds = [...new Set(plants.map(plant => plant.species_id).filter(Boolean))];
        const { data: speciesRows, error: speciesError } = speciesIds.length
            ? await req.supabase
                .from("species")
                .select("id, scientific_name, common_name, conservation_status")
                .in("id", speciesIds)
            : { data: [], error: null };
        if (speciesError) throw speciesError;

        const plantIds = plants.map(plant => plant.id);
        const { data: visits, error: visitsError } = plantIds.length
            ? await req.supabase
                .from("observations")
                .select("plant_id, observed_at")
                .in("plant_id", plantIds)
                .is("deleted_at", null)
            : { data: [], error: null };
        if (visitsError) throw visitsError;

        const speciesById = new Map((speciesRows || []).map(species => [species.id, species]));
        const lastVisitByPlantId = new Map();
        for (const visit of visits || []) {
            const latest = lastVisitByPlantId.get(visit.plant_id);
            if (!latest || visit.observed_at > latest) {
                lastVisitByPlantId.set(visit.plant_id, visit.observed_at);
            }
        }

        return res.json({
            data: plants.map(plant => ({
                id: plant.id,
                latitude: plant.latitude,
                longitude: plant.longitude,
                tag: plant.qr_code_value,
                status: plant.plant_status,
                landmark: plant.location_description,
                species: speciesById.get(plant.species_id) || null,
                last_visit: lastVisitByPlantId.get(plant.id) || null,
            })),
        });
    } catch (error) {
        console.error("Map plants error:", error);
        return res.status(500).json({ message: "Could not load plant locations" });
    }
});

module.exports = router;
