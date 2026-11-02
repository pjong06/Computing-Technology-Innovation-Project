const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { randomUUID } = require("node:crypto");
const { requireAuth, requireRole } = require("../middleware/auth");

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
    return { page: paging.page, page_size: paging.page_size,
        total: count ?? 0, total_pages: Math.ceil((count ?? 0) / paging.page_size) };
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
    limits: { fileSize: 10 * 1024 * 1024 },
});

function receivePhoto(req, res, next) {
    photoUpload.single("photo")(req, res, (error) => {
        if (error) {
            const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
            return res.status(status).json({ message: "Could not receive photo" });
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

// Let officers find approved and archived species.
router.get("/species/manage", authenticate, authorize("officer"), async (req, res) => {
    const paging = parsePagination(req.query);
    if (!paging) return res.status(400).json({ message: "Invalid page or page_size" });
    const { data, error, count } = await req.supabase
        .from("species")
        .select("id, scientific_name, common_name, verification_status", { count: "exact" })
        .order("scientific_name")
        .order("id")
        .range(paging.start, paging.end);

    if (error) {
        console.error("Manage species list error:", error);
        return res.status(500).json({ message: "Could not load species" });
    }

    return res.json({ data, pagination: paginationMetadata(paging, count) });
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
        .select(`id, scientific_name, common_name, local_name, species_category, conservation_status, description, ${taxonomyJoin}`, { count: "exact" })
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
        data,
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
        is_primary
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

    res.json({ data });
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
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (error) {
            console.error("Manage species lookup error:", error);
            return res.status(500).json({ message: "Could not load species" });
        }
        if (!data) return res.status(404).json({ message: "Species not found" });

        return res.json({ data });
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
        .select()
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

    return res.status(201).json({ data });
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
        .select()
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

    return res.json({ data });
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

            if (!["jpeg", "png"].includes(metadata.format)) {
                return res.status(400).json({ message: "Use a JPEG or PNG photo" });
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
            .select("id, species_id, file_path, media_type, is_primary")
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

        return res.json({
            data: { id: photoId, species_id: id, is_primary: true },
        });
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
        .select("file_path")
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
    return res.json({ url: data.signedUrl, expires_in: 60 });
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
