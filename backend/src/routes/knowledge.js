const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { randomUUID } = require("node:crypto");
const { requireAuth, requireRole } = require("../middleware/auth");
const { removeLegacyObservationSource } = require("../utils/speciesDescription");

function parsePagination(query, defaultSize = 50) {
    const { page = "1", page_size = String(defaultSize) } = query;
    if (typeof page !== "string" || typeof page_size !== "string" ||
        !/^[1-9]\d*$/.test(page) || !/^[1-9]\d*$/.test(page_size)) return null;
    const number = Number(page), size = Number(page_size);
    if (!Number.isSafeInteger(number) || number > 100000 ||
        !Number.isSafeInteger(size) || size > 100) return null;
    return { page: number, page_size: size, start: (number - 1) * size, end: number * size - 1 };
}

function paginationMetadata(paging, count) {
    return {
        page: paging.page, page_size: paging.page_size,
        total: count ?? 0, total_pages: Math.ceil((count ?? 0) / paging.page_size)
    };
}

function orderSpeciesMedia(data) {
    const prepare = (species) => {
        if (!species) return species;
        const prepared = {
            ...species,
            ...(typeof species.description === "string"
                ? { description: removeLegacyObservationSource(species.description) }
                : {}),
        };
        if (Array.isArray(species.species_media)) {
            prepared.species_media = [...species.species_media].sort((a, b) =>
                Number(b.source === "sfc") - Number(a.source === "sfc")
            );
        }
        return prepared;
    };
    return Array.isArray(data) ? data.map(prepare) : prepare(data);
}

function textLimit(field) {
    return ["common_name", "local_name"].includes(field) ? 200 :
        ["species_category", "conservation_status"].includes(field) ? 100 : 10000;
}
function validOptionalText(field, value) {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= textLimit(field);
}

