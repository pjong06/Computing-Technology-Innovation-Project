// fieldRoutes.js - POST /api/routes: a botanist uploads a trace route (transect) recorded
// on the phone. Plan: docs/trace-route-plan.md, sections 2.3-2.4.
//
// Separate from the plant/visit sync (routes/sync.js is not involved). The route is saved
// with the botanist's own Supabase client, so row-level security on public.field_routes
// applies: a botanist can only insert, and read back, their own routes.
//
// Uploading the same phone route again (same client_route_id) is safe: the existing row's
// id is returned with 200 instead of storing it twice.
const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POINTS = 20000;
const MAX_WAYPOINTS = 200;
const MAX_DISTANCE_M = 100000;
const MAX_DURATION_S = 86400;
const MAX_LABEL_LENGTH = 200;
const MAX_TIME_TEXT_LENGTH = 50;

const isNumber = value => typeof value === "number" && Number.isFinite(value);
const isLatitude = value => isNumber(value) && value >= -90 && value <= 90;
const isLongitude = value => isNumber(value) && value >= -180 && value <= 180;

function parseTime(value) {
    if (typeof value !== "string" || value.trim() === "") return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time);
}

// Checks an upload. Returns { route } ready to insert (without recorded_by), or
// { error } with a plain-language message.
function validateRoutePayload(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { error: "The route could not be read. Please try again." };
    }
    const {
        client_route_id: clientRouteId,
        plant_id: plantId,
        started_at: startedAtText,
        ended_at: endedAtText,
        distance_m: distanceM,
        duration_s: durationS,
        points,
        waypoints = [],
    } = body;

    if (typeof clientRouteId !== "string" || !UUID.test(clientRouteId)) {
        return { error: "The route has no valid ID from the phone (client_route_id)." };
    }
    if (plantId !== undefined && plantId !== null && (typeof plantId !== "string" || !UUID.test(plantId))) {
        return { error: "The linked plant ID is not valid." };
    }

    const startedAt = parseTime(startedAtText);
    const endedAt = parseTime(endedAtText);
    if (!startedAt || !endedAt) {
        return { error: "The route's start and end times are missing or not valid." };
    }
    if (endedAt < startedAt) {
        return { error: "The route ends before it starts." };
    }

    if (!isNumber(distanceM) || distanceM < 0 || distanceM > MAX_DISTANCE_M) {
        return { error: `The route distance must be between 0 and ${MAX_DISTANCE_M} metres.` };
    }
    if (!Number.isInteger(durationS) || durationS < 0 || durationS > MAX_DURATION_S) {
        return { error: `The walking time must be between 0 and ${MAX_DURATION_S} seconds (24 hours).` };
    }

    if (!Array.isArray(points) || points.length === 0) {
        return { error: "The route has no GPS points." };
    }
    if (points.length > MAX_POINTS) {
        return { error: `The route has too many GPS points (at most ${MAX_POINTS}).` };
    }
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (!Array.isArray(point) || point.length < 3 || point.length > 4) {
            return { error: `GPS point ${i + 1} is not in the form [latitude, longitude, time, accuracy].` };
        }
        const [latitude, longitude, recordedAtMs, accuracyM = null] = point;
        if (!isLatitude(latitude) || !isLongitude(longitude)) {
            return { error: `GPS point ${i + 1} has a latitude or longitude out of range.` };
        }
        if (!isNumber(recordedAtMs)) {
            return { error: `GPS point ${i + 1} has no valid time.` };
        }
        if (accuracyM !== null && (!isNumber(accuracyM) || accuracyM < 0)) {
            return { error: `GPS point ${i + 1} has an accuracy that is not valid.` };
        }
    }

    if (!Array.isArray(waypoints)) {
        return { error: "The waypoints could not be read." };
    }
    if (waypoints.length > MAX_WAYPOINTS) {
        return { error: `The route has too many waypoints (at most ${MAX_WAYPOINTS}).` };
    }
    const cleanWaypoints = [];
    for (let i = 0; i < waypoints.length; i++) {
        const waypoint = waypoints[i];
        if (!waypoint || typeof waypoint !== "object" || Array.isArray(waypoint)) {
            return { error: `Waypoint ${i + 1} could not be read.` };
        }
        const { number, label = "", lat, lng, time = "" } = waypoint;
        if (!Number.isInteger(number) || number < 1) {
            return { error: `Waypoint ${i + 1} has no valid number.` };
        }
        if (typeof label !== "string" || label.length > MAX_LABEL_LENGTH) {
            return { error: `Waypoint ${i + 1} has a label longer than ${MAX_LABEL_LENGTH} characters.` };
        }
        if (!isLatitude(lat) || !isLongitude(lng)) {
            return { error: `Waypoint ${i + 1} has a latitude or longitude out of range.` };
        }
        if (typeof time !== "string" || time.length > MAX_TIME_TEXT_LENGTH) {
            return { error: `Waypoint ${i + 1} has a time that is not valid.` };
        }
        // Only the known fields are stored.
        cleanWaypoints.push({ number, label: label.trim(), lat, lng, time });
    }

    return {
        route: {
            client_route_id: clientRouteId.toLowerCase(),
            plant_id: plantId ? plantId.toLowerCase() : null,
            started_at: startedAt.toISOString(),
            ended_at: endedAt.toISOString(),
            distance_m: distanceM,
            duration_s: durationS,
            points: points.map(([latitude, longitude, recordedAtMs, accuracyM = null]) =>
                [latitude, longitude, recordedAtMs, accuracyM]),
            waypoints: cleanWaypoints,
            point_count: points.length,
        },
    };
}

