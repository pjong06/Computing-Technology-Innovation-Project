"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
    PUBLIC_PHOTO_BUCKET,
    refreshPublicPlantPhoto,
} = require("../services/publicPlantPhotos");
const { generateQRBatchPDF } = require("../services/qrPdfService");
const { TAG_PATTERN, QrConfigurationError } = require("../services/qrService");
const { rankOf } = require("../services/reportService");

const router = express.Router();
router.use(requireAuth, requireRole("officer"));
router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE_MAX = 50;
const RELATED_PAGE_SIZE = 1000;
// Long enough for a list the officer scrolls through: thumbnails load lazily as they come
// into view, and a 60-second link had often expired by then (the placeholder showed).
const PHOTO_URL_TTL_SECONDS = 600;

const PLANT_COLUMNS =
    "id, qr_code_value, species_id, location_description, plant_status, " +
    "registered_by, registered_at";
const SPECIES_COLUMNS = "id, scientific_name, common_name, conservation_status, taxonomy(family)";
// Extra plant columns for the plant detail page (field notes).
const PLANT_DETAIL_COLUMNS = `${PLANT_COLUMNS}, morphology, description`;
// Column sorting for the plant list: ?sort=<key>&dir=asc|desc. newest / oldest stay as before.
const PLANT_SORTS = {
    newest: { column: "registered_at", ascending: false },
    oldest: { column: "registered_at", ascending: true },
    registered: { column: "registered_at" },
    tag: { column: "qr_code_value" },
    location: { column: "location_description" },
    status: { column: "plant_status" },
};
// The most plants whose QR tags can be printed at once (the PDF generator's limit).
const MAX_PRINT_PLANTS = 100;
const SPECIES_PHOTO_COLUMNS =
    "id, species_id, file_path, is_primary, source";
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

// The species of these plants: names, conservation status, family and how far it was
// identified ("Genus", "Family", ...; reportService.rankOf), for the list and detail pages.
async function loadSpeciesById(supabase, speciesIds) {
    if (speciesIds.length === 0) return new Map();
    const rows = throwOnError(await supabase
        .from("species")
        .select(SPECIES_COLUMNS)
        .in("id", speciesIds));
    return new Map(rows.map((row) => [row.id, {
        id: row.id,
        scientific_name: row.scientific_name,
        common_name: row.common_name,
        conservation_status: row.conservation_status,
        family: row.taxonomy?.family || null,
        rank: rankOf(row.scientific_name, row.taxon_rank),
    }]));
}

async function loadSpeciesPhotos(supabase, speciesIds) {
    if (speciesIds.length === 0) return [];
    return throwOnError(await supabase
        .from("species_media")
        .select(SPECIES_PHOTO_COLUMNS)
        .in("species_id", speciesIds));
}

