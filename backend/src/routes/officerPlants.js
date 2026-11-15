"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("officer"));
router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE_MAX = 50;
const RELATED_PAGE_SIZE = 1000;
const PHOTO_URL_TTL_SECONDS = 60;

const PLANT_COLUMNS =
    "id, qr_code_value, species_id, location_description, plant_status, " +
    "registered_by, registered_at";
const SPECIES_COLUMNS = "id, scientific_name, common_name, conservation_status";
const OBSERVATION_COLUMNS =
    "id, plant_id, observer_id, observed_at, height_cm, diameter_cm, " +
    "health_status, life_stage, review_status";
const PHOTO_COLUMNS = "id, plant_id, file_path, photo_type, is_primary";

function oneQueryValue(query, key, fallback = "") {
    const value = query[key] === undefined ? fallback : query[key];
    return typeof value === "string" ? value.trim() : null;
}

function parsePagination(query) {
    const pageText = oneQueryValue(query, "page", "1");
    const sizeText = oneQueryValue(query, "page_size", "20");
    if (!pageText || !sizeText || !/^[1-9]\d*$/.test(pageText) || !/^[1-9]\d*$/.test(sizeText)) {
        return null;
    }
    const page = Number(pageText);
    const pageSize = Number(sizeText);
    const start = (page - 1) * pageSize;
    if (!Number.isSafeInteger(page) || page > 1000000 ||
        !Number.isSafeInteger(pageSize) || pageSize > PAGE_SIZE_MAX ||
        !Number.isSafeInteger(start)) {
        return null;
    }
    return { page, page_size: pageSize, start };
}

function ilikeValue(value) {
    return `"%${value.replaceAll('"', '\\"')}%"`;
}

function uniqueIds(rows, key) {
    return [...new Set((rows || []).map((row) => row[key]).filter(Boolean))];
}

function throwOnError(result) {
    if (result.error) throw result.error;
    return result.data || [];
}

