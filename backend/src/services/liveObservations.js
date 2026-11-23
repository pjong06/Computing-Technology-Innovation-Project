"use strict";

// liveObservations.js - the one rule for what officers see as pending work: an observation
// counts only while it is not deleted (observations.deleted_at is null) AND its plant is not
// deleted (plants.deleted_at is null; a soft-deleted plant keeps its observations in the
// database). Used by Review > Field records, the Review count badges (report summary),
// Overview's "Waiting for review", Review history and the plant page.
//
// Standard filters only: the pending observations are read (a small set), then the deleted
// plants among their plant ids are looked up in batches of 100 ids, never one query per row.

const PAGE = 1000;
const MAX_ROWS = 20000;
const ID_BATCH = 100;

/** Whether a row (with deleted_at and plant_id) is live, given the deleted plant ids. */
function isLiveObservation(row, deletedPlantIds) {
    return Boolean(row) && !row.deleted_at && !(row.plant_id && deletedPlantIds.has(row.plant_id));
}

/** The soft-deleted plants among these plant ids (a Set). */
async function deletedPlantIdsAmong(supabase, plantIds) {
    const unique = [...new Set((plantIds || []).filter(Boolean))];
    const deleted = new Set();
    for (let index = 0; index < unique.length; index += ID_BATCH) {
        const { data, error } = await supabase
            .from("plants")
            .select("id, deleted_at")
            .in("id", unique.slice(index, index + ID_BATCH))
            .not("deleted_at", "is", null);
        if (error) throw error;
        for (const row of data || []) {
            if (row && row.id && row.deleted_at) deleted.add(row.id);
        }
    }
    return deleted;
}

/** Drops the rows of deleted observations and of observations whose plant is deleted. */
async function withoutDeletedPlants(supabase, rows) {
    const deleted = await deletedPlantIdsAmong(supabase, (rows || []).map((row) => row && row.plant_id));
    return (rows || []).filter((row) => isLiveObservation(row, deleted));
}

/**
 * Observations waiting for review, newest first, that officers should see: not deleted and
 * on a plant that isn't deleted. columns must include plant_id. limit (optional): at most
 * this many, after the deleted plants are left out (so the page is still full).
 */
async function livePendingObservations(supabase, columns, { limit } = {}) {
    const select = /\bplant_id\b/.test(columns) ? columns : `${columns}, plant_id`;
    const rows = [];
    for (let start = 0; start < MAX_ROWS; start += PAGE) {
        const { data, error } = await supabase
            .from("observations")
            .select(select)
            .eq("review_status", "pending")
            .is("deleted_at", null)
            .order("observed_at", { ascending: false })
            .range(start, start + PAGE - 1);
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE) break;
    }
    const live = await withoutDeletedPlants(supabase, rows);
    return limit === undefined ? live : live.slice(0, limit);
}

/** How many observations are waiting for review, by the same rule as the list. */
async function countLivePendingObservations(supabase) {
    return (await livePendingObservations(supabase, "id, plant_id")).length;
}

module.exports = {
    isLiveObservation,
    deletedPlantIdsAmong,
    withoutDeletedPlants,
    livePendingObservations,
    countLivePendingObservations,
};
