const express = require("express");
const { randomUUID } = require("node:crypto");
const upload = require("../services/storageService");
const { generatePlantQR, buildPublicPlantUrl, TAG_PATTERN, QrConfigurationError } = require("../services/qrService");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// The public QR visitor endpoint belongs to the visitor feature, not this staff API.
router.use(requireAuth);

function canReadPlant(plant, profile) {
    if (profile.role === "officer") return true;
    if (profile.role === "botanist" && plant.registered_by === profile.id) return true;
    return plant.plant_status === "approved" &&
        ["botanist", "researcher", "admin"].includes(profile.role);
}

function visiblePlant(plant, profile) {
    if (profile.role === "officer" ||
        (profile.role === "botanist" && plant.registered_by === profile.id)) return plant;

    const { registered_by, ...approvedData } = plant;
    if (profile.role === "botanist" || profile.role === "researcher") return approvedData;

    // Admins receive public fields only. Unknown species sensitivity hides GPS.
    const publicData = {
        plant_id: plant.plant_id,
        scientific_name: plant.scientific_name,
        common_name: plant.common_name
    };
    if (plant.photo) publicData.photo = plant.photo;
    if (plant.species_endangered === false) {
        publicData.latitude = plant.latitude;
        publicData.longitude = plant.longitude;
        publicData.gps_accuracy_m = plant.gps_accuracy_m;
    }
    return publicData;
}

// Ownership check for edits and deletes. Officers may change any plant; botanists
// may only change plants they registered themselves. Call this before any write so
// nothing is changed or deleted when access is denied.
async function checkPlantWriteAccess(req, res, plantId) {
    const { data: plant, error } = await req.supabase
        .from("plants")
        .select("id, registered_by")
        .eq("id", plantId)
        .maybeSingle();

    if (error) {
        console.error("Plant access check error:", error);
        res.status(500).json({ message: "Could not check plant access" });
        return false;
    }
    if (!plant) {
        res.status(404).json({ message: "Plant record not found" });
        return false;
    }
    if (req.profile.role !== "officer" && plant.registered_by !== req.user.id) {
        res.status(403).json({ message: "You can only change your own plant records" });
        return false;
    }
    return true;
}

// List plants visible to the signed-in staff member.
router.get("/", requireRole("botanist", "officer", "researcher"), async (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = 50;

    if (!Number.isSafeInteger(page) || page < 1) {
        return res.status(400).json({ message: "page must be a positive integer" });
    }

    const firstRow = (page - 1) * pageSize;

    const { data, error, count } = await req.supabase
        .from("plants")
        .select(
            "id, species_id, qr_code_value, plant_status, registered_at",
            { count: "exact" }
        )
        .order("registered_at", { ascending: false })
        .range(firstRow, firstRow + pageSize - 1);

    if (error) {
        console.error("List plants error:", error);
        return res.status(500).json({ message: "Could not load plants" });
    }

    return res.json({
        data: data.map(plant => ({
            ...plant,
            plant_id: plant.id
        })),
        pagination: {
            page,
            page_size: pageSize,
            total: count
        }
    });
});

// ── C10: LOOK UP PLANT BY TAG CODE ──────────────────────────────
// Placed before /:id so Express does not treat "tag" as an :id parameter
router.get("/tag/:tagCode", requireRole("botanist", "officer", "researcher"), async (req, res) => {
    const rawTag = req.params.tagCode?.trim().toUpperCase();

    if (!/^NIAH-PLT-\d{5}$/.test(rawTag)) {
        return res.status(400).json({ message: "Tag code must follow NIAH-PLT-00001 format" });
    }

    try {
        const { data, error } = await req.supabase
            .from("plants")
            .select(`
                id,
                client_record_id,
                species_id,
                qr_code_value,
                location,
                gps_accuracy_m,
                location_description,
                morphology,
                description,
                plant_status,
                registered_by,
                registered_at,
                species:species_id (
                    id,
                    scientific_name,
                    common_name,
                    local_name,
                    conservation_status
                )
            `)
            .eq("qr_code_value", rawTag)
            .maybeSingle();

        if (error) {
            console.error("Plant tag lookup error:", error);
            return res.status(500).json({ message: "Could not query tag from database" });
        }

        if (!data) {
            return res.status(404).json({ message: "No plant record found with this tag code" });
        }

        return res.json({
            data: {
                ...data,
                plant_id: data.id,
                tag_code: data.qr_code_value,
                scientific_name: data.species?.scientific_name ?? "Unknown species",
                common_name: data.species?.common_name ?? "",
                location_name: data.location_description ?? "Niah National Park",
            }
        });
    } catch (err) {
        console.error("Server error looking up tag:", err);
        return res.status(500).json({ message: "Internal server error" });
    }
});