// Per-botanist upload limit (process-local, like the other limiters: a restart resets it).
function createRouteUploadLimit({ limit = 30, windowMs = 60000, maxClients = 10000, now = Date.now } = {}) {
    const clients = new Map();
    return (req, res, next) => {
        const time = now();
        for (const [key, bucket] of clients) {
            if (bucket.until <= time) clients.delete(key);
        }
        const key = req.user.id;
        let bucket = clients.get(key);
        if (!bucket) {
            if (clients.size >= maxClients) {
                res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
                return res.status(503).json({ message: "Please try again in a minute." });
            }
            bucket = { count: 0, until: time + windowMs };
            clients.set(key, bucket);
        }
        if (bucket.count >= limit) {
            res.set("Retry-After", String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
            return res.status(429).json({ message: "Too many route uploads. Please try again in a minute." });
        }
        bucket.count++;
        return next();
    };
}

async function findOwnRoute(req, clientRouteId) {
    return req.supabase
        .from("field_routes")
        .select("id")
        .eq("recorded_by", req.user.id)
        .eq("client_route_id", clientRouteId)
        .maybeSingle();
}

router.use(requireAuth, requireRole("botanist"));

router.post("/", createRouteUploadLimit(), async (req, res) => {
    const { route, error: problem } = validateRoutePayload(req.body);
    if (problem) {
        return res.status(400).json({ message: problem });
    }

    try {
        // Uploaded before (e.g. the answer was lost on a weak connection): same row.
        const { data: existing, error: existingError } = await findOwnRoute(req, route.client_route_id);
        if (existingError) throw existingError;
        if (existing) {
            return res.status(200).json({ message: "Route already uploaded", data: { id: existing.id } });
        }

        // The linked plant must exist and be visible to this botanist (option A: the phone
        // only sends a plant that has already synced).
        if (route.plant_id) {
            const { data: plant, error: plantError } = await req.supabase
                .from("plants")
                .select("id")
                .eq("id", route.plant_id)
                .is("deleted_at", null)
                .maybeSingle();
            if (plantError) throw plantError;
            if (!plant) {
                return res.status(400).json({
                    message: "The linked plant was not found. Upload the route without the link, or sync the plant first.",
                });
            }
        }

        const { data: saved, error: insertError } = await req.supabase
            .from("field_routes")
            .insert({ ...route, recorded_by: req.user.id })
            .select("id")
            .single();

        if (insertError) {
            // Another upload of the same route won the race: return that row.
            if (insertError.code === "23505") {
                const { data: raced, error: racedError } = await findOwnRoute(req, route.client_route_id);
                if (!racedError && raced) {
                    return res.status(200).json({ message: "Route already uploaded", data: { id: raced.id } });
                }
            }
            if (insertError.code === "42501") {
                return res.status(403).json({ message: "This account can't upload routes." });
            }
            throw insertError;
        }

        return res.status(201).json({ message: "Route uploaded", data: { id: saved.id } });
    } catch (error) {
        console.error("Route upload error:", error);
        return res.status(500).json({ message: "The route could not be saved. Please try again." });
    }
});

module.exports = router;
module.exports.validateRoutePayload = validateRoutePayload;
module.exports.createRouteUploadLimit = createRouteUploadLimit;