function hasUnsafeFilterCharacter(value) {
    return /[%\\"]/.test(value) || /[\u0000-\u001f]/.test(value);
}

async function loadSpeciesById(supabase, speciesIds) {
    if (speciesIds.length === 0) return new Map();
    const rows = throwOnError(await supabase
        .from("species")
        .select(SPECIES_COLUMNS)
        .in("id", speciesIds));
    return new Map(rows.map((row) => [row.id, row]));
}

async function loadProfileNames(supabase, profileIds) {
    if (profileIds.length === 0) return new Map();
    const rows = throwOnError(await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", profileIds));
    return new Map(rows.map((row) => [row.id, row.full_name || null]));
}

async function loadPlantCoordinates(supabase, plantId) {
    const { data, error } = await supabase
        .from("plant_map_points")
        .select("id, latitude, longitude")
        .eq("id", plantId)
        .maybeSingle();
    if (error) throw error;
    return {
        latitude: data?.latitude ?? null,
        longitude: data?.longitude ?? null,
    };
}

async function loadObservations(supabase, plantIds) {
    if (plantIds.length === 0) return [];
    return throwOnError(await supabase
        .from("observations")
        .select(OBSERVATION_COLUMNS)
        .in("plant_id", plantIds)
        .is("deleted_at", null)
        .order("observed_at", { ascending: false }));
}

function observationSummaryByPlant(observations) {
    const summary = new Map();
    for (const observation of observations) {
        const current = summary.get(observation.plant_id) || { count: 0, last: null };
        current.count += 1;
        if (!current.last || observation.observed_at > current.last) {
            current.last = observation.observed_at;
        }
        summary.set(observation.plant_id, current);
    }
    return summary;
}

async function loadPlantPhotos(supabase, plantIds, primaryOnly) {
    if (plantIds.length === 0) return [];
    let query = supabase
        .from("plant_media")
        .select(PHOTO_COLUMNS)
        .in("plant_id", plantIds);
    if (primaryOnly) query = query.eq("is_primary", true);
    return throwOnError(await query);
}

async function signPhotos(supabase, photos) {
    if (photos.length === 0) return new Map();
    const paths = photos.map((photo) => photo.file_path);
    const { data, error } = await supabase.storage
        .from("plant-media")
        .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    if (error) throw error;

    const urls = new Map((data || []).map((item) => [item.path, item.signedUrl]));
    if (paths.some((path) => !urls.get(path))) {
        throw new Error("Could not sign every plant photo");
    }
    return urls;
}

function publicPhoto(photo, urls) {
    return {
        id: photo.id,
        photo_type: photo.photo_type,
        is_primary: photo.is_primary,
        url: urls.get(photo.file_path),
        expires_in: PHOTO_URL_TTL_SECONDS,
    };
}

function emptyList(res, paging) {
    return res.json({
        data: [],
        pagination: {
            page: paging.page,
            page_size: paging.page_size,
            total: 0,
            total_pages: 0,
        },
    });
}

// Filter options are kept separate from paged plant data so the species catalogue can
// show counts and the plant catalogue can offer every registered-by value.
router.get("/facets", async (req, res) => {
    try {
        const counts = new Map();
        const statuses = new Set();
        const profileIds = new Set();
        let start = 0;
        let rows;
        do {
            rows = throwOnError(await req.supabase
                .from("plants")
                .select("species_id, registered_by, plant_status")
                .order("id", { ascending: true })
                .range(start, start + RELATED_PAGE_SIZE - 1));
            for (const row of rows) {
                if (row.species_id) counts.set(row.species_id, (counts.get(row.species_id) || 0) + 1);
                if (row.registered_by) profileIds.add(row.registered_by);
                if (row.plant_status) statuses.add(row.plant_status);
            }
            start += rows.length;
        } while (rows.length === RELATED_PAGE_SIZE);

        const names = await loadProfileNames(req.supabase, [...profileIds]);
        return res.json({
            data: {
                species_counts: [...counts].map(([species_id, count]) => ({ species_id, count })),
                registered_by: [...profileIds]
                    .map((id) => ({ id, name: names.get(id) || "Unknown staff member" }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
                plant_statuses: [...statuses].sort(),
            },
        });
    } catch (error) {
        console.error("Plant catalogue facets error:", error);
        return res.status(500).json({ message: "Could not load plant filters" });
    }
});

router.get("/", async (req, res) => {
    const paging = parsePagination(req.query);
    if (!paging) return res.status(400).json({ message: "Invalid page or page_size" });

    const search = oneQueryValue(req.query, "search");
    const speciesId = oneQueryValue(req.query, "species_id");
    const plantStatus = oneQueryValue(req.query, "plant_status");
    const conservationStatus = oneQueryValue(req.query, "conservation_status");
    const registeredBy = oneQueryValue(req.query, "registered_by");
    if (search === null || search.length > 100 || hasUnsafeFilterCharacter(search)) {
        return res.status(400).json({ message: "Invalid search" });
    }
    if (speciesId === null || (speciesId && !UUID_PATTERN.test(speciesId))) {
        return res.status(400).json({ message: "Invalid species_id" });
    }
    if (registeredBy === null || (registeredBy && !UUID_PATTERN.test(registeredBy))) {
        return res.status(400).json({ message: "Invalid registered_by" });
    }
    if (plantStatus === null || plantStatus.length > 50 ||
        /[,]/.test(plantStatus) || hasUnsafeFilterCharacter(plantStatus)) {
        return res.status(400).json({ message: "Invalid plant_status" });
    }
    if (conservationStatus === null || conservationStatus.length > 100 ||
        /[,]/.test(conservationStatus) || hasUnsafeFilterCharacter(conservationStatus)) {
        return res.status(400).json({ message: "Invalid conservation_status" });
    }

    try {
        let eligibleSpeciesIds = null;
        if (speciesId || conservationStatus) {
            let speciesQuery = req.supabase.from("species").select("id");
            if (speciesId) speciesQuery = speciesQuery.eq("id", speciesId);
            if (conservationStatus === "NA" || conservationStatus.toLowerCase() === "not assessed") {
                speciesQuery = speciesQuery.is("conservation_status", null);
            } else if (conservationStatus) {
                speciesQuery = speciesQuery.eq("conservation_status", conservationStatus);
            }
            eligibleSpeciesIds = uniqueIds(throwOnError(await speciesQuery), "id");
            if (eligibleSpeciesIds.length === 0) return emptyList(res, paging);
        }

        let matchingSpeciesIds = [];
        if (search) {
            let speciesQuery = req.supabase
                .from("species")
                .select("id")
                .or(`scientific_name.ilike.${ilikeValue(search)},common_name.ilike.${ilikeValue(search)}`)
                .limit(RELATED_PAGE_SIZE);
            if (eligibleSpeciesIds !== null) {
                speciesQuery = speciesQuery.in("id", eligibleSpeciesIds);
            }
            matchingSpeciesIds = uniqueIds(throwOnError(await speciesQuery), "id");
        }

        let query = req.supabase
            .from("plants")
            .select(PLANT_COLUMNS, { count: "exact" });
        if (eligibleSpeciesIds !== null) query = query.in("species_id", eligibleSpeciesIds);
        if (plantStatus) query = query.eq("plant_status", plantStatus);
        if (registeredBy) query = query.eq("registered_by", registeredBy);
        if (search) {
            const term = ilikeValue(search);
            const conditions = [
                `qr_code_value.ilike.${term}`,
                `location_description.ilike.${term}`,
                ...matchingSpeciesIds.map((id) => `species_id.eq.${id}`),
            ];
            query = query.or(conditions.join(","));
        }

        const { data: plantRows, error, count } = await query
            .order("registered_at", { ascending: false })
            .order("id", { ascending: false })
            .range(paging.start, paging.start + paging.page_size - 1);
        if (error) throw error;

        const plants = plantRows || [];
        const plantIds = uniqueIds(plants, "id");
        const speciesIds = uniqueIds(plants, "species_id");
        const profileIds = uniqueIds(plants, "registered_by");
        const [speciesById, profileNames, observations, photos] = await Promise.all([
            loadSpeciesById(req.supabase, speciesIds),
            loadProfileNames(req.supabase, profileIds),
            loadObservations(req.supabase, plantIds),
            loadPlantPhotos(req.supabase, plantIds, true),
        ]);
        const photoUrls = await signPhotos(req.supabase, photos);
        const summaries = observationSummaryByPlant(observations);
        const primaryPhotoByPlant = new Map();
        for (const photo of photos) {
            if (!primaryPhotoByPlant.has(photo.plant_id)) {
                primaryPhotoByPlant.set(photo.plant_id, publicPhoto(photo, photoUrls));
            }
        }

        res.set("Cache-Control", "no-store");
        return res.json({
            data: plants.map((plant) => {
                const summary = summaries.get(plant.id) || { count: 0, last: null };
                return {
                    id: plant.id,
                    tag_code: plant.qr_code_value || null,
                    species: speciesById.get(plant.species_id) || null,
                    location_description: plant.location_description || null,
                    plant_status: plant.plant_status || null,
                    registered_by: profileNames.get(plant.registered_by) || null,
                    last_observation_at: summary.last,
                    photo_thumbnail: primaryPhotoByPlant.get(plant.id) || null,
                    observation_count: summary.count,
                };
            }),
            pagination: {
                page: paging.page,
                page_size: paging.page_size,
                total: count || 0,
                total_pages: Math.ceil((count || 0) / paging.page_size),
            },
        });
    } catch (error) {
        console.error("Plant catalogue list error:", error);
        return res.status(500).json({ message: "Could not load plants" });
    }
});

router.get("/:id", async (req, res) => {
    const { id } = req.params;
    if (!UUID_PATTERN.test(id)) return res.status(400).json({ message: "Invalid plant ID" });

    try {
        const { data: plant, error: plantError } = await req.supabase
            .from("plants")
            .select(PLANT_COLUMNS)
            .eq("id", id)
            .maybeSingle();
        if (plantError) throw plantError;
        if (!plant) return res.status(404).json({ message: "Plant not found" });

        const [speciesById, profileNames, observations, photos, coordinates] = await Promise.all([
            loadSpeciesById(req.supabase, plant.species_id ? [plant.species_id] : []),
            loadProfileNames(req.supabase, plant.registered_by ? [plant.registered_by] : []),
            loadObservations(req.supabase, [plant.id]),
            loadPlantPhotos(req.supabase, [plant.id], false),
            loadPlantCoordinates(req.supabase, plant.id),
        ]);
        const observationIds = uniqueIds(observations, "id");
        const observerIds = uniqueIds(observations, "observer_id");
        const [observerNames, reviews] = await Promise.all([
            loadProfileNames(req.supabase, observerIds),
            observationIds.length
                ? req.supabase
                    .from("observation_reviews")
                    .select("observation_id, comments, reviewed_at")
                    .in("observation_id", observationIds)
                    .order("reviewed_at", { ascending: false })
                    .then((result) => throwOnError(result))
                : Promise.resolve([]),
        ]);
        const latestCommentByObservation = new Map();
        for (const review of reviews) {
            if (review.comments?.trim() && !latestCommentByObservation.has(review.observation_id)) {
                latestCommentByObservation.set(review.observation_id, review.comments);
            }
        }
        const photoUrls = await signPhotos(req.supabase, photos);
        const summaries = observationSummaryByPlant(observations);
        const summary = summaries.get(plant.id) || { count: 0, last: null };
        const primaryPhoto = photos.find((photo) => photo.is_primary);

        res.set("Cache-Control", "no-store");
        return res.json({
            data: {
                id: plant.id,
                tag_code: plant.qr_code_value || null,
                species: speciesById.get(plant.species_id) || null,
                location_description: plant.location_description || null,
                plant_status: plant.plant_status || null,
                registered_by: profileNames.get(plant.registered_by) || null,
                registered_at: plant.registered_at || null,
                last_observation_at: summary.last,
                observation_count: summary.count,
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
                photo_thumbnail: primaryPhoto ? publicPhoto(primaryPhoto, photoUrls) : null,
                photos: photos.map((photo) => publicPhoto(photo, photoUrls)),
                observations: observations.map((observation) => ({
                    id: observation.id,
                    observed_at: observation.observed_at,
                    height_cm: observation.height_cm,
                    diameter_cm: observation.diameter_cm,
                    health_status: observation.health_status,
                    life_stage: observation.life_stage,
                    review_status: observation.review_status,
                    reviewer_comment: latestCommentByObservation.get(observation.id) || null,
                    observer_name: observerNames.get(observation.observer_id) || null,
                })),
            },
        });
    } catch (error) {
        console.error("Plant catalogue detail error:", error);
        return res.status(500).json({ message: "Could not load plant details" });
    }
});

module.exports = router;