// GET one plant by ID
router.get("/:id", requireRole("botanist", "officer", "researcher"), async (req, res) => {
    const plantId = req.params.id;
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(plantId)) {
        return res.status(400).json({ message: "Valid plant ID is required" });
    }

    const { data, error } = await req.supabase
        .from("plants")
        .select(
            "id, species_id, qr_code_value, plant_status, registered_at, " +
            "gps_accuracy_m, location_description"
        )
        .eq("id", plantId)
        .maybeSingle();

    if (error) {
        console.error("Get plant error:", error);
        return res.status(500).json({ message: "Could not load plant" });
    }

    if (!data) {
        return res.status(404).json({ message: "Plant not found" });
    }

    return res.json({
        ...data,
        plant_id: data.id
    });
});

// Save a field record in Supabase under the signed-in botanist.
router.post("/", requireRole("botanist"), async (req, res) => {
    const { latitude, longitude } = req.body || {};
    const { morphology, description } = req.body || {};

    for (const [field, value] of Object.entries({ morphology, description })) {
        if (
            value != null &&
            (typeof value !== "string" || value.length > 5000)
        ) {
            return res.status(400).json({
                message: `${field} must be text of at most 5000 characters`
            });
        }
    }

    const scientificName =
        typeof req.body?.scientific_name === "string"
            ? req.body.scientific_name.trim()
            : "";
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (
        typeof latitude !== "number" ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        typeof longitude !== "number" ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
    ) {
        return res.status(400).json({ message: "Valid latitude and longitude are required" });
    }

    if (
        req.body?.gps_accuracy_m !== undefined &&
        (typeof req.body.gps_accuracy_m !== "number" ||
            !Number.isFinite(req.body.gps_accuracy_m) ||
            req.body.gps_accuracy_m < 0)
    ) {
        return res.status(400).json({ message: "gps_accuracy_m must be a non-negative number" });
    }

    const locationDescription =
        req.body?.location_description ?? req.body?.location_name;

    if (
        locationDescription != null &&
        (typeof locationDescription !== "string" ||
            locationDescription.trim().length > 500)
    ) {
        return res.status(400).json({
            message: "location must be text up to 500 characters"
        });
    }

    let speciesId = req.body?.species_id || null;
    let species = null;

    if (speciesId !== null) {
        if (typeof speciesId !== "string" || !uuidPattern.test(speciesId)) {
            return res.status(400).json({ message: "Invalid species_id" });
        }

        const { data, error } = await req.supabase
            .from("species")
            .select("id, scientific_name, common_name")
            .eq("id", speciesId)
            .eq("verification_status", "approved")
            .maybeSingle();

        if (error) {
            console.error("Plant species lookup error:", error);
            return res.status(500).json({ message: "Could not check the selected species" });
        }
        species = data;
    } else if (scientificName) {
        const { data, error } = await req.supabase
            .from("species")
            .select("id, scientific_name, common_name")
            .eq("scientific_name", scientificName)
            .eq("verification_status", "approved")
            .maybeSingle();

        if (error) {
            console.error("Plant species lookup error:", error);
            return res.status(500).json({ message: "Could not check the selected species" });
        }
        species = data;
        speciesId = data?.id || null;
    }

    // Allow unknown species
    if ((speciesId !== null || scientificName) && !species) {
        return res.status(400).json({
            message: "Selected species must be approved; omit species fields for an unidentified plant"
        });
    }

    const clientRecordId = req.body?.client_record_id || randomUUID();
    if (typeof clientRecordId !== "string" || !uuidPattern.test(clientRecordId)) {
        return res.status(400).json({ message: "client_record_id must be a UUID" });
    }

    const inputTag = req.body?.qr_code_value;
    const qrCodeValue =
        inputTag == null
            ? `plant:${clientRecordId}`
            : typeof inputTag === "string"
                ? inputTag.trim().toUpperCase()
                : "";

    if (inputTag != null && !/^NIAH-PLT-\d{5}$/.test(qrCodeValue)) {
        return res.status(400).json({
            message: "qr_code_value must look like NIAH-PLT-00001"
        });
    }

    // Repeated sync requests with the same client ID return the saved row
    const { data: existing, error: existingError } = await req.supabase
        .from("plants")
        .select("id, client_record_id, species_id, qr_code_value, gps_accuracy_m, location_description, plant_status, registered_by, registered_at, row_version")
        .eq("client_record_id", clientRecordId)
        .maybeSingle();

    if (existingError) {
        console.error("Plant duplicate check error:", existingError);
        return res.status(500).json({ message: "Could not check for an existing plant record" });
    }
    if (existing) {
        return res.status(200).json({ message: "Plant record already saved", plant: existing });
    }

    const plant = {
        client_record_id: clientRecordId,
        species_id: speciesId,
        qr_code_value: qrCodeValue,
        location: `POINT(${longitude} ${latitude})`,
        gps_accuracy_m: req.body.gps_accuracy_m ?? null,
        location_description: locationDescription?.trim() || null,
        morphology: morphology?.trim() || null,
        description: description?.trim() || null,
        plant_status: "pending",
        registered_by: req.user.id,
    };

    const { data, error } = await req.supabase
        .from("plants")
        .insert(plant)
        .select("id, client_record_id, species_id, qr_code_value, gps_accuracy_m, location_description, plant_status, registered_by, registered_at, row_version")
        .single();

    if (error?.code === "23505") {
        return res.status(409).json({
            message: "Client record ID or QR tag is already in use",
        });
    }
    if (error?.code === "42501") {
        return res.status(403).json({ message: "Botanist access is required to save plant records" });
    }
    if (error) {
        console.error("Create plant error:", error);
        return res.status(500).json({ message: "Could not save plant record" });
    }

    return res.status(201).json({
        message: "Plant record saved to Supabase",
        plant: {
            ...data,
            plant_id: data.id,
            scientific_name: species?.scientific_name ?? null,
            common_name: species?.common_name ?? null,
            latitude,
            longitude,
        },
    });
});

