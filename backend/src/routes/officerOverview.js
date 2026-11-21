"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");

const STATUS_BUCKETS = [
    { code: "CR", label: "Critically Endangered" },
    { code: "EN", label: "Endangered" },
    { code: "VU", label: "Vulnerable" },
    { code: "NT", label: "Near Threatened" },
    { code: "LC", label: "Least Concern" },
    { code: "DD", label: "Data Deficient" },
    { code: null, label: "Not assessed" },
];
const PAGE_SIZE = 1000;

async function countRows(client, table, filters) {
    let query = client.from(table).select("id", { count: "exact", head: true });
    for (const [method, ...args] of filters) query = query[method](...args);
    const { count, error } = await query;
    if (error) throw error;
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error(`The ${table} count was unavailable`);
    }
    return count;
}

async function readAll(client, table, columns, configure = query => query) {
    const rows = [];
    for (let start = 0; ; start += PAGE_SIZE) {
        const { data, error } = await configure(client.from(table).select(columns))
            .order("id", { ascending: true })
            .range(start, start + PAGE_SIZE - 1);
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
    }
}

function monthRanges(now) {
    const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return Array.from({ length: 6 }, (_value, index) => {
        const start = new Date(Date.UTC(
            currentMonth.getUTCFullYear(),
            currentMonth.getUTCMonth() - 5 + index,
            1
        ));
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        return {
            month: start.toISOString().slice(0, 7),
            from: start.toISOString(),
            to: end.toISOString(),
        };
    });
}

function createOfficerOverviewRouter({ now = () => new Date() } = {}) {
    const overviewRouter = express.Router();
    overviewRouter.use(requireAuth, requireRole("officer"));
    overviewRouter.use((_req, res, next) => {
        res.set("Cache-Control", "no-store");
        next();
    });

    overviewRouter.get("/", async (req, res) => {
        const client = req.supabase;
        try {
            const approvedSpecies = [["eq", "verification_status", "approved"]];
            const activeObservations = [["is", "deleted_at", null]];
            const [approvedSpeciesCount, threatenedSpeciesCount, pendingFieldRecords,
                pendingSpeciesRequests, activePlants, statusCounts] = await Promise.all([
                countRows(client, "species", approvedSpecies),
                countRows(client, "species", [
                    ...approvedSpecies,
                    ["in", "conservation_status", ["CR", "EN"]],
                ]),
                countRows(client, "observations", [
                    ...activeObservations,
                    ["eq", "review_status", "pending"],
                ]),
                countRows(client, "species", [["eq", "verification_status", "pending"]]),
                countRows(client, "plants", [["is", "deleted_at", null]]),
                Promise.all(STATUS_BUCKETS.map(async status => ({
                    ...status,
                    count: await countRows(client, "species", [
                        ...approvedSpecies,
                        status.code === null
                            ? ["is", "conservation_status", null]
                            : ["eq", "conservation_status", status.code],
                    ]),
                }))),
            ]);

            const months = monthRanges(now());
            // "+N this month": counted from real dates (species created_at, plants registered_at).
            const thisMonth = months[months.length - 1];
            const [speciesThisMonth, plantsThisMonth] = await Promise.all([
                countRows(client, "species", [...approvedSpecies, ["gte", "created_at", thisMonth.from]]),
                countRows(client, "plants", [["is", "deleted_at", null], ["gte", "registered_at", thisMonth.from]]),
            ]);
            const monthlyObservations = await Promise.all(months.map(async range => ({
                month: range.month,
                count: await countRows(client, "observations", [
                    ...activeObservations,
                    ["gte", "observed_at", range.from],
                    ["lt", "observed_at", range.to],
                ]),
            })));

            const [stations, recentReadings, openAlerts, latestAlert] = await Promise.all([
                readAll(client, "sensor_stations", "id, station_status, station_code"),
                (async () => {
                    const cutoff = new Date(now().getTime() - 60_000).toISOString();
                    const { data, error } = await client
                        .from("sensor_readings")
                        .select("station_id, received_at")
                        .gte("received_at", cutoff);
                    if (error) throw error;
                    return data || [];
                })(),
                countRows(client, "alerts", [
                    ["in", "alert_status", ["open", "acknowledged"]],
                ]),
                (async () => {
                    const { data, error } = await client
                        .from("alerts")
                        .select("id, station_id, alert_message, severity, alert_status, triggered_at")
                        .order("triggered_at", { ascending: false })
                        .order("id", { ascending: false })
                        .limit(1);
                    if (error) throw error;
                    return data?.[0] || null;
                })(),
            ]);
            const activeStationIds = new Set(
                stations.filter(station => station.station_status === "active").map(station => station.id)
            );
            const onlineStationIds = new Set(
                recentReadings
                    .filter(reading => activeStationIds.has(reading.station_id))
                    .map(reading => reading.station_id)
            );

            // The latest alert with its station code (never the station's location).
            const stationCode = new Map(stations.map(station => [station.id, station.station_code || null]));
            const latest = latestAlert
                ? { ...latestAlert, station_code: stationCode.get(latestAlert.station_id) ?? null }
                : null;

            return res.json({
                data: {
                    approved_species_count: approvedSpeciesCount,
                    approved_species_this_month: speciesThisMonth,
                    active_plants_this_month: plantsThisMonth,
                    threatened_species_count: threatenedSpeciesCount,
                    pending_field_record_count: pendingFieldRecords,
                    pending_species_request_count: pendingSpeciesRequests,
                    waiting_review_count: pendingFieldRecords + pendingSpeciesRequests,
                    active_plant_count: activePlants,
                    species_by_status: statusCounts,
                    monthly_observations: monthlyObservations,
                    iot: {
                        online_stations: onlineStationIds.size,
                        total_stations: stations.length,
                        open_alerts: openAlerts,
                        latest_alert: latest,
                    },
                },
            });
        } catch (error) {
            console.error("Officer overview query error:", error);
            return res.status(500).json({ message: "Could not load the officer overview" });
        }
    });

    return overviewRouter;
}

module.exports = createOfficerOverviewRouter();
module.exports.createOfficerOverviewRouter = createOfficerOverviewRouter;
