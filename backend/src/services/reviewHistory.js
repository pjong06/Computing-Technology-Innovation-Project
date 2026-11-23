"use strict";

// reviewHistory.js - every review decision, for the officer's Review history page
// (GET /api/officer/reviews/history):
//   - field records (observation_reviews): Approved / Sent back, typed NEW PLANT (the plant's
//     first record) or OBSERVATION;
//   - species requests (species rows a botanist proposed): Added / Not added. Who decided and
//     when is recorded from 20261122120000_species_review_decider.sql on; older decisions use
//     the species row's updated_at and have no officer.
// Loaded in batched queries (lists of ids in groups of 100), never one query per row, then
// filtered, counted, sorted and paged here. Reads through the officer's own client.

const { isLiveObservation } = require("./liveObservations");

const MAX_DECISIONS = 5000;
const PAGE = 1000;
const ID_BATCH = 100;

const DECISIONS = {
    approved: "Approved",
    sent_back: "Sent back",
    added: "Added",
    not_added: "Not added",
};
const TYPES = {
    new_plant: "NEW PLANT",
    observation: "OBSERVATION",
    species_request: "SPECIES REQUEST",
};
// The Type filter: one type, or both field record types together.
const TYPE_FILTERS = ["field_record", "new_plant", "observation", "species_request"];
const SORTS = ["newest", "oldest"];

const missingColumn = (error, name) => Boolean(error) && ["42703", "PGRST204"].includes(error.code) &&
    String(error.message || "").includes(name);

async function readPaged(build) {
    const rows = [];
    for (let start = 0; start < MAX_DECISIONS; start += PAGE) {
        const { data, error } = await build().range(start, start + PAGE - 1);
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE) break;
    }
    return rows;
}

async function rowsByIds(supabase, table, columns, ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    const rows = [];
    for (let index = 0; index < unique.length; index += ID_BATCH) {
        const { data, error } = await supabase.from(table).select(columns).in("id", unique.slice(index, index + ID_BATCH));
        if (error) throw error;
        rows.push(...(data || []));
    }
    return rows;
}

const byId = (rows) => new Map(rows.map(row => [row.id, row]));

// Decided species requests, with who decided and when when that is recorded.
async function readSpeciesDecisions(supabase) {
    const run = (withDecider) => readPaged(() => supabase
        .from("species")
        .select(`id, scientific_name, proposed_by, verification_status, review_comment, updated_at${withDecider ? ", reviewed_by, reviewed_at" : ""}`)
        .not("proposed_by", "is", null)
        .in("verification_status", ["approved", "rejected", "archived"])
        .order("id"));
    try {
        return await run(true);
    } catch (error) {
        if (missingColumn(error, "reviewed_")) return run(false);
        throw error;
    }
}