// ── EDIT / UPDATE PLANT RECORD ──────────────────────────────────
router.patch("/:id", requireRole("botanist", "officer"), async (req, res) => {
    const plantId = req.params.id;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(plantId)) {
        return res.status(400).json({ message: "Valid plant ID is required" });
    }

    const {
        location_name,
        location_description,
        morphology,
        description,
        tag_code,
        qr_code_value,
    } = req.body;

    const updates = {};
    const loc = location_description ?? location_name;
    if (loc !== undefined) updates.location_description = loc ? loc.trim() : null;
    if (morphology !== undefined) updates.morphology = morphology ? morphology.trim() : null;
    if (description !== undefined) updates.description = description ? description.trim() : null;

    const newTag = qr_code_value ?? tag_code;
    if (newTag !== undefined) {
        const cleaned = newTag.trim().toUpperCase();
        if (!/^NIAH-PLT-\d{5}$/.test(cleaned)) {
            return res.status(400).json({ message: "Tag code must look like NIAH-PLT-00001" });
        }
        updates.qr_code_value = cleaned;
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields provided to update" });
    }

    if (!(await checkPlantWriteAccess(req, res, plantId))) return;

    try {
        const { data, error } = await req.supabase
            .from("plants")
            .update(updates)
            .eq("id", plantId)
            .select()
            .maybeSingle();

        if (error) {
            console.error("Update plant error:", error);
            return res.status(500).json({ message: "Could not update plant record" });
        }

        if (!data) {
            return res.status(404).json({ message: "Plant record not found" });
        }

        return res.json({
            message: "Record updated successfully",
            plant: { ...data, plant_id: data.id }
        });
    } catch (err) {
        console.error("Server error updating plant:", err);
        return res.status(500).json({ message: "Internal server error" });
    }
});