function createKnowledgeRouter({ supabase = require("../config/supabase").publicClient,
    requireAuth: authenticate = requireAuth, requireRole: authorize = requireRole } = {}) {
    const router = express.Router();

    const photoUpload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 5 * 1024 * 1024,
            files: 1,
            fields: 0,
            parts: 1,
        },
        fileFilter(_req, file, callback) {
            if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
                const error = new Error("Use a JPEG, PNG or WebP photo");
                error.code = "INVALID_IMAGE_TYPE";
                return callback(error);
            }
            callback(null, true);
        },
    });

    function receivePhoto(req, res, next) {
        photoUpload.single("photo")(req, res, (error) => {
            if (error) {
                const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
                const message = error.code === "LIMIT_FILE_SIZE"
                    ? "The photo must be 5 MB or smaller."
                    : error.code === "INVALID_IMAGE_TYPE"
                        ? "Use a JPEG, PNG or WebP photo"
                        : "Upload one photo using the photo field, without extra fields.";
                return res.status(status).json({ message });
            }
            next();
        });
    }

    // Show the classifications already available for species.
    router.get("/taxonomy", async (req, res) => {
        const paging = parsePagination(req.query, 100);
        if (!paging) return res.status(400).json({ message: "Invalid page or page_size" });
        const { data, error, count } = await supabase
            .from("taxonomy")
            .select("id, kingdom, division, class_name, order_name, family, genus", { count: "exact" })
            .order("genus")
            .order("id")
            .range(paging.start, paging.end);

        if (error) {
            console.error("Taxonomy list error:", error);
            return res.status(500).json({ message: "Could not load taxonomy" });
        }

        return res.json({ data, pagination: paginationMetadata(paging, count) });
    });

    router.post("/taxonomy", authenticate, authorize("officer"), async (req, res) => {
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return res.status(400).json({ message: "A taxonomy object is required" });
        }

        const fields = [
            "kingdom",
            "division",
            "class_name",
            "order_name",
            "family",
            "genus",
        ];
        const taxonomy = {};

        for (const field of fields) {
            const value = body[field];

            if (value == null) {
                if (field === "family" || field === "genus") {
                    return res.status(400).json({ message: `${field} is required` });
                }
                taxonomy[field] = null;
                continue;
            }

            if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
                return res.status(400).json({
                    message: `${field} must be text between 1 and 100 characters`,
                });
            }

            taxonomy[field] = value.trim();
        }

        const { data, error } = await req.supabase
            .from("taxonomy")
            .insert(taxonomy)
            .select("id, kingdom, division, class_name, order_name, family, genus")
            .single();

        if (error?.code === "23505") {
            return res.status(409).json({
                message: "This taxonomy classification already exists",
            });
        }

        if (error) {
            console.error("Create taxonomy error:", error);
            return res.status(500).json({ message: "Could not create taxonomy" });
        }

        return res.status(201).json({ data });
    });

    // Everything the officer's Species catalogue shows for one species, including its
    // family (from taxonomy) and its photos (so the page can ask for a photo link).
    const SPECIES_MEDIA_CREDIT_COLUMNS =
        "source, licence_code, attribution, photographer, source_url";
    const SPECIES_MEDIA_COLUMNS = `id, is_primary, ${SPECIES_MEDIA_CREDIT_COLUMNS}`;
    const SPECIES_EDITOR_COLUMNS =
        "id, scientific_name, common_name, local_name, species_category, conservation_status, " +
        "description, morphology, habitat, distribution_notes, cultural_significance, " +
        "verification_status, taxonomy_id";
    const MANAGE_COLUMNS =
        `${SPECIES_EDITOR_COLUMNS}, taxonomy(family, genus), species_media(${SPECIES_MEDIA_COLUMNS})`;
    const SPECIES_STATUSES = ["approved", "pending", "rejected", "archived"];

    // Let officers find species in any state (approved, pending, rejected, archived).
    // Optional filters: status (one of SPECIES_STATUSES) and q (name search).
    router.get("/species/manage", authenticate, authorize("officer"), async (req, res) => {
        const paging = parsePagination(req.query);
        if (!paging) return res.status(400).json({ message: "Invalid page or page_size" });
        const { status = "", q = "" } = req.query;
        if (typeof status !== "string" || (status !== "" && !SPECIES_STATUSES.includes(status)) ||
            typeof q !== "string" || q.length > 100 || !/^[\p{L}\p{N} .'-]*$/u.test(q)) {
            return res.status(400).json({ message: "Invalid species filters" });
        }

        let query = req.supabase
            .from("species")
            .select(MANAGE_COLUMNS, { count: "exact" });
        if (status) query = query.eq("verification_status", status);
        if (q.trim()) {
            const search = q.trim();
            query = query.or(`scientific_name.ilike.%${search}%,common_name.ilike.%${search}%,local_name.ilike.%${search}%`);
        }
        const { data, error, count } = await query
            .order("scientific_name")
            .order("id")
            .range(paging.start, paging.end);

        if (error) {
            console.error("Manage species list error:", error);
            return res.status(500).json({ message: "Could not load species" });
        }

        return res.json({ data: orderSpeciesMedia(data), pagination: paginationMetadata(paging, count) });
    });

    // ---- Species proposals ----
    // Botanists can only PROPOSE a species: the row is always "pending" and is hidden from
    // the public list and the New Record picker (both read approved rows only). Only an
    // officer can approve or reject it. These routes come before /species/:id so that
    // "proposals" is not read as a species ID.

    const PROPOSAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // Proposal body field -> species column. "family" is free text here because botanists
    // can't create taxonomy rows; the officer links a real taxonomy row when approving.
    const PROPOSAL_FIELDS = {
        common_name: "common_name",
        local_name: "local_name",
        family: "proposed_family",
        description: "description",
        habitat: "habitat",
    };
    const PROPOSAL_COLUMNS =
        "id, client_record_id, scientific_name, common_name, local_name, proposed_family, " +
        "description, habitat, verification_status, review_comment";

    // Escape % and _ so a name is matched literally by ILIKE (case-insensitive equality).
    function literalIlike(text) {
        return text.replace(/[\\%_]/g, (character) => `\\${character}`);
    }

    // POST /api/knowledge/species/proposals (botanist)
    router.post("/species/proposals", authenticate, authorize("botanist"), async (req, res) => {
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return res.status(400).json({ message: "A species proposal object is required" });
        }

        const scientificName = typeof body.scientific_name === "string" ? body.scientific_name.trim() : "";
        if (!scientificName || scientificName.length > 200) {
            return res.status(400).json({
                message: "scientific_name is required and must be at most 200 characters",
            });
        }
        // The phone's own ID for the proposal, so a retried upload isn't saved twice.
        if (typeof body.client_record_id !== "string" || !PROPOSAL_UUID.test(body.client_record_id)) {
            return res.status(400).json({ message: "client_record_id must be a UUID" });
        }

        // Only these fields are read. Anything else the client sends (verification_status,
        // proposed_by, taxonomy_id, review_comment...) is ignored, never trusted.
        const proposal = {
            scientific_name: scientificName,
            client_record_id: body.client_record_id,
            verification_status: "pending",
            proposed_by: req.user.id,
            created_by: req.user.id,
        };
        for (const [field, column] of Object.entries(PROPOSAL_FIELDS)) {
            const value = body[field];
            if (value === undefined || value === null) continue;
            const limitField = field === "family" ? "common_name" : field; // family: 200 like names
            if (!validOptionalText(limitField, value)) {
                return res.status(400).json({
                    message: `${field} must be non-empty text of at most ${textLimit(limitField)} characters or null`,
                });
            }
            proposal[column] = value.trim();
        }

        // A retry of an upload that already reached the server: return the saved row.
        const { data: existing, error: existingError } = await req.supabase
            .from("species")
            .select(PROPOSAL_COLUMNS)
            .eq("client_record_id", body.client_record_id)
            .eq("proposed_by", req.user.id)
            .maybeSingle();
        if (existingError) {
            console.error("Species proposal lookup error:", existingError);
            return res.status(500).json({ message: "Could not check for an existing proposal" });
        }
        if (existing) {
            return res.status(200).json({ message: "Species proposal already saved", data: existing });
        }

        // Friendly duplicate check (any letter case). The botanist can only see approved
        // species and their own proposals here; the unique index on lower(scientific_name)
        // also catches other botanists' pending proposals (23505 below).
        const { data: sameName, error: sameNameError } = await req.supabase
            .from("species")
            .select("id, verification_status")
            .ilike("scientific_name", literalIlike(scientificName))
            .limit(1);
        if (sameNameError) {
            console.error("Species proposal duplicate check error:", sameNameError);
            return res.status(500).json({ message: "Could not check for an existing species" });
        }
        if (Array.isArray(sameName) && sameName.length > 0) {
            return res.status(409).json({ message: "A species with this scientific name already exists or is already proposed" });
        }

        const { data, error } = await req.supabase
            .from("species")
            .insert(proposal)
            .select(PROPOSAL_COLUMNS)
            .single();

        if (error?.code === "23505") {
            return res.status(409).json({ message: "A species with this scientific name already exists or is already proposed" });
        }
        if (error) {
            console.error("Create species proposal error:", error);
            return res.status(500).json({ message: "Could not save species proposal" });
        }

        return res.status(201).json({ data });
    });

    // GET /api/knowledge/species/proposals/mine (botanist): their own proposals, any status.
    router.get("/species/proposals/mine", authenticate, authorize("botanist"), async (req, res) => {
        const paging = parsePagination(req.query, 100);
        if (!paging) return res.status(400).json({ message: "Invalid page or page_size" });

        const { data, error, count } = await req.supabase
            .from("species")
            .select(PROPOSAL_COLUMNS, { count: "exact" })
            .eq("proposed_by", req.user.id)
            .order("scientific_name")
            .order("id")
            .range(paging.start, paging.end);

        if (error) {
            console.error("My species proposals error:", error);
            return res.status(500).json({ message: "Could not load your species proposals" });
        }

        return res.json({ data, pagination: paginationMetadata(paging, count) });
    });

    // GET /api/knowledge/species/proposals/pending (officer): proposals waiting for review,
    // with the name of the botanist who proposed each one.
    router.get("/species/proposals/pending", authenticate, authorize("officer"), async (req, res) => {
        const paging = parsePagination(req.query, 100);
        if (!paging) return res.status(400).json({ message: "Invalid page or page_size" });

        const { data, error, count } = await req.supabase
            .from("species")
            .select(`${PROPOSAL_COLUMNS}, proposed_by, created_at`, { count: "exact" })
            .eq("verification_status", "pending")
            // Newest first (the page can switch to oldest first).
            .order("created_at", { ascending: false })
            .order("id")
            .range(paging.start, paging.end);

        if (error) {
            console.error("Pending species proposals error:", error);
            return res.status(500).json({ message: "Could not load species proposals" });
        }

        // Names are a separate lookup, so a missing profile only leaves the name empty.
        const proposerIds = [...new Set((data || []).map(row => row.proposed_by).filter(Boolean))];
        let nameById = new Map();
        if (proposerIds.length > 0) {
            const { data: profiles, error: profileError } = await req.supabase
                .from("profiles")
                .select("id, full_name")
                .in("id", proposerIds);
            if (profileError) {
                console.error("Species proposer lookup error:", profileError);
            } else {
                nameById = new Map((profiles || []).map(row => [row.id, row.full_name]));
            }
        }

        return res.json({
            data: (data || []).map(row => ({ ...row, proposer_name: nameById.get(row.proposed_by) || null })),
            pagination: paginationMetadata(paging, count),
        });
    });

    // PATCH /api/knowledge/species/proposals/:id/review (officer): approve or reject.
    router.patch("/species/proposals/:id/review", authenticate, authorize("officer"), async (req, res) => {
        if (!PROPOSAL_UUID.test(req.params.id)) {
            return res.status(400).json({ message: "Invalid species ID" });
        }
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return res.status(400).json({ message: "A review object is required" });
        }
        const { decision, comment, taxonomy_id: taxonomyId } = body;
        if (decision !== "approved" && decision !== "rejected") {
            return res.status(400).json({ message: "decision must be 'approved' or 'rejected'" });
        }
        if (comment != null && !validOptionalText("description", comment)) {
            return res.status(400).json({ message: "comment must be non-empty text or null" });
        }
        // The botanist needs to know why, so a rejection must say it.
        if (decision === "rejected" && comment == null) {
            return res.status(400).json({ message: "A comment is required when rejecting a proposal" });
        }
        if (taxonomyId != null && (typeof taxonomyId !== "string" || !PROPOSAL_UUID.test(taxonomyId))) {
            return res.status(400).json({ message: "Invalid taxonomy ID" });
        }

        const changes = { verification_status: decision, review_comment: comment == null ? null : comment.trim() };
        if (decision === "approved" && taxonomyId != null) changes.taxonomy_id = taxonomyId;

        // Only a pending proposal can be reviewed; the status filter makes this atomic.
        const { data, error } = await req.supabase
            .from("species")
            .update(changes)
            .eq("id", req.params.id)
            .eq("verification_status", "pending")
            .select(PROPOSAL_COLUMNS)
            .maybeSingle();

        if (error?.code === "23503") {
            return res.status(400).json({ message: "taxonomy_id does not refer to an existing taxonomy row" });
        }
        if (error) {
            console.error("Review species proposal error:", error);
            return res.status(500).json({ message: "Could not review species proposal" });
        }
        if (data) return res.json({ data });

        // Nothing updated: tell apart "no such species" from "not pending any more".
        const { data: current, error: currentError } = await req.supabase
            .from("species")
            .select("id, verification_status")
            .eq("id", req.params.id)
            .maybeSingle();
        if (currentError) {
            console.error("Review species proposal lookup error:", currentError);
            return res.status(500).json({ message: "Could not review species proposal" });
        }
        if (!current) return res.status(404).json({ message: "Species not found" });
        return res.status(409).json({ message: "Only pending proposals can be reviewed" });
    });

    // GET /api/knowledge/species
    router.get("/species", async (req, res) => {
        const { q = "", family = "", conservation_status: status = "", category = "", page = "1", page_size: pageSize = "50" } = req.query;
        const textFields = [q, family, status, category];
        if (textFields.some(value => typeof value !== "string" || value.length > 100) ||
            typeof page !== "string" || typeof pageSize !== "string" ||
            !/^[\p{L}\p{N} .'-]*$/u.test(q) ||
            !/^[\p{L}\p{N} .'-]*$/u.test(family) ||
            !/^[\p{L}\p{N} .'-]*$/u.test(status) ||
            !/^[\p{L}\p{N} .'-]*$/u.test(category) ||
            !/^[1-9]\d*$/.test(page) || !/^[1-9]\d*$/.test(pageSize)) {
            return res.status(400).json({ message: "Invalid species filters" });
        }

        const paging = parsePagination(req.query);
        if (!paging) {
            return res.status(400).json({ message: "Invalid page or page_size" });
        }

        // The public catalogue contains approved species only. Family belongs to taxonomy.
        const taxonomyJoin = family.trim() ? "taxonomy!inner(family)" : "taxonomy(family)";
        let query = supabase
            .from("species")
            .select(`id, scientific_name, common_name, local_name, species_category, conservation_status, description, ${taxonomyJoin}, species_media(${SPECIES_MEDIA_COLUMNS})`, { count: "exact" })
            .eq("verification_status", "approved");

        if (q.trim()) {
            const search = q.trim();
            query = query.or(`scientific_name.ilike.%${search}%,common_name.ilike.%${search}%,local_name.ilike.%${search}%`);
        }
        if (family.trim()) query = query.eq("taxonomy.family", family.trim());
        if (status.trim()) {
            query = status.trim().toLowerCase() === "unknown"
                ? query.is("conservation_status", null)
                : query.eq("conservation_status", status.trim());
        }
        if (category.trim()) query = query.eq("species_category", category.trim());

        const { page: pageNumber, page_size: size, start } = paging;
        const { data, error, count } = await query
            .order("scientific_name")
            .order("id")
            .range(start, start + size - 1);

        if (error) {
            console.error("Species query error:", error);
            return res.status(500).json({ message: "Could not load species" });
        }

        return res.json({
            data: orderSpeciesMedia(data),
            pagination: {
                page: pageNumber,
                page_size: size,
                total: count || 0,
                total_pages: Math.ceil((count || 0) / size),
            },
        });
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
            .select(`
    id,
    scientific_name,
    common_name,
    local_name,
    species_category,
    conservation_status,
    description,
    morphology,
    habitat,
    cultural_significance,
    taxonomy (
        kingdom,
        division,
        class_name,
        order_name,
        family,
        genus
    ),
    species_media (
        id,
        file_path,
        media_type,
        is_primary,
        source,
        licence_code,
        attribution,
        photographer,
        source_url
    )
 `)
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

        res.json({ data: orderSpeciesMedia(data) });
    });

    // Officers can inspect a species even after it has been archived.
    router.get(
        "/species/:id/manage",
        authenticate,
        authorize("officer"),
        async (req, res) => {
            const id = req.params.id;
            const uuidPattern =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

            if (!uuidPattern.test(id)) {
                return res.status(400).json({ message: "Invalid species ID" });
            }

            const { data, error } = await req.supabase
                .from("species")
                .select(MANAGE_COLUMNS)
                .eq("id", id)
                .maybeSingle();

            if (error) {
                console.error("Manage species lookup error:", error);
                return res.status(500).json({ message: "Could not load species" });
            }
            if (!data) return res.status(404).json({ message: "Species not found" });

            return res.json({ data: orderSpeciesMedia(data) });
        }
    );

    router.post("/species", authenticate, authorize("officer"), async (req, res) => {
        const body = req.body;

        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return res.status(400).json({ message: "A species object is required" });
        }

        const scientificName =
            typeof body.scientific_name === "string"
                ? body.scientific_name.trim()
                : "";

        if (!scientificName || scientificName.length > 200) {
            return res.status(400).json({
                message: "scientific_name is required and must be at most 200 characters",
            });
        }

        if (body.taxonomy_id != null &&
            (typeof body.taxonomy_id !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.taxonomy_id))) {
            return res.status(400).json({ message: "Invalid taxonomy ID" });
        }

        const optionalTextFields = [
            "common_name",
            "local_name",
            "species_category",
            "conservation_status",
            "description",
            "morphology",
            "habitat",
            "distribution_notes",
            "cultural_significance",
        ];

        const species = {
            scientific_name: scientificName,
            taxonomy_id: body.taxonomy_id || null,
            verification_status: "approved",
            created_by: req.user.id,
        };

        for (const field of optionalTextFields) {
            if (Object.hasOwn(body, field)) {
                if (body[field] === null) { species[field] = null; continue; }
                if (!validOptionalText(field, body[field])) {
                    return res.status(400).json({
                        message: `${field} must be non-empty text of at most ${textLimit(field)} characters or null`,
                    });
                }
                species[field] = body[field].trim();
            }
        }

        const { data, error } = await req.supabase
            .from("species")
            .insert(species)
            .select(SPECIES_EDITOR_COLUMNS)
            .single();

        if (error?.code === "23505") {
            return res.status(409).json({
                message: "A species with this scientific name already exists",
            });
        }

        if (error?.code === "23503") {
            return res.status(400).json({
                message: "taxonomy_id does not refer to an existing taxonomy row",
            });
        }

        if (error) {
            console.error("Create species error:", error);
            return res.status(500).json({ message: "Could not create species" });
        }

        return res.status(201).json({ data: orderSpeciesMedia(data) });
    });

    router.patch("/species/:id", authenticate, authorize("officer"), async (req, res) => {
        const uuidPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidPattern.test(req.params.id)) {
            return res.status(400).json({ message: "Invalid species ID" });
        }
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({ message: "A species object is required" });
        }

        const changes = {};

        if (Object.hasOwn(req.body, "scientific_name")) {
            const name = req.body.scientific_name;

            if (typeof name !== "string" || !name.trim() || name.trim().length > 200) {
                return res.status(400).json({
                    message: "scientific_name must be text between 1 and 200 characters",
                });
            }

            changes.scientific_name = name.trim();
        }

        for (const field of [
            "common_name",
            "local_name",
            "species_category",
            "conservation_status",
            "description",
            "morphology",
            "habitat",
            "distribution_notes",
            "cultural_significance",
        ]) {
            if (Object.hasOwn(req.body, field)) {
                const value = req.body[field];

                if (value === null) {
                    changes[field] = null;
                } else if (validOptionalText(field, value)) {
                    changes[field] = value.trim();
                } else {
                    return res.status(400).json({
                        message: `${field} must be non-empty text of at most ${textLimit(field)} characters or null`,
                    });
                }
            }
        }

        if (Object.hasOwn(req.body, "taxonomy_id")) {
            const taxonomyId = req.body.taxonomy_id;

            if (
                taxonomyId !== null &&
                (typeof taxonomyId !== "string" || !uuidPattern.test(taxonomyId))
            ) {
                return res.status(400).json({ message: "Invalid taxonomy ID" });
            }

            changes.taxonomy_id = taxonomyId;
        }

        if (Object.keys(changes).length === 0) {
            return res.status(400).json({
                message: "Provide at least one editable species field",
            });
        }

        const { data, error } = await req.supabase
            .from("species")
            .update(changes)
            .eq("id", req.params.id)
            .select(SPECIES_EDITOR_COLUMNS)
            .maybeSingle();

        if (error?.code === "23505") {
            return res.status(409).json({
                message: "A species with this scientific name already exists",
            });
        }

        if (error?.code === "23503") {
            return res.status(400).json({
                message: "taxonomy_id does not refer to an existing taxonomy row",
            });
        }

        if (error) {
            console.error("Update species error:", error);
            return res.status(500).json({ message: "Could not update species" });
        }

        if (!data) return res.status(404).json({ message: "Species not found" });

        return res.json({ data: orderSpeciesMedia(data) });
    });

    router.delete("/species/:id", authenticate, authorize("officer"), async (req, res) => {
        const uuidPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidPattern.test(req.params.id)) {
            return res.status(400).json({ message: "Invalid species ID" });
        }

        const { data, error } = await req.supabase
            .from("species")
            .update({ verification_status: "archived" })
            .eq("id", req.params.id)
            .select("id")
            .maybeSingle();

        if (error) {
            console.error("Archive species error:", error);
            return res.status(500).json({ message: "Could not archive species" });
        }

        if (!data) return res.status(404).json({ message: "Species not found" });

        return res.json({ message: "Species archived" });
    });

    router.post(
        "/species/:id/photos",
        authenticate,
        authorize("officer"),
        receivePhoto,
        async (req, res) => {
            const id = req.params.id;
            const uuidPattern =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

            // Make sure we have a valid species ID and a photo.
            if (!uuidPattern.test(id)) {
                return res.status(400).json({ message: "Invalid species ID" });
            }
            if (!req.file) {
                return res.status(400).json({ message: "Photo is required" });
            }

            // Only add photos to approved species.
            const { data: species, error: lookupError } = await req.supabase
                .from("species")
                .select("id, verification_status")
                .eq("id", id)
                .maybeSingle();

            if (lookupError) {
                return res.status(500).json({ message: "Could not check species" });
            }
            if (!species) {
                return res.status(404).json({ message: "Species not found" });
            }
            if (species.verification_status !== "approved") {
                return res.status(409).json({ message: "Species is not approved" });
            }

            let jpeg;
            try {
                const metadata = await sharp(req.file.buffer, {
                    limitInputPixels: 25_000_000,
                }).metadata();

                const expectedFormat = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[req.file.mimetype];
                if (metadata.format !== expectedFormat) {
                    return res.status(400).json({ message: "The photo content must match its JPEG, PNG or WebP type" });
                }

                // Resize the image and save a fresh JPEG without its original metadata.
                jpeg = await sharp(req.file.buffer, {
                    limitInputPixels: 25_000_000,
                })
                    .rotate()
                    .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
                    .jpeg({ quality: 85 })
                    .toBuffer();
            } catch {
                return res.status(400).json({ message: "Invalid photo" });
            }

            const filePath = `${id}/${randomUUID()}.jpg`;
            const bucket = req.supabase.storage.from("species-media");

            // Store the processed photo in the private bucket.
            const { error: uploadError } = await bucket.upload(filePath, jpeg, {
                contentType: "image/jpeg",
                upsert: false,
            });

            if (uploadError) {
                console.error("Species photo upload error:", uploadError);
                return res.status(500).json({ message: "Could not upload photo" });
            }

            // Save the photo's details so the species page can find it.
            const { data: media, error: saveError } = await req.supabase
                .from("species_media")
                .insert({
                    species_id: id,
                    uploaded_by: req.user.id,
                    file_path: filePath,
                    media_type: "image/jpeg",
                    is_primary: false,
                })
                .select("id, species_id, file_path, media_type, is_primary, source, licence_code, attribution, photographer, source_url")
                .single();

            if (saveError) {
                console.error("Species photo record error:", saveError);
                const { error: cleanupError } = await bucket.remove([filePath]);
                if (cleanupError) console.error("Species photo cleanup error:", cleanupError);
                return res.status(500).json({ message: "Could not save photo record" });
            }

            return res.status(201).json({ data: media });
        }
    );

    router.patch(
        "/species/:id/photos/:photoId/primary",
        authenticate,
        authorize("officer"),
        async (req, res) => {
            const { id, photoId } = req.params;
            const uuidPattern =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

            if (!uuidPattern.test(id) || !uuidPattern.test(photoId)) {
                return res.status(400).json({ message: "Invalid ID" });
            }

            const { error } = await req.supabase.rpc("set_primary_species_photo", {
                p_species_id: id,
                p_photo_id: photoId,
            });

            if (error?.code === "P0002") {
                return res.status(404).json({ message: "Photo not found" });
            }
            if (error?.code === "42501") {
                return res.status(403).json({ message: "Officer access required" });
            }
            if (error?.code === "23505") {
                return res.status(409).json({ message: "Primary photo conflict" });
            }
            if (error) {
                console.error("Set primary photo error:", error);
                return res.status(500).json({ message: "Could not set primary photo" });
            }

            const { data: photo, error: photoError } = await req.supabase
                .from("species_media")
                .select(`id, species_id, is_primary, ${SPECIES_MEDIA_CREDIT_COLUMNS}`)
                .eq("id", photoId)
                .eq("species_id", id)
                .maybeSingle();
            if (photoError) {
                console.error("Primary photo lookup error:", photoError);
                return res.status(500).json({ message: "Could not load photo details" });
            }
            if (!photo) return res.status(404).json({ message: "Photo not found" });
            return res.json({ data: photo });
        }
    );

    router.delete(
        "/species/:id/photos/:photoId",
        authenticate,
        authorize("officer"),
        async (req, res) => {
            const { id, photoId } = req.params;
            const uuidPattern =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

            if (!uuidPattern.test(id) || !uuidPattern.test(photoId)) {
                return res.status(400).json({ message: "Invalid ID" });
            }

            const { data: photo, error: lookupError } = await req.supabase
                .from("species_media")
                .select("*")
                .eq("id", photoId)
                .eq("species_id", id)
                .maybeSingle();

            if (lookupError) {
                console.error("Photo lookup error:", lookupError);
                return res.status(500).json({ message: "Could not check photo" });
            }
            if (!photo) return res.status(404).json({ message: "Photo not found" });
            if (photo.is_primary) {
                return res.status(409).json({
                    message: "Choose another primary photo before removing this one",
                });
            }

            // Remove the record first so visitors can no longer find the photo.
            const { data: deleted, error: deleteError } = await req.supabase
                .from("species_media")
                .delete()
                .eq("id", photoId)
                .eq("species_id", id)
                .eq("is_primary", false)
                .select("id")
                .maybeSingle();

            if (deleteError) {
                console.error("Photo record deletion error:", deleteError);
                return res.status(500).json({ message: "Could not remove photo record" });
            }
            if (!deleted) {
                return res.status(409).json({ message: "Photo changed; please try again" });
            }

            const { error: fileError } = await req.supabase.storage
                .from("species-media")
                .remove([photo.file_path]);

            if (fileError) {
                console.error("Photo file deletion error:", fileError);

                // Keep the record if removing the file did not work.
                const { error: restoreError } = await req.supabase
                    .from("species_media")
                    .insert(photo);
                if (restoreError) console.error("Photo record restore error:", restoreError);

                return res.status(500).json({ message: "Could not remove photo file" });
            }

            return res.json({ message: "Photo removed" });
        }
    );

    router.get("/species/:id/photos/:photoId", async (req, res) => {
        const uuidPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidPattern.test(req.params.id) || !uuidPattern.test(req.params.photoId)) {
            return res.status(400).json({ message: "Invalid ID" });
        }

        // Public readers can find photo records only for approved species.
        const { data: photo, error: lookupError } = await supabase
            .from("species_media")
            .select("file_path, source, licence_code, attribution, photographer, source_url")
            .eq("id", req.params.photoId)
            .eq("species_id", req.params.id)
            .maybeSingle();

        if (lookupError) {
            console.error("Photo lookup error:", lookupError);
            return res.status(500).json({ message: "Could not find photo" });
        }
        if (!photo) {
            return res.status(404).json({ message: "Photo not found" });
        }

        // Give the visitor a link that works for one minute.
        const { data, error } = await supabase.storage
            .from("species-media")
            .createSignedUrl(photo.file_path, 60);

        if (error) {
            console.error("Photo link error:", error);
            return res.status(500).json({ message: "Could not open photo" });
        }

        res.set("Cache-Control", "no-store");
        return res.json({
            url: data.signedUrl,
            expires_in: 60,
            source: photo.source,
            licence_code: photo.licence_code,
            attribution: photo.attribution,
            photographer: photo.photographer,
            source_url: photo.source_url,
        });
    });

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        console.error("Knowledge API error:", error);
        return res.status(500).json({ message: "Could not process knowledge request" });
    });
    return router;
}

module.exports = createKnowledgeRouter();
module.exports.createKnowledgeRouter = createKnowledgeRouter;