function preferredSpeciesPhotosById(photos) {
    const grouped = new Map();
    for (const photo of photos) {
        const group = grouped.get(photo.species_id) || [];
        group.push(photo);
        grouped.set(photo.species_id, group);
    }

    return new Map([...grouped].map(([speciesId, speciesPhotos]) => {
        const preferred = speciesPhotos.find(photo => photo.source === "sfc" && photo.is_primary) ||
            speciesPhotos.find(photo => photo.source === "sfc") ||
            speciesPhotos.find(photo => photo.is_primary) ||
            speciesPhotos[0];
        return [speciesId, preferred];
    }));
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

async function signPhotos(supabase, photos, bucket = "plant-media") {
    if (photos.length === 0) return new Map();
    const paths = photos.map((photo) => photo.file_path);
    const { data, error } = await supabase.storage
        .from(bucket)
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

function publicSpeciesPhoto(photo, urls) {
    if (!photo) return null;
    return {
        url: urls.get(photo.file_path),
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
// Brings every public photo copy in line with the plants (officer only, with the officer's
// own permissions): writes the stripped copy for each plant on the public QR page and
// removes copies of plants that are no longer public. Run once after the
// public_plant_photos migration, and whenever copies may be out of date (e.g. after
// archiving a species). Returns how many were published, removed and skipped.
router.post("/public-photos/refresh", async (req, res) => {
    try {
        const counts = { published: 0, removed: 0, skipped: 0 };
        const publishedTags = new Set();
        let start = 0;
        let rows;
        do {
            rows = throwOnError(await req.supabase
                .from("plants")
                .select("id, qr_code_value")
                .eq("plant_status", "approved")
                .is("deleted_at", null)
                .order("id", { ascending: true })
                .range(start, start + RELATED_PAGE_SIZE - 1));
            for (const plant of rows) {
                const result = await refreshPublicPlantPhoto(req.supabase, plant.id);
                counts[result] += 1;
                if (result === "published") publishedTags.add(plant.qr_code_value);
            }
            start += rows.length;
        } while (rows.length === RELATED_PAGE_SIZE);

        // Copies left from plants that were rejected, deleted or archived since.
        const bucket = req.supabase.storage.from(PUBLIC_PHOTO_BUCKET);
        const stale = [];
        for (let offset = 0; ; offset += 1000) {
            const { data: files, error } = await bucket.list("", { limit: 1000, offset });
            if (error) throw error;
            for (const file of files || []) {
                const tag = String(file.name || "").replace(/\.jpg$/, "");
                if (file.name && !publishedTags.has(tag)) stale.push(file.name);
            }
            if (!files || files.length < 1000) break;
        }
        for (let i = 0; i < stale.length; i += 100) {
            const { error } = await bucket.remove(stale.slice(i, i + 100));
            if (error) throw error;
        }
        counts.removed += stale.length;
        return res.json({ data: counts });
    } catch (error) {
        console.error("Public plant photo refresh error:", error?.message || error);
        return res.status(500).json({ message: "Could not refresh the public plant photos" });
    }
});

router.get("/facets", async (req, res) => {
    try {
        const counts = new Map();
        const statusCounts = new Map();
        const speciesByPlant = new Map();
        const statuses = new Set();
        const dataSources = new Set();
        const profileIds = new Set();
        let start = 0;
        let rows;
        do {
            rows = throwOnError(await req.supabase
                .from("plants")
                .select("id, species_id, registered_by, plant_status, data_source")
                .is("deleted_at", null)
                .order("id", { ascending: true })
                .range(start, start + RELATED_PAGE_SIZE - 1));
            for (const row of rows) {
                if (row.species_id) {
                    counts.set(row.species_id, (counts.get(row.species_id) || 0) + 1);
                    if (row.id) speciesByPlant.set(row.id, row.species_id);
                }
                if (row.plant_status) statusCounts.set(row.plant_status, (statusCounts.get(row.plant_status) || 0) + 1);
                if (row.registered_by) profileIds.add(row.registered_by);
                if (row.plant_status) statuses.add(row.plant_status);
                if (row.data_source) dataSources.add(row.data_source);
            }
            start += rows.length;
        } while (rows.length === RELATED_PAGE_SIZE);

        const [names, lastObserved] = await Promise.all([
            loadProfileNames(req.supabase, [...profileIds]),
            lastObservedBySpecies(req.supabase, speciesByPlant),
        ]);
        return res.json({
            data: {
                species_counts: [...counts].map(([species_id, count]) => ({
                    species_id,
                    count,
                    last_observed_at: lastObserved.get(species_id) || null,
                })),
                status_counts: Object.fromEntries(statusCounts),
                registered_by: [...profileIds]
                    .map((id) => ({ id, name: names.get(id) || "Unknown staff member" }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
                plant_statuses: [...statuses].sort((a, b) => a.localeCompare(b)),
                data_sources: [...dataSources].sort((a, b) => a.localeCompare(b)),
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
    const source = oneQueryValue(req.query, "source");
    // Newest first unless ?sort= names another column (PLANT_SORTS) with ?dir=asc|desc.
    const sort = oneQueryValue(req.query, "sort") || "newest";
    const dir = oneQueryValue(req.query, "dir");
    if (!Object.hasOwn(PLANT_SORTS, sort) || !["", "asc", "desc"].includes(dir)) {
        return res.status(400).json({ message: "sort must be newest, oldest, registered, tag, location or status" });
    }
    const sortColumn = PLANT_SORTS[sort].column;
    const ascending = PLANT_SORTS[sort].ascending ?? dir !== "desc";
    if (search === null || search.length > 100 || hasUnsafeFilterCharacter(search)) {
        return res.status(400).json({ message: "Invalid search" });
    }
    if (speciesId === null || (speciesId && !UUID_PATTERN.test(speciesId))) {
        return res.status(400).json({ message: "Invalid species_id" });
    }
    if (registeredBy === null || (registeredBy && !UUID_PATTERN.test(registeredBy))) {
        return res.status(400).json({ message: "Invalid registered_by" });
    }
    if (source === null || (source && !["field", "inaturalist"].includes(source))) {
        return res.status(400).json({ message: "Invalid source" });
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
            .select(PLANT_COLUMNS, { count: "exact" })
            .is("deleted_at", null);
        if (eligibleSpeciesIds !== null) query = query.in("species_id", eligibleSpeciesIds);
        if (plantStatus) query = query.eq("plant_status", plantStatus);
        if (registeredBy) query = query.eq("registered_by", registeredBy);
        if (source) query = query.eq("data_source", source);
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
            .order(sortColumn, { ascending, nullsFirst: false })
            .order("id", { ascending })
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
            loadPlantPhotos(req.supabase, plantIds, false),
        ]);
        const plantsWithPhotos = new Set(photos.map(photo => photo.plant_id));
        const primaryPhotos = photos.filter(photo => photo.is_primary);
        const fallbackSpeciesIds = uniqueIds(
            plants.filter(plant => !plantsWithPhotos.has(plant.id)),
            "species_id"
        );
        const speciesPhotos = await loadSpeciesPhotos(req.supabase, fallbackSpeciesIds);
        const preferredSpeciesPhotos = preferredSpeciesPhotosById(speciesPhotos);
        const selectedSpeciesPhotos = [...preferredSpeciesPhotos.values()];
        const [photoUrls, speciesPhotoUrls] = await Promise.all([
            signPhotos(req.supabase, primaryPhotos),
            signPhotos(req.supabase, selectedSpeciesPhotos, "species-media"),
        ]);
        const summaries = observationSummaryByPlant(observations);
        const primaryPhotoByPlant = new Map();
        for (const photo of primaryPhotos) {
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
                    species_photo: plantsWithPhotos.has(plant.id)
                        ? null
                        : publicSpeciesPhoto(
                            preferredSpeciesPhotos.get(plant.species_id),
                            speciesPhotoUrls
                        ),
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

// When each species was last observed: the newest observation of any of its active plants.
async function lastObservedBySpecies(supabase, speciesByPlant) {
    const last = new Map();
    let start = 0;
    let rows;
    do {
        rows = throwOnError(await supabase
            .from("observations")
            .select("plant_id, observed_at")
            .is("deleted_at", null)
            .order("id", { ascending: true })
            .range(start, start + RELATED_PAGE_SIZE - 1));
        for (const row of rows) {
            const speciesId = speciesByPlant.get(row.plant_id);
            if (!speciesId || !row.observed_at) continue;
            if (!last.has(speciesId) || row.observed_at > last.get(speciesId)) last.set(speciesId, row.observed_at);
        }
        start += rows.length;
    } while (rows.length === RELATED_PAGE_SIZE);
    return last;
}

// POST /api/officer/plants/qr-tags { plant_ids: [...] }: a PDF sheet of QR labels for the
// chosen plants (officer only, any registering botanist). Only active plants with a real
// NIAH-PLT tag are printed; the others are skipped and counted in the X-Skipped-Count header.
router.post("/qr-tags", async (req, res) => {
    const plantIds = req.body?.plant_ids;
    if (!Array.isArray(plantIds) || plantIds.length === 0 || plantIds.length > MAX_PRINT_PLANTS ||
        plantIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id)) ||
        new Set(plantIds).size !== plantIds.length) {
        return res.status(400).json({ message: `Choose 1-${MAX_PRINT_PLANTS} different plants` });
    }
    try {
        const rows = throwOnError(await req.supabase
            .from("plants")
            .select("id, qr_code_value")
            .in("id", plantIds)
            .is("deleted_at", null));
        const tags = [...new Set(rows
            .map((row) => String(row.qr_code_value || ""))
            .filter((tag) => TAG_PATTERN.test(tag)))].sort();
        const skipped = plantIds.length - tags.length;
        if (tags.length === 0) {
            return res.status(400).json({ message: "None of the selected plants has a NIAH-PLT tag yet" });
        }
        const pdf = await generateQRBatchPDF(tags, { layout: "sheet" });
        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="plant-qr-tags.pdf"',
            "X-Printed-Count": String(tags.length),
            "X-Skipped-Count": String(skipped),
        });
        return res.send(pdf);
    } catch (error) {
        if (error instanceof QrConfigurationError) {
            return res.status(503).json({ message: "Public QR URL is not configured" });
        }
        console.error("Plant QR tag print error:", error);
        return res.status(500).json({ message: "Could not print the QR tags" });
    }
});

router.get("/:id", async (req, res) => {
    const { id } = req.params;
    if (!UUID_PATTERN.test(id)) return res.status(400).json({ message: "Invalid plant ID" });

    try {
        const { data: plant, error: plantError } = await req.supabase
            .from("plants")
            .select(PLANT_DETAIL_COLUMNS)
            .eq("id", id)
            .is("deleted_at", null)
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
        const [photoUrls, speciesPhotos] = await Promise.all([
            signPhotos(req.supabase, photos),
            photos.length === 0 && plant.species_id
                ? loadSpeciesPhotos(req.supabase, [plant.species_id])
                : Promise.resolve([]),
        ]);
        const preferredSpeciesPhoto = preferredSpeciesPhotosById(speciesPhotos).get(plant.species_id);
        const speciesPhotoUrls = await signPhotos(
            req.supabase,
            preferredSpeciesPhoto ? [preferredSpeciesPhoto] : [],
            "species-media"
        );
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
                morphology: plant.morphology?.trim() || null,
                notes: plant.description?.trim() || null,
                plant_status: plant.plant_status || null,
                registered_by: profileNames.get(plant.registered_by) || null,
                registered_at: plant.registered_at || null,
                last_observation_at: summary.last,
                observation_count: summary.count,
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
                photo_thumbnail: primaryPhoto ? publicPhoto(primaryPhoto, photoUrls) : null,
                species_photo: photos.length === 0
                    ? publicSpeciesPhoto(preferredSpeciesPhoto, speciesPhotoUrls)
                    : null,
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