// ── DELETE PLANT RECORD ─────────────────────────────────────────
router.delete("/:id", requireRole("botanist", "officer"), async (req, res) => {
    const plantId = req.params.id;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(plantId)) {
        return res.status(400).json({ message: "Valid plant ID is required" });
    }

    if (!(await checkPlantWriteAccess(req, res, plantId))) return;

    try {
        // Delete child observations if any exist
        await req.supabase.from("observations").delete().eq("plant_id", plantId);

        // Delete the plant record
        const { data, error } = await req.supabase
            .from("plants")
            .delete()
            .eq("id", plantId)
            .select("id")
            .maybeSingle();

        if (error) {
            console.error("Delete plant error:", error);
            return res.status(500).json({ message: "Could not delete plant record" });
        }

        if (!data) {
            return res.status(404).json({ message: "Plant record not found" });
        }

        return res.json({
            message: "Plant deleted successfully",
            plant_id: data.id
        });
    } catch (err) {
        console.error("Server error deleting plant:", err);
        return res.status(500).json({ message: "Internal server error" });
    }
});

const PHOTO_UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Photos can only be added while the plant is still editable.
const PHOTOS_LOCKED_MESSAGE =
    "Photos can't be added after submission";

function isRlsRefusal(error) {
    return !!error && (
        error.code === "42501" ||
        String(error.statusCode) === "403" ||
        /row-level security/i.test(error.message || "")
    );
}

