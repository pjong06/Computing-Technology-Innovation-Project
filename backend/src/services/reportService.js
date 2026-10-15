const MAX_REPORT_ROWS = 1000;

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
        throw new ReportError(`Could not load ${label} report`);
    }
    if (count > MAX_REPORT_ROWS || count > data.length) {
        throw new ReportError("The report has too many rows. Choose a shorter date range.", 413);
    }
    return data;
}

function dateOnly(value) {
    return value ? String(value).slice(0, 10) : "";
}

async function speciesRows(client, from, to) {
    let query = client
        .from("species")
        .select("id, scientific_name, common_name, conservation_status, created_at, updated_at, taxonomy(family)", { count: "exact" })
        .eq("verification_status", "approved")
        .order("scientific_name");
    query = applyDateRange(query, "created_at", from, to);
    return readReportRows(query, "species");
}

async function rowsByIds(client, table, fields, ids) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const rows = [];
    for (let index = 0; index < uniqueIds.length; index += 100) {
        const { data, error } = await client
            .from(table)
            .select(fields)
            .in("id", uniqueIds.slice(index, index + 100));
        if (error) {
            console.error(`${table} report lookup error:`, error);
            throw new ReportError("Could not load related report data");
        }
        rows.push(...data);
    }
    return rows;
}

async function inventoryReport(client, from, to) {
    const species = await speciesRows(client, from, to);
    return {
        title: "Species inventory",
        note: "Approved species first recorded in the selected UTC date range.",
        columns: [
            { key: "scientific_name", label: "Scientific name" },
            { key: "common_name", label: "Common name" },
            { key: "family", label: "Family" },
            { key: "conservation_status", label: "Conservation status" },
            { key: "created_at", label: "First recorded" },
            { key: "updated_at", label: "Last updated" },
        ],
        rows: species.map(item => ({
            scientific_name: item.scientific_name,
            common_name: item.common_name || "",
            family: item.taxonomy?.family || "",
            conservation_status: item.conservation_status || "Unknown",
            created_at: dateOnly(item.created_at),
            updated_at: dateOnly(item.updated_at),
        })),
    };
}

async function statusReport(client, from, to) {
    const species = await speciesRows(client, from, to);
    const counts = new Map();
    for (const item of species) {
        const status = item.conservation_status || "Unknown";
        counts.set(status, (counts.get(status) || 0) + 1);
    }
    return {
        title: "Conservation status summary",
        note: "Each approved species is counted once in the selected UTC date range.",
        columns: [
            { key: "conservation_status", label: "Conservation status" },
            { key: "species_count", label: "Species count" },
        ],
        rows: [...counts.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([conservation_status, species_count]) => ({ conservation_status, species_count })),
    };
}

async function botanistReport(client, from, to) {
    let query = client
        .from("observations")
        .select("id, plant_id, observer_id, observed_at, review_status", { count: "exact" })
        .is("deleted_at", null)
        .order("observed_at", { ascending: false });
    query = applyDateRange(query, "observed_at", from, to);
    const observations = await readReportRows(query, "observation");

    const [plants, profiles] = await Promise.all([
        rowsByIds(client, "plants", "id, species_id", observations.map(item => item.plant_id)),
        rowsByIds(client, "profiles", "id, full_name", observations.map(item => item.observer_id)),
    ]);
    const species = await rowsByIds(client, "species", "id, scientific_name", plants.map(item => item.species_id));
    const plantById = new Map(plants.map(item => [item.id, item]));
    const profileById = new Map(profiles.map(item => [item.id, item]));
    const speciesById = new Map(species.map(item => [item.id, item]));

    return {
        title: "Observations by botanist",
        note: "Active observations recorded in the selected UTC date range.",
        columns: [
            { key: "botanist", label: "Botanist" },
            { key: "observation_id", label: "Observation ID" },
            { key: "scientific_name", label: "Species" },
            { key: "observed_at", label: "Observed date" },
            { key: "review_status", label: "Review status" },
        ],
        rows: observations.map(item => {
            const plant = plantById.get(item.plant_id);
            return {
                botanist: profileById.get(item.observer_id)?.full_name || "Unknown",
                observation_id: item.id,
                scientific_name: speciesById.get(plant?.species_id)?.scientific_name || "Unknown",
                observed_at: dateOnly(item.observed_at),
                review_status: item.review_status,
            };
        }),
    };
}

async function buildReport(client, type, from, to) {
    const builders = {
        inventory: inventoryReport,
        status: statusReport,
        botanist: botanistReport,
    };
    const report = await builders[type](client, from, to);
    return {
        type,
        from: from || null,
        to: to || null,
        generated_at: new Date().toISOString(),
        total: report.rows.length,
        ...report,
    };
}

module.exports = { buildReport, ReportError };
