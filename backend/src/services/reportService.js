// reportService.js - the officer reports (Overview page "Report" card, CSV and PDF exports).
//
// Tabs: inventory (Species inventory), plants (Plant records), botanist (Field observations),
// alerts (IoT alerts). Each takes the same options, so the table on screen and both exports
// contain exactly the same rows:
//   from / to  - "First recorded" date range (YYYY-MM-DD, inclusive)
//   status     - one of the tab's status values (statusOptions)
//   q          - search text (matches any shown column)
//   sort       - one of the tab's sort values (sortOptions)
// No report contains coordinates (except the older "locations" type, kept for the existing
// endpoint; the PDF never prints coordinates).

const MAX_REPORT_ROWS = 1000;
const REPORT_PAGE_SIZE = 1000;
const TIME_ZONE = "Asia/Kuching";

class ReportError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.status = status;
    }
}

function applyDateRange(query, column, from, to) {
    if (from) query = query.gte(column, `${from}T00:00:00.000Z`);
    if (to) query = query.lte(column, `${to}T23:59:59.999Z`);
    return query;
}

async function readReportRows(query, label) {
    const { data, error, count } = await query.limit(MAX_REPORT_ROWS);
    if (error) {
        console.error(`${label} report query error:`, error);
        throw new ReportError(`Could not load the ${label} report`);
    }
    if (count > MAX_REPORT_ROWS || count > (data || []).length) {
        throw new ReportError("The report has too many rows. Choose a shorter date range.", 413);
    }
    return data || [];
}

async function readAllRows(query, label) {
    const rows = [];
    for (let start = 0; ; start += REPORT_PAGE_SIZE) {
        const { data, error } = await query
            .range(start, start + REPORT_PAGE_SIZE - 1);
        if (error) {
            console.error(`${label} report query error:`, error);
            throw new ReportError(`Could not load the ${label} report`);
        }
        const page = data || [];
        rows.push(...page);
        if (page.length < REPORT_PAGE_SIZE) return rows;
    }
}

async function rowsByIds(client, table, fields, ids) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const rows = [];
    for (let index = 0; index < uniqueIds.length; index += 100) {
        let query = client
            .from(table)
            .select(fields)
            .in("id", uniqueIds.slice(index, index + 100));
        if (table === "plants") query = query.is("deleted_at", null);
        const { data, error } = await query;
        if (error) {
            console.error(`${table} report lookup error:`, error);
            throw new ReportError("Could not load related report data");
        }
        rows.push(...(data || []));
    }
    return rows;
}

function dateOnly(value) {
    return value ? String(value).slice(0, 10) : "";
}

// "21 Nov 2026" (Sarawak time).
function dayText(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE }).format(date);
}

// "21 Nov 2026, 14:05" (Sarawak time).
function dayTimeText(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIME_ZONE }).format(date);
    return `${dayText(date)}, ${time}`;
}

const STATUS_NAMES = {
    CR: "Critically Endangered",
    EN: "Endangered",
    VU: "Vulnerable",
    NT: "Near Threatened",
    LC: "Least Concern",
    DD: "Data Deficient",
};

function conservationStatusName(status) {
    return status ? STATUS_NAMES[status] || status : "Not assessed";
}

// Review status in words (the same words as the portal and the app).
const REVIEW_WORDS = {
    pending: "Waiting for review",
    approved: "Approved",
    rejected: "Needs changes",
    draft: "Not submitted yet",
};
function reviewWords(status) {
    return REVIEW_WORDS[status] || (status ? String(status) : "Not recorded");
}