// UPLOAD a photo for a plant
router.post(
    "/:id/photo",
    requireRole("botanist"),

    async (req, res, next) => {
        const plantId = req.params.id;

        if (!PHOTO_UUID.test(plantId)) {
            return res.status(400).json({
                message: "Valid plant ID is required"
            });
        }

        const { data: plant, error } =
            await req.supabase
                .from("plants")
                .select("id, registered_by, plant_status")
                .eq("id", plantId)
                .maybeSingle();

        if (error) {
            console.error(
                "Plant photo ownership lookup error:",
                error
            );

            return res.status(500).json({
                message: "Failed to check plant"
            });
        }

        if (!plant) {
            return res.status(404).json({
                message: "Plant not found"
            });
        }

        if (plant.registered_by !== req.user.id) {
            return res.status(403).json({
                message:
                    "Only the plant owner may upload photos"
            });
        }

        if (
            plant.plant_status &&
            plant.plant_status !== "pending"
        ) {
            return res.status(409).json({
                message: PHOTOS_LOCKED_MESSAGE,
                code: "photos_locked"
            });
        }

        next();
    },

    upload.single("photo"),

    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                message: "No photo uploaded"
            });
        }

        const allowedPhotoTypes = [
            "whole_plant",
            "leaf",
            "flower",
            "bark"
        ];

        const photoType = req.body.photo_type;

        if (!allowedPhotoTypes.includes(photoType)) {
            return res.status(400).json({
                message:
                    "photo_type must be whole_plant, leaf, flower or bark"
            });
        }

        /*
         * Support both names:
         * - kai offline-sync code sends client_record_id
         * - newer main code may send client_photo_id
         */
        const photoClientId =
            req.body.client_record_id ||
            req.body.client_photo_id;

        if (
            typeof photoClientId !== "string" ||
            !PHOTO_UUID.test(photoClientId)
        ) {
            return res.status(400).json({
                message:
                    "Photo client ID must be a valid UUID"
            });
        }

        const plantId = req.params.id;

        /*
         * Idempotency:
         * retrying the same phone photo must not create duplicates.
         */
        const {
            data: existingMedia,
            error: existingError
        } = await req.supabase
            .from("plant_media")
            .select("*")
            .eq("client_record_id", photoClientId)
            .maybeSingle();

        if (existingError) {
            console.error(
                "Plant media idempotency lookup error:",
                existingError
            );

            return res.status(500).json({
                message:
                    "Failed to check existing plant photo"
            });
        }

        if (existingMedia) {
            if (
                existingMedia.plant_id !== plantId ||
                existingMedia.uploaded_by !== req.user.id ||
                existingMedia.photo_type !== photoType
            ) {
                return res.status(409).json({
                    message:
                        "Photo client ID is already used by another plant photo"
                });
            }

            return res.status(200).json({
                message: "Plant photo already uploaded",
                plant_id: plantId,
                media: existingMedia
            });
        }

        const extension = {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp"
        }[req.file.mimetype];

        if (!extension) {
            return res.status(400).json({
                message: "Unsupported image type"
            });
        }

        const filePath =
            `${req.user.id}/${plantId}/${randomUUID()}.${extension}`;

        try {
            const { error: uploadError } =
                await req.supabase.storage
                    .from("plant-media")
                    .upload(
                        filePath,
                        req.file.buffer,
                        {
                            contentType: req.file.mimetype,
                            upsert: false
                        }
                    );

            if (uploadError) {
                if (isRlsRefusal(uploadError)) {
                    return res.status(409).json({
                        message: PHOTOS_LOCKED_MESSAGE,
                        code: "photos_locked"
                    });
                }

                console.error(
                    "Plant photo storage error:",
                    uploadError
                );

                return res.status(500).json({
                    message:
                        "Failed to upload plant photo"
                });
            }

            const {
                data: media,
                error: mediaError
            } = await req.supabase
                .from("plant_media")
                .insert({
                    client_record_id: photoClientId,
                    plant_id: plantId,
                    uploaded_by: req.user.id,
                    file_path: filePath,
                    media_type: "image",
                    photo_type: photoType,
                    is_primary:
                        photoType === "whole_plant"
                })
                .select()
                .single();

            if (mediaError) {
                /*
                 * Two retries may race.
                 * The unique client_record_id decides the winner.
                 */
                if (mediaError.code === "23505") {
                    await req.supabase.storage
                        .from("plant-media")
                        .remove([filePath]);

                    const { data: racedMedia } =
                        await req.supabase
                            .from("plant_media")
                            .select("*")
                            .eq(
                                "client_record_id",
                                photoClientId
                            )
                            .maybeSingle();

                    if (
                        racedMedia &&
                        racedMedia.plant_id === plantId &&
                        racedMedia.uploaded_by === req.user.id &&
                        racedMedia.photo_type === photoType
                    ) {
                        return res.status(200).json({
                            message:
                                "Plant photo already uploaded",
                            plant_id: plantId,
                            media: racedMedia
                        });
                    }
                }

                await req.supabase.storage
                    .from("plant-media")
                    .remove([filePath]);

                if (isRlsRefusal(mediaError)) {
                    return res.status(409).json({
                        message: PHOTOS_LOCKED_MESSAGE,
                        code: "photos_locked"
                    });
                }

                console.error(
                    "Plant media insert error:",
                    mediaError
                );

                return res.status(500).json({
                    message:
                        "Failed to save plant photo record"
                });
            }

            return res.status(201).json({
                message:
                    "Plant photo uploaded successfully",
                plant_id: plantId,
                media
            });
        } catch (error) {
            console.error(
                "Plant photo upload error:",
                error
            );

            return res.status(500).json({
                message:
                    "Plant photo upload failed"
            });
        }
    }
);

// Find the signed-in botanist's plant and its physical QR tag.
async function findOwnedPlantQrTag(req, res) {
    const plantId = req.params.id;
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(plantId)) {
        res.status(400).json({ message: "Valid plant ID is required" });
        return null;
    }

    const { data, error } = await req.supabase
        .from("plants")
        .select("id, qr_code_value")
        .eq("id", plantId)
        .eq("registered_by", req.user.id)
        .maybeSingle();

    if (error) {
        console.error("Plant QR lookup error:", error);
        res.status(500).json({ message: "Could not load plant QR tag" });
        return null;
    }

    if (!data) {
        res.status(404).json({ message: "Plant not found" });
        return null;
    }

    if (!/^NIAH-PLT-\d{5}$/.test(data.qr_code_value)) {
        res.status(409).json({
            message: "Attach a NIAH-PLT tag before generating its QR code"
        });
        return null;
    }

    return data.qr_code_value;
}

