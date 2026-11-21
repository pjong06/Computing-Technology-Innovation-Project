"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mockAuth, callRoute } = require("./helpers/routeTestKit");

let role = "officer";
let db;
mockAuth(() => ({ userId: "11111111-1111-4111-8111-111111111111", role, db }));

const { createOfficerOverviewRouter } = require("../src/routes/officerOverview");
const fixedNow = new Date("2026-11-21T12:00:00.000Z");
const router = createOfficerOverviewRouter({ now: () => fixedNow });

function fakeDb(tables = {}, failTable = null) {
    const calls = [];
    return {
        calls,
        from(table) {
            const query = {
                filters: [],
                orders: [],
                limitValue: null,
                rangeValue: null,
                head: false,
                select(columns, options = {}) {
                    calls.push([table, "select", columns, options]);
                    this.head = options.head === true;
                    return this;
                },
            };
            for (const method of ["eq", "is", "in", "gte", "lt", "gt", "lte", "order", "limit", "range"]) {
                query[method] = (...args) => {
                    calls.push([table, method, ...args]);
                    if (method === "order") query.orders.push(args);
                    else if (method === "limit") query.limitValue = args[0];
                    else if (method === "range") query.rangeValue = args;
                    else query.filters.push([method, ...args]);
                    return query;
                };
            }
            query.then = (resolve, reject) => {
                if (table === failTable) {
                    return Promise.resolve({ data: null, count: null, error: new Error("database failure") })
                        .then(resolve, reject);
                }
                let rows = [...(tables[table] || [])].filter(row => query.filters.every(([method, column, value]) => {
                    if (method === "eq") return row[column] === value;
                    if (method === "is") return row[column] === value;
                    if (method === "in") return value.includes(row[column]);
                    if (method === "gte") return row[column] >= value;
                    if (method === "lt") return row[column] < value;
                    if (method === "gt") return row[column] > value;
                    if (method === "lte") return row[column] <= value;
                    return true;
                }));
                const count = rows.length;
                for (const [column, options] of [...query.orders].reverse()) {
                    rows.sort((a, b) => {
                        const comparison = String(a[column]).localeCompare(String(b[column]));
                        return options?.ascending === false ? -comparison : comparison;
                    });
                }
                if (query.rangeValue) rows = rows.slice(query.rangeValue[0], query.rangeValue[1] + 1);
                if (query.limitValue !== null) rows = rows.slice(0, query.limitValue);
                return Promise.resolve({
                    data: query.head ? null : rows,
                    count: query.head ? count : undefined,
                    error: null,
                }).then(resolve, reject);
            };
            return query;
        },
    };
}

function fixture() {
    return {
        species: [
            { id: "sp-cr", verification_status: "approved", conservation_status: "CR", created_at: "2026-11-05T00:00:00Z" },
            { id: "sp-en", verification_status: "approved", conservation_status: "EN", created_at: "2026-10-05T00:00:00Z" },
            { id: "sp-vu", verification_status: "approved", conservation_status: "VU", created_at: "2026-11-20T00:00:00Z" },
            { id: "sp-na", verification_status: "approved", conservation_status: null },
            { id: "sp-pending", verification_status: "pending", conservation_status: "CR", created_at: "2026-11-20T00:00:00Z" },
        ],
        plants: [
            { id: "p1", deleted_at: null, registered_at: "2026-11-02T00:00:00Z" },
            { id: "p2", deleted_at: null, registered_at: "2026-09-02T00:00:00Z" },
            { id: "p3", deleted_at: "2026-11-01T00:00:00Z", registered_at: "2026-11-01T00:00:00Z" },
        ],
        observations: [
            { id: "o1", deleted_at: null, review_status: "pending", observed_at: "2026-11-03T10:00:00Z" },
            { id: "o2", deleted_at: null, review_status: "approved", observed_at: "2026-10-03T10:00:00Z" },
            { id: "o3", deleted_at: "2026-11-04T10:00:00Z", review_status: "pending", observed_at: "2026-11-04T10:00:00Z" },
            { id: "o4", deleted_at: null, review_status: "approved", observed_at: "2026-06-03T10:00:00Z" },
        ],
        sensor_stations: [
            { id: "s1", station_status: "active", station_code: "NIAH-ST-01" },
            { id: "s2", station_status: "active", station_code: "NIAH-ST-02" },
            { id: "s3", station_status: "inactive", station_code: "NIAH-ST-03" },
        ],
        sensor_readings: [
            { station_id: "s1", received_at: "2026-11-21T11:59:30.000Z" },
            { station_id: "s1", received_at: "2026-11-21T11:59:45.000Z" },
            { station_id: "s2", received_at: "2026-11-21T11:57:00.000Z" },
            { station_id: "s3", received_at: "2026-11-21T11:59:45.000Z" },
        ],
        alerts: [
            { id: "a1", alert_status: "open", triggered_at: "2026-11-20T11:00:00Z", alert_message: "Movement detected", station_id: "s1", severity: "high" },
            { id: "a2", alert_status: "acknowledged", triggered_at: "2026-11-20T12:00:00Z", alert_message: "Rain threshold", station_id: "s2", severity: "warning" },
            { id: "a3", alert_status: "resolved", triggered_at: "2026-11-21T10:00:00Z", alert_message: "Latest alert", station_id: "s3", severity: "critical" },
        ],
    };
}