// "seedling_sapling" -> "Seedling sapling".
function readable(value) {
    const text = String(value ?? "").replace(/_/g, " ").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

// Placeholder tags ("plant:<id>") are not real tags.
function tagText(tag) {
    return typeof tag === "string" && /^NIAH-PLT-\d{5}$/.test(tag) ? tag : "No physical tag yet";
}

// The rank a species record was identified to: the stored taxon_rank when it says genus or
// family, otherwise read from the name (a single word ending in -aceae is a family, -inae a
// subtribe, ...). "Species" for ordinary two-word names.
const BROAD_GROUPS = new Set(["Plantae", "Tracheophyta", "Angiospermae", "Magnoliopsida", "Bryophyta",
    "Marchantiophyta", "Polypodiopsida", "Polypodiineae"]);
function rankOf(scientificName, taxonRank) {
    if (taxonRank === "genus") return "Genus";
    if (taxonRank === "family") return "Family";
    const name = String(scientificName ?? "").trim();
    if (/\s/.test(name)) return "Species";
    if (BROAD_GROUPS.has(name)) return "Group";
    if (/aceae$/.test(name)) return "Family";
    if (/oideae$/.test(name)) return "Subfamily";
    if (/inae$/.test(name)) return "Subtribe";
    if (/eae$/.test(name)) return "Tribe";
    return name ? "Genus" : "Species";
}

// Alert type from its message (there is no type column).
function alertType(message) {
    const text = String(message ?? "").toLowerCase();
    if (/camera|movement|person/.test(text)) return "Movement";
    if (/soil/.test(text)) return "Soil moisture";
    if (/rain/.test(text)) return "Rain";
    if (/temperature/.test(text)) return "Temperature";
    if (/humidity/.test(text)) return "Humidity";
    if (/battery/.test(text)) return "Battery";
    if (/offline|no data|silent/.test(text)) return "Station offline";
    return "Sensor alert";
}

const SEVERITY_ORDER = { critical: 0, high: 1, warning: 2, medium: 3, low: 4, info: 5 };

// ---- filtering, search and sort (the same for the table and the exports) ----

// The tabs: what each one filters on and how it can be sorted.
const TABS = {
    inventory: {
        unit: "species",
        statusOptions: [
            { value: "threatened", label: "Threatened (CR + EN)" },
            ...Object.entries(STATUS_NAMES).map(([value, label]) => ({ value, label })),
            { value: "NA", label: "Not assessed" },
        ],
        sortOptions: [
            { value: "name", label: "Name A–Z" },
            { value: "plants", label: "Most plants first" },
            { value: "newest", label: "Newest first" },
        ],
    },
    plants: {
        unit: "plant records",
        statusOptions: [
            { value: "pending", label: "Waiting for review" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Needs changes" },
        ],
        sortOptions: [
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
            { value: "species", label: "Species A–Z" },
        ],
    },
    botanist: {
        unit: "field observations",
        statusOptions: [
            { value: "pending", label: "Waiting for review" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Needs changes" },
            { value: "draft", label: "Not submitted yet" },
        ],
        sortOptions: [
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
        ],
    },
    alerts: {
        unit: "alerts",
        statusOptions: [
            { value: "open", label: "Open" },
            { value: "acknowledged", label: "Acknowledged" },
            { value: "resolved", label: "Resolved" },
        ],
        sortOptions: [
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
            { value: "severity", label: "Most severe first" },
        ],
    },
};

// Checks the options for a tab. Returns { status, sort, q } or throws a 400 ReportError.
function validateOptions(type, { status, sort, q } = {}) {
    const tab = TABS[type];
    if (!tab) return { status: undefined, sort: undefined, q: undefined };
    if (status !== undefined && (typeof status !== "string" || !tab.statusOptions.some(option => option.value === status))) {
        throw new ReportError("Choose a status from the list.", 400);
    }
    if (sort !== undefined && (typeof sort !== "string" || !tab.sortOptions.some(option => option.value === sort))) {
        throw new ReportError("Choose a sort order from the list.", 400);
    }
    if (q !== undefined && (typeof q !== "string" || q.length > 100)) {
        throw new ReportError("The search text is too long.", 400);
    }
    return { status, sort: sort ?? tab.sortOptions[0].value, q: q?.trim() || undefined };
}

// Rows whose shown columns contain the search text (any case).
function searchRows(rows, columns, q) {
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter(row => columns.some(column => String(row[column.key] ?? "").toLowerCase().includes(needle)));
}

// The applied filters in words, with the actual dates.
function filtersText(type, { from, to, status, q, sort }) {
    const tab = TABS[type];
    const parts = [];
    if (from && to) parts.push(`First recorded: ${dayText(`${from}T12:00:00Z`)} – ${dayText(`${to}T12:00:00Z`)}`);
    else if (from) parts.push(`First recorded: from ${dayText(`${from}T12:00:00Z`)}`);
    else if (to) parts.push(`First recorded: up to ${dayText(`${to}T12:00:00Z`)}`);
    else parts.push("First recorded: all time");
    if (tab) {
        parts.push(`Status: ${status ? tab.statusOptions.find(option => option.value === status).label : "All"}`);
        if (q) parts.push(`Search: "${q}"`);
        if (sort) parts.push(`Sort: ${tab.sortOptions.find(option => option.value === sort)?.label ?? sort}`);
    }
    return parts.join(" · ");
}

// ---- the tabs ----

async function inventoryReport(client, { from, to, status, sort }) {
    const run = (withRank) => {
        let query = client
            .from("species")
            .select(`id, scientific_name, common_name, conservation_status, created_at, ${withRank ? "taxon_rank, " : ""}taxonomy(family)`, { count: "exact" })
            .eq("verification_status", "approved")
            .order("scientific_name");
        query = applyDateRange(query, "created_at", from, to);
        if (status === "threatened") query = query.in("conservation_status", ["CR", "EN"]);
        else if (status === "NA") query = query.is("conservation_status", null);
        else if (status) query = query.eq("conservation_status", status);
        return readReportRows(query, "species inventory");
    };
    let species;
    try {
        species = await run(true);
    } catch (error) {
        // Before the taxon_rank migration: the rank is read from the name.
        if (error instanceof ReportError && error.status === 500) species = await run(false);
        else throw error;
    }
    const plants = species.length
        ? await readAllRows(
            client.from("plants")
                .select("species_id")
                .is("deleted_at", null)
                .in("species_id", species.map(item => item.id)),
            "plant"
        )
        : [];
    const plantCountBySpecies = new Map();
    for (const plant of plants) {
        plantCountBySpecies.set(plant.species_id, (plantCountBySpecies.get(plant.species_id) || 0) + 1);
    }

    let rows = species.map(item => ({
        scientific_name: item.scientific_name || "",
        rank: rankOf(item.scientific_name, item.taxon_rank),
        common_name: item.common_name || "",
        family: item.taxonomy?.family || "",
        conservation_status: conservationStatusName(item.conservation_status),
        status_code: item.conservation_status || null,
        plant_count: plantCountBySpecies.get(item.id) || 0,
        first_recorded: dateOnly(item.created_at),
    }));
    if (sort === "plants") rows = [...rows].sort((a, b) => b.plant_count - a.plant_count || a.scientific_name.localeCompare(b.scientific_name));
    if (sort === "newest") rows = [...rows].sort((a, b) => b.first_recorded.localeCompare(a.first_recorded) || a.scientific_name.localeCompare(b.scientific_name));

    return {
        title: "Species inventory",
        note: "Approved species first recorded in the selected date range. Plant counts include all active plants.",
        columns: [
            { key: "scientific_name", label: "Scientific name" },
            { key: "rank", label: "Identified to" },
            { key: "common_name", label: "Common name" },
            { key: "family", label: "Family" },
            { key: "conservation_status", label: "Conservation status" },
            { key: "plant_count", label: "Plants recorded" },
            { key: "first_recorded", label: "First recorded" },
        ],
        rows,
        summary: (shown) => [
            { label: "Species", value: shown.length },
            { label: "Threatened (CR + EN)", value: shown.filter(row => ["CR", "EN"].includes(row.status_code)).length },
            { label: "Plants recorded", value: shown.reduce((sum, row) => sum + row.plant_count, 0) },
            { label: "No plants yet", value: shown.filter(row => row.plant_count === 0).length },
        ],
    };
}

async function plantsReport(client, { from, to, status, sort }) {
    let query = client
        .from("plants")
        .select("id, species_id, qr_code_value, plant_status, location_description, registered_by, registered_at", { count: "exact" })
        .is("deleted_at", null)
        .order("registered_at", { ascending: false });
    query = applyDateRange(query, "registered_at", from, to);
    if (status) query = query.eq("plant_status", status);
    const plants = await readReportRows(query, "plant records");
    const [species, profiles, visits] = await Promise.all([
        rowsByIds(client, "species", "id, scientific_name", plants.map(plant => plant.species_id)),
        rowsByIds(client, "profiles", "id, full_name", plants.map(plant => plant.registered_by)),
        plants.length
            ? readAllRows(client.from("observations").select("plant_id, observed_at").is("deleted_at", null)
                .in("plant_id", plants.map(plant => plant.id)), "observation")
            : [],
    ]);
    const speciesById = new Map(species.map(item => [item.id, item]));
    const nameById = new Map(profiles.map(item => [item.id, item.full_name]));
    const lastVisit = new Map();
    for (const visit of visits) {
        if (!lastVisit.has(visit.plant_id) || visit.observed_at > lastVisit.get(visit.plant_id)) lastVisit.set(visit.plant_id, visit.observed_at);
    }
    let rows = plants.map(plant => ({
        plant_tag: tagText(plant.qr_code_value),
        scientific_name: speciesById.get(plant.species_id)?.scientific_name || "Species not recorded",
        location_note: plant.location_description || "Not recorded",
        plant_status: reviewWords(plant.plant_status),
        status_code: plant.plant_status || null,
        botanist: nameById.get(plant.registered_by) || "Not recorded",
        first_recorded: dateOnly(plant.registered_at),
        last_observation: dateOnly(lastVisit.get(plant.id)),
    }));
    if (sort === "oldest") rows = [...rows].reverse();
    if (sort === "species") rows = [...rows].sort((a, b) => a.scientific_name.localeCompare(b.scientific_name));

    return {
        title: "Plant records",
        note: "Active plant records first recorded in the selected date range. Locations are not included.",
        columns: [
            { key: "plant_tag", label: "Plant tag" },
            { key: "scientific_name", label: "Species" },
            { key: "location_note", label: "Location note" },
            { key: "plant_status", label: "Status" },
            { key: "botanist", label: "Registered by" },
            { key: "first_recorded", label: "First recorded" },
            { key: "last_observation", label: "Last observation" },
        ],
        rows,
        summary: (shown) => [
            { label: "Plant records", value: shown.length },
            { label: "Approved", value: shown.filter(row => row.status_code === "approved").length },
            { label: "Waiting for review", value: shown.filter(row => row.status_code === "pending").length },
            { label: "Needs changes", value: shown.filter(row => row.status_code === "rejected").length },
        ],
    };
}

async function botanistReport(client, { from, to, status, sort }) {
    let query = client
        .from("observations")
        .select("id, plant_id, observer_id, observed_at, health_status, life_stage, height_cm, diameter_cm, review_status", { count: "exact" })
        .is("deleted_at", null)
        .order("observed_at", { ascending: false });
    query = applyDateRange(query, "observed_at", from, to);
    if (status) query = query.eq("review_status", status);
    const observations = await readReportRows(query, "field observations");

    const [plants, profiles] = await Promise.all([
        rowsByIds(client, "plants", "id, species_id, qr_code_value", observations.map(item => item.plant_id)),
        rowsByIds(client, "profiles", "id, full_name", observations.map(item => item.observer_id)),
    ]);
    const activePlantIds = new Set(plants.map(plant => plant.id));
    const activeObservations = observations.filter(item => activePlantIds.has(item.plant_id));
    const species = await rowsByIds(client, "species", "id, scientific_name", plants.map(item => item.species_id));
    const plantById = new Map(plants.map(item => [item.id, item]));
    const profileById = new Map(profiles.map(item => [item.id, item]));
    const speciesById = new Map(species.map(item => [item.id, item]));

    let rows = activeObservations.map(item => {
        const plant = plantById.get(item.plant_id);
        return {
            observed_at: dateOnly(item.observed_at),
            scientific_name: speciesById.get(plant?.species_id)?.scientific_name || "Species not recorded",
            plant_tag: tagText(plant?.qr_code_value),
            botanist: profileById.get(item.observer_id)?.full_name || "Not recorded",
            health_status: readable(item.health_status),
            life_stage: readable(item.life_stage),
            // Stored in cm; reported in metres (2 decimals). Diameter stays in cm.
            height_m: item.height_cm == null ? "" : Math.round(Number(item.height_cm)) / 100,
            diameter_cm: item.diameter_cm == null ? "" : Math.round(Number(item.diameter_cm) * 100) / 100,
            review_status: reviewWords(item.review_status),
            status_code: item.review_status || null,
        };
    });
    if (sort === "oldest") rows = [...rows].reverse();

    return {
        title: "Field observations",
        note: "Active field observations recorded in the selected date range.",
        columns: [
            { key: "observed_at", label: "Date" },
            { key: "scientific_name", label: "Species" },
            { key: "plant_tag", label: "Plant tag" },
            { key: "botanist", label: "Botanist" },
            { key: "health_status", label: "Health" },
            { key: "life_stage", label: "Life stage" },
            { key: "height_m", label: "Height (m)" },
            { key: "diameter_cm", label: "Diameter (cm)" },
            { key: "review_status", label: "Review status" },
        ],
        rows,
        summary: (shown) => [
            { label: "Field observations", value: shown.length },
            { label: "Botanists", value: new Set(shown.map(row => row.botanist)).size },
            { label: "Waiting for review", value: shown.filter(row => row.status_code === "pending").length },
            { label: "Approved", value: shown.filter(row => row.status_code === "approved").length },
        ],
    };
}

async function alertsReport(client, { from, to, status, sort }) {
    const run = (withSource) => {
        let query = client
            .from("alerts")
            .select(`id, station_id, alert_message, severity, alert_status, triggered_at, resolved_by, resolved_at, resolution_notes${withSource ? ", resolution_source" : ""}`, { count: "exact" })
            .order("triggered_at", { ascending: false });
        query = applyDateRange(query, "triggered_at", from, to);
        if (status) query = query.eq("alert_status", status);
        return readReportRows(query, "IoT alerts");
    };
    let alerts;
    try {
        alerts = await run(true);
    } catch (error) {
        if (error instanceof ReportError && error.status === 500) alerts = await run(false);
        else throw error;
    }
    const [stations, profiles] = await Promise.all([
        // Station codes only: never their coordinates.
        rowsByIds(client, "sensor_stations", "id, station_code", alerts.map(alert => alert.station_id)),
        rowsByIds(client, "profiles", "id, full_name", alerts.map(alert => alert.resolved_by)),
    ]);
    const stationById = new Map(stations.map(item => [item.id, item.station_code]));
    const nameById = new Map(profiles.map(item => [item.id, item.full_name]));
    let rows = alerts.map(alert => ({
        triggered_at: dayTimeText(alert.triggered_at),
        sort_time: alert.triggered_at || "",
        station: stationById.get(alert.station_id) || "Unknown station",
        type: alertType(alert.alert_message),
        severity: readable(alert.severity) || "Not recorded",
        severity_code: String(alert.severity || "").toLowerCase(),
        alert_status: readable(alert.alert_status) || "Not recorded",
        status_code: alert.alert_status || null,
        resolved_by: alert.resolution_source === "ai"
            ? "AI (camera check)"
            : (alert.resolved_by ? nameById.get(alert.resolved_by) || "Officer" : ""),
        note: alert.resolution_notes || "",
    }));
    rows = [...rows].sort((a, b) => b.sort_time.localeCompare(a.sort_time));
    if (sort === "oldest") rows.reverse();
    if (sort === "severity") {
        rows = [...rows].sort((a, b) => (SEVERITY_ORDER[a.severity_code] ?? 9) - (SEVERITY_ORDER[b.severity_code] ?? 9) ||
            b.sort_time.localeCompare(a.sort_time));
    }

    return {
        title: "IoT alerts",
        note: "Alerts raised by the field stations in the selected date range. Station locations are not included.",
        columns: [
            { key: "triggered_at", label: "Time" },
            { key: "station", label: "Station" },
            { key: "type", label: "Type" },
            { key: "severity", label: "Severity" },
            { key: "alert_status", label: "Status" },
            { key: "resolved_by", label: "Resolved by" },
            { key: "note", label: "Note" },
        ],
        rows,
        summary: (shown) => [
            { label: "Alerts", value: shown.length },
            { label: "Open", value: shown.filter(row => row.status_code === "open").length },
            { label: "Acknowledged", value: shown.filter(row => row.status_code === "acknowledged").length },
            { label: "Resolved", value: shown.filter(row => row.status_code === "resolved").length },
        ],
    };
}

// ---- older report types, kept for the existing endpoint ----

async function speciesRows(client, from, to) {
    let query = client
        .from("species")
        .select("id, scientific_name, common_name, conservation_status, created_at, updated_at, taxonomy(family)", { count: "exact" })
        .eq("verification_status", "approved")
        .order("scientific_name");
    query = applyDateRange(query, "created_at", from, to);
    return readReportRows(query, "species");
}

async function statusReport(client, { from, to }) {
    const species = await speciesRows(client, from, to);
    const counts = new Map();
    for (const item of species) {
        const status = conservationStatusName(item.conservation_status);
        counts.set(status, (counts.get(status) || 0) + 1);
    }
    return {
        title: "Conservation status summary",
        note: "Each approved species is counted once in the selected date range.",
        columns: [
            { key: "conservation_status", label: "Conservation status" },
            { key: "species_count", label: "Species count" },
        ],
        rows: [...counts.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([conservation_status, species_count]) => ({ conservation_status, species_count })),
    };
}

async function locationsReport(client, { from, to }) {
    let plantQuery = client
        .from("plants")
        .select("id, created_at", { count: "exact" })
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
    plantQuery = applyDateRange(plantQuery, "created_at", from, to);
    const plantRows = await readReportRows(plantQuery, "plant");
    const plantIds = plantRows.map(plant => plant.id);
    const points = await rowsByIds(
        client,
        "plant_map_points",
        "id, species_id, qr_code_value, plant_status, location_description, latitude, longitude",
        plantIds
    );
    const species = await rowsByIds(client, "species", "id, scientific_name", points.map(point => point.species_id));
    const speciesById = new Map(species.map(item => [item.id, item]));

    return {
        title: "Plant locations",
        note: "Plants with recorded GPS locations, filtered by plant record date.",
        columns: [
            { key: "scientific_name", label: "Species" },
            { key: "plant_tag", label: "Plant tag" },
            { key: "landmark", label: "Location note" },
            { key: "latitude", label: "Latitude" },
            { key: "longitude", label: "Longitude" },
            { key: "plant_status", label: "Status" },
        ],
        rows: points.map(point => ({
            scientific_name: speciesById.get(point.species_id)?.scientific_name || "Unknown",
            plant_tag: point.qr_code_value || "No tag",
            landmark: point.location_description || "Not recorded",
            latitude: point.latitude,
            longitude: point.longitude,
            plant_status: point.plant_status || "Not recorded",
        })),
    };
}

const BUILDERS = {
    inventory: inventoryReport,
    plants: plantsReport,
    botanist: botanistReport,
    alerts: alertsReport,
    status: statusReport,
    locations: locationsReport,
};
const REPORT_TYPES = Object.keys(BUILDERS);

// The report for a tab with its filters applied: the same rows for the table, CSV and PDF.
async function buildReport(client, type, from, to, options = {}) {
    const { status, sort, q } = validateOptions(type, options);
    const report = await BUILDERS[type](client, { from, to, status, sort });
    const rows = searchRows(report.rows, report.columns, q);
    const summary = typeof report.summary === "function" ? report.summary(rows) : [];
    return {
        type,
        from: from || null,
        to: to || null,
        status: status || null,
        sort: sort || null,
        q: q || null,
        generated_at: new Date().toISOString(),
        unit: TABS[type]?.unit || "rows",
        status_options: TABS[type]?.statusOptions || [],
        sort_options: TABS[type]?.sortOptions || [],
        filters_text: filtersText(type, { from, to, status, q, sort }),
        title: report.title,
        note: report.note,
        columns: report.columns,
        rows,
        total: rows.length,
        summary,
    };
}

async function readCount(query, label) {
    const { count, error } = await query;
    if (error) {
        console.error(`${label} summary query error:`, error);
        throw new ReportError("Could not load report summary");
    }
    if (!Number.isInteger(count) || count < 0) {
        throw new ReportError("Could not load report summary");
    }
    return count;
}

async function buildSummary(client) {
    const [speciesCount, endangeredCount, pendingCount, plantCount] = await Promise.all([
        readCount(client.from("species")
            .select("id", { count: "exact", head: true })
            .eq("verification_status", "approved"), "species"),
        readCount(client.from("species")
            .select("id", { count: "exact", head: true })
            .eq("verification_status", "approved")
            .in("conservation_status", ["CR", "EN"]), "endangered species"),
        readCount(client.from("observations")
            .select("id", { count: "exact", head: true })
            .eq("review_status", "pending")
            .is("deleted_at", null), "pending observation"),
        readCount(client.from("plants")
            .select("id", { count: "exact", head: true })
            .is("deleted_at", null), "plant"),
    ]);
    return {
        species_count: speciesCount,
        endangered_count: endangeredCount,
        pending_observation_count: pendingCount,
        plant_count: plantCount,
    };
}

module.exports = {
    buildReport, buildSummary, ReportError, REPORT_TYPES, TABS, rankOf, alertType, dayText, dayTimeText,
};
