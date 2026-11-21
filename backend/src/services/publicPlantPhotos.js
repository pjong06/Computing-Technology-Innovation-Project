"use strict";

// publicPlantPhotos.js - the photo visitors see for a plant on its public QR page.
//
// Plant photos are staff-only (plant_media and the private 'plant-media' bucket), and the
// backend has only the publishable key. So visitors never read the originals: when an
// officer's action makes a plant publicly visible (or changes it), the backend - acting as
// that officer - writes a stripped copy (at most 1200 px JPEG, no metadata) of the plant's
// main photo to the 'public-plant-photos' bucket, named "<tag>.jpg", and removes it when
// the plant stops being public. Visitors get it through GET /p/:tag/photo, which checks the
// plant is still public and re-encodes the copy again before sending it.
// Migration: supabase/migrations/20261121150000_public_plant_photos.sql.

const { stripPhotoMetadata } = require("./photoSanitizer");
const { TAG_PATTERN } = require("./qrService");

const PUBLIC_PHOTO_BUCKET = "public-plant-photos";
const PUBLIC_PHOTO_MAX_SIDE = 1200;
// List thumbnails (GET /p/:tag/photo?size=thumb): small, to keep storage egress down.
const PUBLIC_THUMBNAIL_MAX_SIDE = 300;
const MAX_PUBLIC_PHOTO_BYTES = 5 * 1024 * 1024;

// "<tag>.jpg" for a real plant tag, or null (plants without a physical tag are never public).
function publicPhotoPath(tag) {
    return typeof tag === "string" && TAG_PATTERN.test(tag) ? `${tag}.jpg` : null;
}

// Is this tag on the public QR page right now? Same rule as the page itself.
async function isPubliclyVisible(supabase, tag) {
    const { data, error } = await supabase.rpc("public_plant_by_qr_v2", { p_qr: tag });
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
}

async function removePublicPlantPhotoByTag(supabase, tag) {
    const path = publicPhotoPath(tag);
    if (!path) return "skipped";
    const { error } = await supabase.storage.from(PUBLIC_PHOTO_BUCKET).remove([path]);
    if (error) throw error;
    return "removed";
}

// Brings the public copy of one plant's main photo in line with the plant, using the
// signed-in officer's client (officers may read plant photos and manage the public copies).
// Returns "published", "removed" or "skipped". Never throws: a failure is logged, and the
// officer's own action has already succeeded.
async function refreshPublicPlantPhoto(supabase, plantId) {
    try {
        const { data: plant, error: plantError } = await supabase
            .from("plants")
            .select("id, qr_code_value")
            .eq("id", plantId)
            .maybeSingle();
        if (plantError) throw plantError;
        const path = publicPhotoPath(plant?.qr_code_value);
        if (!path) return "skipped";

        if (!(await isPubliclyVisible(supabase, plant.qr_code_value))) {
            return await removePublicPlantPhotoByTag(supabase, plant.qr_code_value);
        }

        const { data: media, error: mediaError } = await supabase
            .from("plant_media")
            .select("id, file_path")
            .eq("plant_id", plantId)
            .eq("is_primary", true)
            .is("deleted_at", null)
            .order("id")
            .limit(1);
        if (mediaError) throw mediaError;
        const filePath = Array.isArray(media) && media[0]?.file_path;
        if (!filePath) return await removePublicPlantPhotoByTag(supabase, plant.qr_code_value);

        const { data: file, error: downloadError } = await supabase.storage
            .from("plant-media")
            .download(filePath);
        if (downloadError || !file) throw downloadError || new Error("Plant photo could not be read");
        if (file.size > 25 * 1024 * 1024) throw new Error("Plant photo is too large");

        const copy = await stripPhotoMetadata(Buffer.from(await file.arrayBuffer()), {
            maxSide: PUBLIC_PHOTO_MAX_SIDE,
            quality: 82,
        });
        const { error: uploadError } = await supabase.storage
            .from(PUBLIC_PHOTO_BUCKET)
            .upload(path, copy, { contentType: "image/jpeg", upsert: true });
        if (uploadError) throw uploadError;
        return "published";
    } catch (error) {
        console.error("Public plant photo refresh failed:", { plantId, message: error?.message });
        return "skipped";
    }
}