test("only conservation officers can read overview data", async () => {
    for (const deniedRole of ["botanist", "researcher", "admin"]) {
        role = deniedRole;
        db = fakeDb(fixture());
        const result = await callRoute("/api/officer/overview", router);
        assert.equal(result.status, 403, deniedRole);
        assert.deepEqual(db.calls, [], "database is not queried for a denied role");
    }
    role = "officer";
});

test("overview returns real counts, six active-observation months, and database IoT state", async () => {
    role = "officer";
    db = fakeDb(fixture());
    const result = await callRoute("/api/officer/overview", router);

    assert.equal(result.status, 200);
    assert.deepEqual({
        approved: result.body.data.approved_species_count,
        threatened: result.body.data.threatened_species_count,
        fieldRecords: result.body.data.pending_field_record_count,
        speciesRequests: result.body.data.pending_species_request_count,
        waiting: result.body.data.waiting_review_count,
        plants: result.body.data.active_plant_count,
    }, { approved: 4, threatened: 2, fieldRecords: 1, speciesRequests: 1, waiting: 2, plants: 2 });
    // "+N this month" from real dates: approved species created, active plants registered.
    assert.equal(result.body.data.approved_species_this_month, 2);
    assert.equal(result.body.data.active_plants_this_month, 1);
    assert.deepEqual(result.body.data.species_by_status.map(status => status.count), [1, 1, 1, 0, 0, 0, 1]);
    assert.deepEqual(result.body.data.monthly_observations, [
        { month: "2026-06", count: 1 },
        { month: "2026-07", count: 0 },
        { month: "2026-08", count: 0 },
        { month: "2026-09", count: 0 },
        { month: "2026-10", count: 1 },
        { month: "2026-11", count: 1 },
    ]);
    assert.deepEqual(result.body.data.iot, {
        online_stations: 1,
        total_stations: 3,
        open_alerts: 2,
        // The newest alert of any status, with its station and severity (both are alerts columns).
        latest_alert: {
            id: "a3",
            station_id: "s3",
            alert_message: "Latest alert",
            severity: "critical",
            station_code: "NIAH-ST-03",
            alert_status: "resolved",
            triggered_at: "2026-11-21T10:00:00Z",
        },
    });
    assert.ok(db.calls.some(([table, method, column, value]) =>
        table === "species" && method === "in" && column === "conservation_status" &&
        value.join(",") === "CR,EN"));
    assert.ok(db.calls.some(([table, method, column]) =>
        table === "observations" && method === "is" && column === "deleted_at"));
    assert.ok(db.calls.every(call => call[0] !== "plant_map_points"), "overview does not query plant coordinates");
});

test("overview reports database query failures instead of returning empty counts", async () => {
    role = "officer";
    db = fakeDb(fixture(), "species");
    const result = await callRoute("/api/officer/overview", router);
    assert.equal(result.status, 500);
    assert.equal(result.body.message, "Could not load the officer overview");
});