// All decisions as rows (newest first). firstRecordsOf(supabase, plantIds) -> Map plant id ->
// first record, to tell a NEW PLANT record from an OBSERVATION.
async function loadDecisions(supabase, firstRecordsOf) {
    const [reviews, requests] = await Promise.all([
        readPaged(() => supabase
            .from("observation_reviews")
            .select("id, observation_id, reviewer_id, decision, comments, reviewed_at")
            .in("decision", ["approved", "rejected"])
            .order("reviewed_at", { ascending: false })),
        readSpeciesDecisions(supabase),
    ]);

    const observations = await rowsByIds(supabase, "observations", "id, plant_id, observer_id, deleted_at", reviews.map(r => r.observation_id));
    const observationById = byId(observations);
    const plants = await rowsByIds(supabase, "plants", "id, species_id, qr_code_value, deleted_at", observations.map(o => o.plant_id));
    const plantById = byId(plants);
    // Decisions on a deleted observation, or on one whose plant was deleted, are left out
    // (the same rule as Review > Field records: services/liveObservations.js).
    const deletedPlants = new Set(plants.filter(p => p.deleted_at).map(p => p.id));
    const liveReviews = reviews.filter(review => {
        const observation = observationById.get(review.observation_id);
        return !observation || isLiveObservation(observation, deletedPlants);
    });
    const [species, firsts, people] = await Promise.all([
        rowsByIds(supabase, "species", "id, scientific_name", plants.map(p => p.species_id)),
        firstRecordsOf(supabase, [...new Set(observations.map(o => o.plant_id).filter(Boolean))]),
        rowsByIds(supabase, "profiles", "id, full_name", [
            ...reviews.map(r => r.reviewer_id), ...observations.map(o => o.observer_id),
            ...requests.map(s => s.proposed_by), ...requests.map(s => s.reviewed_by),
        ]),
    ]);
    const speciesById = byId(species);
    const peopleById = byId(people);
    const name = (id) => (id ? peopleById.get(id)?.full_name || "Unknown" : null);

    const fieldRows = liveReviews.map(review => {
        const observation = observationById.get(review.observation_id);
        const plant = observation ? plantById.get(observation.plant_id) : null;
        const first = plant ? firsts.get(plant.id) : null;
        return {
            id: `review:${review.id}`,
            kind: first && first.id === review.observation_id ? "new_plant" : "observation",
            decision: review.decision === "approved" ? "approved" : "sent_back",
            decided_at: review.reviewed_at || null,
            decided_by_id: review.reviewer_id || null,
            decided_by: name(review.reviewer_id),
            reason: review.comments?.trim() || null,
            scientific_name: plant ? speciesById.get(plant.species_id)?.scientific_name || null : null,
            tag: plant?.qr_code_value || null,
            botanist: name(observation?.observer_id),
            plant_id: plant?.id || null,
            observation_id: review.observation_id,
            species_id: null,
        };
    });
    const requestRows = requests.map(request => ({
        id: `species:${request.id}`,
        kind: "species_request",
        decision: request.verification_status === "rejected" ? "not_added" : "added",
        decided_at: request.reviewed_at || request.updated_at || null,
        decided_by_id: request.reviewed_by || null,
        decided_by: name(request.reviewed_by),
        reason: request.review_comment?.trim() || null,
        scientific_name: request.scientific_name || null,
        tag: null,
        botanist: name(request.proposed_by),
        plant_id: null,
        observation_id: null,
        species_id: request.id,
    }));
    return [...fieldRows, ...requestRows];
}

// ---- filtering, counting, sorting (pure) ----

function inDateRange(row, from, to) {
    const time = row.decided_at ? String(row.decided_at) : "";
    if (from && (!time || time < `${from}T00:00:00.000Z`)) return false;
    if (to && (!time || time > `${to}T23:59:59.999Z`)) return false;
    return true;
}

function matchesType(row, type) {
    if (!type) return true;
    if (type === "field_record") return row.kind === "new_plant" || row.kind === "observation";
    return row.kind === type;
}

function matchesSearch(row, q) {
    if (!q) return true;
    const needle = q.toLowerCase();
    return [row.scientific_name, row.tag, row.botanist].some(value => String(value ?? "").toLowerCase().includes(needle));
}

// Applies the filters. counts: how many rows each decision has with every other filter
// applied (for the Decision chips); total: rows after all filters.
function filterHistory(rows, { type, decision, officer, q, from, to, sort } = {}) {
    const base = rows.filter(row => matchesType(row, type) && (!officer || row.decided_by_id === officer) &&
        matchesSearch(row, q) && inDateRange(row, from, to));
    const counts = { all: base.length };
    for (const key of Object.keys(DECISIONS)) counts[key] = base.filter(row => row.decision === key).length;
    const filtered = decision ? base.filter(row => row.decision === decision) : base;
    const direction = sort === "oldest" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) =>
        direction * String(a.decided_at ?? "").localeCompare(String(b.decided_at ?? "")) || a.id.localeCompare(b.id));
    return { rows: sorted, counts };
}

// The officers who made any decision (for the Officer filter), A–Z.
function officersOf(rows) {
    const names = new Map();
    for (const row of rows) if (row.decided_by_id) names.set(row.decided_by_id, row.decided_by || "Unknown");
    return [...names].map(([id, nameText]) => ({ id, name: nameText })).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { loadDecisions, filterHistory, officersOf, DECISIONS, TYPES, TYPE_FILTERS, SORTS };