// Generate QR data for a plant owned by the signed-in botanist.
router.get("/:id/qr", requireRole("botanist"), async (req, res) => {
    const qrValue = await findOwnedPlantQrTag(req, res);
    if (!qrValue) return;

    try {
        const qr = await generatePlantQR(qrValue);
        return res.json({
            message: "QR code generated successfully",
            plant_id: req.params.id,
            qr_value: qr.qrValue,
            public_url: qr.publicUrl,
            qr_code: qr.qrCode
        });
    } catch (error) {
        if (error instanceof QrConfigurationError) return res.status(503).json({ message: "Public QR URL is not configured" });
        console.error("Plant QR generation error:", error);
        return res.status(500).json({ message: "Failed to generate QR code" });
    }
});

// Return a QR image for a plant owned by the signed-in botanist.
router.get("/:id/qr/image", requireRole("botanist"), async (req, res) => {
    const qrValue = await findOwnedPlantQrTag(req, res);
    if (!qrValue) return;

    try {
        const qr = await generatePlantQR(qrValue);
        const base64Data = qr.qrCode.replace(/^data:image\/png;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, "base64");

        res.setHeader("Content-Type", "image/png");
        return res.send(imageBuffer);
    } catch (error) {
        if (error instanceof QrConfigurationError) return res.status(503).json({ message: "Public QR URL is not configured" });
        console.error("Plant QR image error:", error);
        return res.status(500).json({ message: "Failed to generate QR image" });
    }
});

function reservationFailure(res, error) {
    if (error.code === '42501') return res.status(403).json({ message: 'Plant or tag is unavailable' });
    if (['23505', 'P0001'].includes(error.code)) return res.status(409).json({ message: 'Tag binding conflict' });
    return res.status(503).json({ message: 'Tag reservation service unavailable; retry the same plant' });
}

// ── 1-CLICK / AUTOMATIC TAG & QR GENERATION ────────────────────
router.post("/:id/attach-tag", requireRole("botanist", "officer"), async (req, res) => {
    const plantId = req.params.id;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(plantId)) {
        return res.status(400).json({ message: "Valid plant ID is required" });
    }

    // 1. Verify caller owns this plant record or is an officer
    if (!(await checkPlantWriteAccess(req, res, plantId))) return;

    try {
        // 2. Fetch current plant to see if it already has a valid tag
        const { data: plant, error: fetchError } = await req.supabase
            .from("plants")
            .select("id, qr_code_value")
            .eq("id", plantId)
            .maybeSingle();

        if (fetchError || !plant) {
            return res.status(404).json({ message: "Plant record not found" });
        }

        let tagCode = plant.qr_code_value;

        // Validate the destination before allocating a persistent label.
        buildPublicPlantUrl('NIAH-PLT-00001');
        if (!tagCode || !TAG_PATTERN.test(tagCode)) {
            if (req.profile.role !== 'botanist') {
                return res.status(403).json({ message: 'Only the botanist owner may reserve and bind a tag' });
            }
            // Plant UUID is a stable request ID: retries reuse the same reservation.
            const { data: reserved, error: reserveError } = await req.supabase.rpc('reserve_plant_tags', {
                p_count: 1, p_request_id: plantId,
            });
            if (reserveError) return reservationFailure(res, reserveError);
            const tag = Array.isArray(reserved) && reserved.length === 1 ? reserved[0].qr_code_value : null;
            if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
                return res.status(503).json({ message: 'Could not confirm reserved tag; retry the same plant' });
            }
            const { data: attached, error: attachError } = await req.supabase.rpc('attach_reserved_plant_tag', {
                p_plant_id: plantId, p_tag: tag,
            });
            if (attachError) return reservationFailure(res, attachError);
            if (typeof attached !== 'string' || attached.toLowerCase() !== plantId.toLowerCase()) {
                return res.status(503).json({ message: 'Could not confirm tag binding; retry the same plant' });
            }
            tagCode = tag;
        }

        // 5. Generate QR code payload
        const qrResult = await generatePlantQR(tagCode);

        return res.status(200).json({
            tag_code: tagCode,
            qr_code: qrResult.qrCode, // base64 data URL
            public_url: qrResult.publicUrl,
        });
    } catch (error) {
        if (error instanceof QrConfigurationError) {
            return res.status(503).json({ message: "Public QR URL is not configured on server" });
        }
        console.error("Auto attach-tag error:", error);
        return res.status(500).json({ message: "Could not generate plant tag" });
    }
});

module.exports = router;
