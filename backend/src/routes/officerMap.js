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


router.get("/stations", async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("sensor_stations")
            .select("id, station_code, station_status, latitude, longitude, location_note")
            .limit(1000);

        if (error) throw error;

        const stations = (data || [])
            .filter(station =>
                Number.isFinite(station.latitude) &&
                Number.isFinite(station.longitude) &&
                station.latitude >= -90 &&
                station.latitude <= 90 &&
                station.longitude >= -180 &&
                station.longitude <= 180 &&
                !(station.latitude === 0 && station.longitude === 0)
            )
            .map(station => ({
                id: station.id,
                station_code: station.station_code,
                status: station.station_status,
                latitude: station.latitude,
                longitude: station.longitude,
                location_note: station.location_note,
            }));

        return res.json({ data: stations });
    } catch (error) {
        console.error("Map stations error:", error);
        return res.status(500).json({
            message: "Could not load sensor station locations",
        });
    }
});

// ---- Trace routes (docs/trace-route-plan.md, section 2.4) ----

const ROUTE_DAYS_DEFAULT = 90;
const ROUTE_LIMIT = 500;
const MAX_MAP_POINTS = 2000;

// Keeps every n-th point plus the first and last, so a long route draws quickly.
// At most maxPoints are returned; the stored route is unchanged.
function thinPoints(points, maxPoints = MAX_MAP_POINTS) {
    if (!Array.isArray(points) || points.length <= maxPoints) return points || [];
    const step = Math.ceil((points.length - 1) / (maxPoints - 1));
    const thinned = [];
    for (let i = 0; i < points.length - 1; i += step) thinned.push(points[i]);
    thinned.push(points[points.length - 1]);
    return thinned;
}

// "2026-11-18" (whole day) or a full ISO time. Returns a Date, or null when not valid.
function parseRouteDate(value, endOfDay) {
    if (typeof value !== "string" || value.trim() === "") return null;
    const text = value.trim();
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const time = Date.parse(dayOnly ? `${text}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : text);
    return Number.isNaN(time) ? null : new Date(time);
}

// GET /api/officer/map/routes?from=YYYY-MM-DD&to=YYYY-MM-DD
// Officer only (router.use above). Routes that ended in the last 90 days by default.
router.get("/routes", async (req, res) => {
    let from;
    let to = null;
    if (req.query.from !== undefined) {
        from = parseRouteDate(req.query.from, false);
        if (!from) return res.status(400).json({ message: "The start date is not valid. Use YYYY-MM-DD." });
    } else {
        from = new Date(Date.now() - ROUTE_DAYS_DEFAULT * 24 * 60 * 60 * 1000);
    }
    if (req.query.to !== undefined) {
        to = parseRouteDate(req.query.to, true);
        if (!to) return res.status(400).json({ message: "The end date is not valid. Use YYYY-MM-DD." });
        if (to < from) return res.status(400).json({ message: "The end date is before the start date." });
    }

    try {
        let query = req.supabase
            .from("field_routes")
            .select("id, recorded_by, plant_id, started_at, ended_at, distance_m, duration_s, point_count, points, waypoints")
            .gte("ended_at", from.toISOString());
        if (to) query = query.lte("ended_at", to.toISOString());
        const { data: routes, error: routesError } = await query
            .order("ended_at", { ascending: false })
            .limit(ROUTE_LIMIT);
        if (routesError) throw routesError;

        const rows = routes || [];
        const recorderIds = [...new Set(rows.map(route => route.recorded_by).filter(Boolean))];
        const plantIds = [...new Set(rows.map(route => route.plant_id).filter(Boolean))];

        const { data: people, error: peopleError } = recorderIds.length
            ? await req.supabase.from("profiles").select("id, full_name").in("id", recorderIds)
            : { data: [], error: null };
        if (peopleError) throw peopleError;

        const { data: plants, error: plantsError } = plantIds.length
            ? await req.supabase.from("plants").select("id, qr_code_value, species_id").in("id", plantIds)
            : { data: [], error: null };
        if (plantsError) throw plantsError;

        const speciesIds = [...new Set((plants || []).map(plant => plant.species_id).filter(Boolean))];
        const { data: species, error: speciesError } = speciesIds.length
            ? await req.supabase.from("species").select("id, scientific_name").in("id", speciesIds)
            : { data: [], error: null };
        if (speciesError) throw speciesError;

        const nameById = new Map((people || []).map(person => [person.id, person.full_name]));
        const plantById = new Map((plants || []).map(plant => [plant.id, plant]));
        const speciesById = new Map((species || []).map(item => [item.id, item]));

        return res.json({
            from: from.toISOString(),
            to: to ? to.toISOString() : null,
            data: rows.map(route => {
                const plant = route.plant_id ? plantById.get(route.plant_id) : null;
                return {
                    id: route.id,
                    recorded_by: nameById.get(route.recorded_by) || "Botanist",
                    started_at: route.started_at,
                    ended_at: route.ended_at,
                    distance_m: Number(route.distance_m),
                    duration_s: route.duration_s,
                    point_count: route.point_count,
                    plant: plant
                        ? {
                            id: plant.id,
                            tag: plant.qr_code_value || null,
                            scientific_name: speciesById.get(plant.species_id)?.scientific_name || null,
                        }
                        : null,
                    waypoints: route.waypoints || [],
                    points: thinPoints(route.points),
                };
            }),
        });
    } catch (error) {
        console.error("Map routes error:", error);
        return res.status(500).json({ message: "Could not load routes" });
    }
});

module.exports = router;
module.exports.thinPoints = thinPoints;
