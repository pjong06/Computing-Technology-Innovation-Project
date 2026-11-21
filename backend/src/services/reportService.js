const MAX_REPORT_ROWS = 1000;
const REPORT_PAGE_SIZE = 1000;

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
            throw new ReportError(`Could not load ${label} report`);
        }
        const page = data || [];
        rows.push(...page);
        if (page.length < REPORT_PAGE_SIZE) return rows;
    }
}

function dateOnly(value) {
    return value ? String(value).slice(0, 10) : "";
}

function conservationStatusName(status) {
    const names = {
        CR: "Critically Endangered",
        EN: "Endangered",
        VU: "Vulnerable",
        NT: "Near Threatened",
        LC: "Least Concern",
        DD: "Data Deficient",
    };
    return status ? names[status] || status : "Not assessed";
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

async function inventoryReport(client, from, to) {
    const species = await speciesRows(client, from, to);
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
        plantCountBySpecies.set(
            plant.species_id,
            (plantCountBySpecies.get(plant.species_id) || 0) + 1
        );
    }

    return {
        title: "Species inventory",
        note: "Approved species first recorded in the selected date range. Plant counts include all active plants.",
        columns: [
            { key: "scientific_name", label: "Scientific name" },
            { key: "common_name", label: "Common name" },
            { key: "family", label: "Family" },
            { key: "conservation_status", label: "Conservation status" },
            { key: "plant_count", label: "Plants recorded" },
        ],
        rows: species.map(item => ({
            scientific_name: item.scientific_name || "",
            common_name: item.common_name || "",
            family: item.taxonomy?.family || "",
            conservation_status: conservationStatusName(item.conservation_status),
            plant_count: plantCountBySpecies.get(item.id) || 0,
        })),
    };
}

async function statusReport(client, from, to) {
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

async function botanistReport(client, from, to) {
    let query = client
        .from("observations")
        .select("id, plant_id, observer_id, observed_at, health_status, life_stage, height_cm, diameter_cm, review_status", { count: "exact" })
        .is("deleted_at", null)
        .order("observed_at", { ascending: false });
    query = applyDateRange(query, "observed_at", from, to);
    const observations = await readReportRows(query, "observation");

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

    return {
        title: "Field observations",
        note: "Active field observations recorded in the selected date range.",
        columns: [
            { key: "observed_at", label: "Date" },
            { key: "scientific_name", label: "Species" },
            { key: "plant_tag", label: "Plant tag" },
            { key: "botanist", label: "Botanist" },
            { key: "health_status", label: "Health" },
            { key: "life_stage", label: "Stage" },
            { key: "height_m", label: "Height (m)" },
            { key: "diameter_cm", label: "Diameter (cm)" },
            { key: "review_status", label: "Review status" },
        ],
        rows: activeObservations.map(item => {
            const plant = plantById.get(item.plant_id);
            return {
                observed_at: dateOnly(item.observed_at),
                scientific_name: speciesById.get(plant?.species_id)?.scientific_name || "Unknown",
                plant_tag: plant?.qr_code_value || "No tag",
                botanist: profileById.get(item.observer_id)?.full_name || "Unknown",
                health_status: item.health_status || "",
                life_stage: item.life_stage || "",
                // Stored in cm; reported in metres (2 decimals). Diameter stays in cm.
                height_m: item.height_cm == null ? "" : Math.round(Number(item.height_cm)) / 100,
                diameter_cm: item.diameter_cm == null ? "" : Math.round(Number(item.diameter_cm) * 100) / 100,
                review_status: item.review_status || "",
            };
        }),
    };
}

async function locationsReport(client, from, to) {
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
            { key: "landmark", label: "Landmark" },
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

async function buildReport(client, type, from, to) {
    const builders = {
        inventory: inventoryReport,
        status: statusReport,
        botanist: botanistReport,
        locations: locationsReport,
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

module.exports = { buildReport, buildSummary, ReportError };