// The public photo for a tag, ready to send: re-encoded again (at most 1200 px, no
// metadata) so whatever is in the bucket, visitors only ever get clean pixels. null when
// there is none. The caller must have checked the plant is public. maxSide: a smaller size
// for list thumbnails (PUBLIC_THUMBNAIL_MAX_SIDE).
async function readPublicPlantPhoto(database, tag, { maxSide = PUBLIC_PHOTO_MAX_SIDE } = {}) {
    const path = publicPhotoPath(tag);
    if (!path) return null;
    const { data: file, error } = await database.storage.from(PUBLIC_PHOTO_BUCKET).download(path);
    if (error || !file || file.size > MAX_PUBLIC_PHOTO_BYTES) return null;
    try {
        return await stripPhotoMetadata(Buffer.from(await file.arrayBuffer()), {
            maxSide: Math.min(maxSide, PUBLIC_PHOTO_MAX_SIDE),
            quality: maxSide < PUBLIC_PHOTO_MAX_SIDE ? 78 : 82,
        });
    } catch {
        return null;
    }
}

// Whether a public copy exists for this tag (for photo_url in the public QR API).
async function publicPlantPhotoExists(database, tag) {
    const path = publicPhotoPath(tag);
    if (!path) return false;
    try {
        const { data, error } = await database.storage
            .from(PUBLIC_PHOTO_BUCKET)
            .list("", { search: path, limit: 5 });
        return !error && Array.isArray(data) && data.some(item => item?.name === path);
    } catch {
        return false;
    }
}

// photo_url for staff lists and lookups: for each plant that is on the public QR page (the
// same check as the visitor page, public_plant_by_qr_v2) and has a public photo copy, the
// visitor photo address "/p/<tag>/photo". Map plant id -> url; plants without one are left
// out. Reads only the public copies bucket and the public QR function, with the caller's
// client: no storage paths, no signed links, no new permissions. Never throws.
async function publicPhotoUrlsFor(database, plants) {
    const urls = new Map();
    try {
        const candidates = (plants || []).filter(plant =>
            plant && plant.id && plant.plant_status === "approved" && publicPhotoPath(plant.qr_code_value));
        if (candidates.length === 0) return urls;

        // Which copies exist: one listing of the bucket (paged).
        const copies = new Set();
        const bucket = database.storage.from(PUBLIC_PHOTO_BUCKET);
        for (let offset = 0; ; offset += 1000) {
            const { data, error } = await bucket.list("", { limit: 1000, offset });
            if (error) throw error;
            for (const file of data || []) if (file?.name) copies.add(file.name);
            if (!data || data.length < 1000) break;
        }
        const withCopy = candidates.filter(plant => copies.has(publicPhotoPath(plant.qr_code_value)));

        // The visitor page's own rule, a few at a time.
        for (let start = 0; start < withCopy.length; start += 8) {
            const batch = withCopy.slice(start, start + 8);
            const visible = await Promise.all(batch.map(plant =>
                isPubliclyVisible(database, plant.qr_code_value).catch(() => false)));
            batch.forEach((plant, index) => {
                if (visible[index]) urls.set(plant.id, publicPhotoUrl(plant.qr_code_value));
            });
        }
    } catch (error) {
        console.error("Public photo address error:", error?.message || error);
    }
    return urls;
}

// The visitor-facing address of a plant's photo (served by GET /p/:tag/photo).
function publicPhotoUrl(tag) {
    return publicPhotoPath(tag) ? `/p/${tag}/photo` : null;
}

module.exports = {
    PUBLIC_PHOTO_BUCKET,
    PUBLIC_PHOTO_MAX_SIDE,
    PUBLIC_THUMBNAIL_MAX_SIDE,
    publicPhotoPath,
    publicPhotoUrl,
    refreshPublicPlantPhoto,
    removePublicPlantPhotoByTag,
    readPublicPlantPhoto,
    publicPlantPhotoExists,
    publicPhotoUrlsFor,
};
