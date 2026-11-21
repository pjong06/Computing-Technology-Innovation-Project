"use strict";

// plantDetails.js - the "This plant" details of APPROVED plants for staff (botanists and
// officers): location (latitude, longitude, accuracy), location note, morphology, notes, and
// the latest approved observation's height (m), diameter (cm), health, life stage and date.
// Team decision: staff may see full details, including coordinates, of approved plants;
// visitors never see these (the public endpoints don't use this); other botanists' pending
// or rejected plants are never sent.
//
// Batched for a page of plants (never one query per plant):
//   1. plant_map_points (the existing view): latitude and longitude, one query;
//   2. observations: the approved, active observations of these plants, newest first, paged.
// Each measurement comes from the newest approved observation that has it (a later visit
// may have recorded only some fields). Reads through the caller's own client, so RLS still
// decides what is visible. Never throws: on an error the plants just get no details.

const PAGE = 1000;
const STAFF_WITH_COORDINATES = new Set(["botanist", "officer"]);

const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const number = (value) => {
    const parsed = typeof value === "string" ? Number(value) : value;
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

async function readObservations(supabase, plantIds) {
    const rows = [];
    for (let start = 0; ; start += PAGE) {
        const { data, error } = await supabase
            .from("observations")
            .select("plant_id, observed_at, height_cm, diameter_cm, health_status, life_stage")
            .in("plant_id", plantIds)
            .eq("review_status", "approved")
            .is("deleted_at", null)
            .order("observed_at", { ascending: false })
            .range(start, start + PAGE - 1);
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE) return rows;
    }
}

// The newest non-empty value of a field across observations sorted newest first.
function newestValue(visits, pick) {
    for (const visit of visits) {
        const value = pick(visit);
        if (value !== null && value !== undefined) return value;
    }
    return null;
}

// The latest approved observation's values (newest value per field), or null.
function latestObservation(visits) {
    if (!visits.length) return null;
    const newest = [...visits].sort((a, b) => String(b.observed_at ?? "").localeCompare(String(a.observed_at ?? "")));
    const heightCm = newestValue(newest, visit => number(visit.height_cm));
    const diameterCm = newestValue(newest, visit => number(visit.diameter_cm));
    return {
        observed_at: newest[0].observed_at ?? null,
        // Stored in cm; height is sent in metres (2 decimals), diameter in cm.
        height_m: heightCm === null ? null : Math.round(heightCm) / 100,
        diameter_cm: diameterCm === null ? null : Math.round(diameterCm * 100) / 100,
        health_status: newestValue(newest, visit => text(visit.health_status)),
        life_stage: newestValue(newest, visit => text(visit.life_stage)),
    };
}

async function readPoints(supabase, ids) {
    const { data, error } = await supabase.from("plant_map_points").select("id, latitude, longitude").in("id", ids);
    if (error) throw error;
    return data || [];
}

// plants: rows with id, plant_status, location_description, morphology, description,
// gps_accuracy_m. Returns Map plant id -> details, for approved plants only. Coordinates
// only for botanists and officers.
async function approvedPlantDetails(supabase, plants, role) {
    const result = new Map();
    const approved = (plants || []).filter(plant => plant?.id && plant.plant_status === "approved");
    if (approved.length === 0) return result;
    const ids = approved.map(plant => plant.id);
    const withCoordinates = STAFF_WITH_COORDINATES.has(role);
    try {
        const [points, visits] = await Promise.all([
            withCoordinates ? readPoints(supabase, ids) : [],
            readObservations(supabase, ids),
        ]);
        const pointById = new Map(points.map(point => [point.id, point]));
        const visitsByPlant = new Map();
        for (const visit of visits) {
            const list = visitsByPlant.get(visit.plant_id) ?? [];
            list.push(visit);
            visitsByPlant.set(visit.plant_id, list);
        }
        for (const plant of approved) {
            const point = pointById.get(plant.id);
            const latitude = number(point?.latitude);
            const longitude = number(point?.longitude);
            const located = withCoordinates && latitude !== null && longitude !== null;
            result.set(plant.id, {
                latitude: located ? latitude : null,
                longitude: located ? longitude : null,
                gps_accuracy_m: located ? number(plant.gps_accuracy_m) : null,
                location_note: text(plant.location_description),
                morphology: text(plant.morphology),
                notes: text(plant.description),
                latest_observation: latestObservation(visitsByPlant.get(plant.id) ?? []),
            });
        }
    } catch (error) {
        console.error("Plant details error:", error?.message || error);
        return new Map();
    }
    return result;
}

module.exports = { approvedPlantDetails, latestObservation };
