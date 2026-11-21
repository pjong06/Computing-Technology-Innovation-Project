"use strict";

// plantThumbnails.js - thumbnails for a botanist's OWN plants in list responses, so the app
// can show them without opening each plant.
//
// For one page of plants this makes a fixed number of calls, whatever the page size:
//   1. plant_media: the plants' photos (the main one wins, else the first);
//   2. for plants without one: their observations, then observation_media: the main photo
//      of the first APPROVED observation (the same rule as the public copy,
//      publicPlantPhotos.publicPhotoSource), else of the first observation (these are the
//      botanist's own plants, so their own photos waiting for review may be shown to them);
//   3. one createSignedUrls per bucket.
// Everything is read through the caller's own client, so RLS decides what is visible: no new
// permissions. The response carries a short-lived signed link, an opaque cache key (the media
// row id, so the app can keep the image) and when the link expires: never a file path.
// Never throws: on any error the plants simply get no thumbnail.

const THUMBNAIL_URL_TTL_SECONDS = 3600;

function pickPhoto(current, photo) {
    if (!current) return photo;
    if (photo.is_primary && !current.is_primary) return photo;
    if (Boolean(photo.is_primary) === Boolean(current.is_primary) && String(photo.id) < String(current.id)) return photo;
    return current;
}

async function signAll(supabase, bucket, chosen) {
    const paths = [...new Set([...chosen.values()].map(photo => photo.file_path))];
    if (paths.length === 0) return new Map();
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, THUMBNAIL_URL_TTL_SECONDS);
    if (error) throw error;
    return new Map((data || []).filter(item => item && item.signedUrl).map(item => [item.path, item.signedUrl]));
}

// plants: rows with an id. Returns Map plant id -> { url, key, expires_at }.
async function ownPlantThumbnails(supabase, plants, { now = Date.now() } = {}) {
    const result = new Map();
    const plantIds = [...new Set((plants || []).map(plant => plant && plant.id).filter(Boolean))];
    if (plantIds.length === 0) return result;
    try {
        // 1. The plant's own photos.
        const { data: media, error: mediaError } = await supabase
            .from("plant_media")
            .select("id, plant_id, file_path, is_primary")
            .in("plant_id", plantIds)
            .is("deleted_at", null);
        if (mediaError) throw mediaError;
        const plantPhoto = new Map();
        for (const photo of media || []) {
            if (!photo || !photo.file_path) continue;
            plantPhoto.set(photo.plant_id, pickPhoto(plantPhoto.get(photo.plant_id), photo));
        }

        // 2. Plants without one: the photo of their first observation.
        const missing = plantIds.filter(id => !plantPhoto.has(id));
        const observationPhoto = new Map();
        if (missing.length > 0) {
            const { data: visits, error: visitError } = await supabase
                .from("observations")
                .select("id, plant_id, observed_at, review_status")
                .in("plant_id", missing)
                .is("deleted_at", null);
            if (visitError) throw visitError;
            // Earliest approved observation first; plants with none: their earliest observation.
            const earlier = (a, b) => String(a.observed_at) < String(b.observed_at) ||
                (String(a.observed_at) === String(b.observed_at) && String(a.id) < String(b.id));
            const firstVisit = new Map();
            for (const visit of visits || []) {
                const current = firstVisit.get(visit.plant_id);
                const approved = visit.review_status === "approved";
                const currentApproved = current && current.review_status === "approved";
                if (!current || (approved && !currentApproved) || (approved === currentApproved && earlier(visit, current))) {
                    firstVisit.set(visit.plant_id, visit);
                }
            }
            const plantByVisit = new Map([...firstVisit.values()].map(visit => [visit.id, visit.plant_id]));
            if (plantByVisit.size > 0) {
                const { data: visitMedia, error: visitMediaError } = await supabase
                    .from("observation_media")
                    .select("id, observation_id, file_path, is_primary")
                    .in("observation_id", [...plantByVisit.keys()]);
                if (visitMediaError) throw visitMediaError;
                for (const photo of visitMedia || []) {
                    if (!photo || !photo.file_path) continue;
                    const plantId = plantByVisit.get(photo.observation_id);
                    observationPhoto.set(plantId, pickPhoto(observationPhoto.get(plantId), photo));
                }
            }
        }

        // 3. One signing call per bucket.
        const [plantUrls, observationUrls] = await Promise.all([
            signAll(supabase, "plant-media", plantPhoto),
            signAll(supabase, "observation-media", observationPhoto),
        ]);
        const expiresAt = new Date(now + THUMBNAIL_URL_TTL_SECONDS * 1000).toISOString();
        for (const [plantId, photo] of plantPhoto) {
            const url = plantUrls.get(photo.file_path);
            if (url) result.set(plantId, { url, key: `plant-media-${photo.id}`, expires_at: expiresAt });
        }
        for (const [plantId, photo] of observationPhoto) {
            const url = observationUrls.get(photo.file_path);
            if (url) result.set(plantId, { url, key: `observation-media-${photo.id}`, expires_at: expiresAt });
        }
    } catch (error) {
        console.error("Plant thumbnail error:", error?.message || error);
        return new Map();
    }
    return result;
}

module.exports = { ownPlantThumbnails, THUMBNAIL_URL_TTL_SECONDS };
