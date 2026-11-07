const express = require("express");
const { randomUUID } = require("crypto");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textIdPattern = /^[A-Za-z0-9._-]{1,100}$/;
const photoLimit = 3000000;

// The other saved values the website keeps in the table web_data. Anything else is refused.
const allowedKeys = new Set(["niah_data_version"]);

// The lists that have their own table.
// text = [column, longest allowed text, required, value used when empty]
const lists = {
    species: {
        table: "website_species",
        ids: "uuid",
        text: [
            ["scientific_name", 200, true],
            ["common_name", 200],
            ["family", 200],
            ["conservation_status", 100, false, "Least Concern"],
            ["location_name", 300],
            ["gps", 100],
            ["description", 5000],
            ["observation_id", 100],
            ["photo"],
        ],
        times: ["first_recorded", "last_updated"],
        flags: [],
    },
    observations: {
        table: "website_observations",
        ids: "text",
        text: [
            ["scientific_name", 200, true],
            ["common_name", 200],
            ["family", 200],
            ["observed_by", 200],
            ["location_name", 300],
            ["gps", 100],
            ["notes", 5000],
            ["photo"],
            ["state", 50, false, "Pending"],
            ["reject_reason", 1000],
        ],
        times: ["observed_at"],
        flags: [],
        // A botanist may only add NEW observations that wait for approval (state Pending).
        botanistMaySubmit: true,
        // The database only lets the officer change state and reject_reason of an existing
        // observation (trigger guard_website_observation_write), so the officer's save is an UPDATE.
        reviewOnly: true,
    },
    users: {
        table: "website_users",
        ids: "uuid",
        text: [
            ["name", 200],
            ["username", 100],
            ["email", 200, true],
            ["role", 100],
        ],
        times: [],
        flags: ["active"],
        officerOnly: true,
    },
};

router.use(requireAuth);

// Check whether the logged-in user is an officer.
function isOfficer(req) {
    return req.profile && req.profile.role === "officer";
}

// Cleans a piece of text and cuts it to a safe length.
function textOf(value, maxLength) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLength);
}

// Returns a date and time as text the database accepts, or null.
function timeOrNull(value) {
    if (typeof value !== "string" || value === "") return null;
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

// The extra details the table has no column for.
function extraOf(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return JSON.stringify(value).length > 100000 ? {} : value;
}

// Cleans one item from the website. Returns { row } or { error }.
function cleanRow(item, list, index) {
    const row = {};

    if (list.ids === "uuid") {
        row.id = typeof item.id === "string" && uuidPattern.test(item.id) ? item.id : randomUUID();
    } else {
        if (typeof item.id !== "string" || !textIdPattern.test(item.id)) {
            return { error: "Every record needs a valid id" };
        }
        row.id = item.id;
    }

    for (const [column, maxLength, required, fallback] of list.text) {
        if (column === "photo") {
            // Only uploaded pictures (not too big) or https picture links are kept.
            const photo = typeof item.photo === "string" ? item.photo : "";
            if (photo.startsWith("data:image/")) {
                if (photo.length > photoLimit) {
                    return { error: "A photo is too big. Choose a smaller picture." };
                }
                row.photo = photo;
            } else if (/^https:\/\/\S{1,500}$/.test(photo)) {
                // A link to a picture on the internet, for example from iNaturalist.
                row.photo = photo;
            } else {
                row.photo = "";
            }
            continue;
        }
        let value = textOf(item[column], maxLength);
        if (value === "" && fallback) value = fallback;
        if (required && value === "") {
            return { error: `Every record needs a ${column.replace(/_/g, " ")}` };
        }
        row[column] = value;
    }
    for (const column of list.times) row[column] = timeOrNull(item[column]);
    for (const column of list.flags) row[column] = item[column] !== false;

    row.extra = extraOf(item.extra);
    // position is the place of the record in the full list (the page sends only changed records).
    row.sort_order = Number.isInteger(item.position) && item.position >= 0 ? item.position : index;
    return { row };
}

for (const [name, list] of Object.entries(lists)) {
    // Send the whole list to the website.
    router.get("/" + name, async (req, res) => {
        // Only the officer may see the user list. Everyone else gets an empty list.
        if (list.officerOnly && !isOfficer(req)) {
            return res.json({ data: [] });
        }
        const { data, error } = await req.supabase
            .from(list.table)
            .select("*")
            .order("sort_order", { ascending: true });

        if (error) {
            console.error(`Website ${name} load error:`, error);
            return res.status(500).json({ message: `Could not load the ${name}` });
        }
        return res.json({ data });
    });

    // Save changes: add new records, update changed ones and remove the ones the page deleted.
    router.put("/" + name, async (req, res) => {
    // Only officers can change website data.
    if (!isOfficer(req)) {
        return res.status(403).json({
            message: "Only the officer can change the website data"
        });
    }
        const incoming = req.body && req.body.rows;
        if (!Array.isArray(incoming) || incoming.length > 2000) {
            return res.status(400).json({ message: `A list of ${name} is required` });
        }

        const rows = [];
        const seen = new Set();
        for (let i = 0; i < incoming.length; i++) {
            const result = cleanRow(incoming[i] || {}, list, i);
            if (result.error) {
                return res.status(400).json({ message: result.error });
            }
            if (seen.has(result.row.id)) {
                return res.status(400).json({ message: "Two records have the same id" });
            }
            seen.add(result.row.id);
            rows.push(result.row);
        }

        if (isSubmitter) {
            // A botanist can only send new observations for approval. Never approve, reject,
            // change someone else's record or delete anything.
            const removedByBotanist = Array.isArray(req.body.removed) ? req.body.removed : [];
            if (removedByBotanist.length > 0 || rows.some(row => row.state !== "Pending")) {
                return res.status(403).json({ message: "Only the officer can change the website data" });
            }
            if (rows.length > 0) {
                const ids = rows.map(row => row.id);
                const { data: existing, error: lookupError } = await req.supabase
                    .from(list.table)
                    .select("id")
                    .in("id", ids);
                if (lookupError) {
                    console.error(`Website ${name} lookup error:`, lookupError);
                    return res.status(500).json({ message: `Could not save the ${name}` });
                }
                if (Array.isArray(existing) && existing.length > 0) {
                    return res.status(403).json({ message: "Only the officer can change the website data" });
                }
                const ownRows = rows.map(row => ({ ...row, owner_id: req.user.id }));
                const { error: insertError } = await req.supabase.from(list.table).insert(ownRows);
                if (insertError) {
                    console.error(`Website ${name} submit error:`, insertError);
                    return res.status(500).json({ message: `Could not save the ${name}` });
                }
            }
            return res.json({ data: rows });
        }

        // Officer review of observations: an upsert would run the database's INSERT check first
        // and refuse the officer, so change only the review fields of the existing records.
        if (list.reviewOnly && rows.length > 0) {
            for (const row of rows) {
                const { data: changed, error: reviewError } = await req.supabase
                    .from(list.table)
                    .update({ state: row.state, reject_reason: row.reject_reason })
                    .eq("id", row.id)
                    .select("id");
                if (reviewError) {
                    console.error(`Website ${name} review error:`, reviewError);
                    return res.status(403).json({ message: reviewError.message || `Could not save the ${name}` });
                }
                if (Array.isArray(changed) && changed.length === 0) {
                    return res.status(404).json({ message: "That observation was not found in the database" });
                }
            }
        } else if (rows.length > 0) {
            const { error } = await req.supabase
                .from(list.table)
                .upsert(rows, { onConflict: "id" });
            if (error) {
                console.error(`Website ${name} save error:`, error);
                return res.status(500).json({ message: `Could not save the ${name}` });
            }
        }

        // Then remove only the records this page deleted. Records it never saw are left alone.
        const removed = Array.isArray(req.body.removed) ? req.body.removed : [];
        const removedIds = removed.filter(id =>
            typeof id === "string" && (list.ids === "uuid" ? uuidPattern.test(id) : textIdPattern.test(id))
        );
        if (removedIds.length > 0) {
            const { data: deleted, error: removeError } = await req.supabase
                .from(list.table)
                .delete()
                .in("id", removedIds)
                .select("id");
            if (removeError) {
                console.error(`Website ${name} remove error:`, removeError);
                return res.status(500).json({ message: `Could not remove the deleted ${name}` });
            }
            // A row-level security rule can block a delete without any error. Then nothing is
            // removed, so say so instead of pretending it worked.
            if (Array.isArray(deleted) && deleted.length < removedIds.length) {
                console.error(`Website ${name}: asked to remove ${removedIds.length}, database removed ${deleted.length}`);
                return res.status(403).json({
                    message: `The database refused to delete ${removedIds.length - deleted.length} ${name} record(s). Is this account an active officer?`
                });
            }
        }

        return res.json({ data: rows });
    });
}

// Send the other saved values (the data version) to the website when a page opens.
router.get("/", async (req, res) => {
    const { data, error } = await req.supabase
        .from("web_data")
        .select("key, value");

    if (error) {
        console.error("Website data load error:", error);
        return res.status(500).json({ message: "Could not load the website data" });
    }

    const values = {};
    for (const row of data) {
        values[row.key] = row.value;
    }
    return res.json({ data: values });
});

// Save one of the other values.
router.put("/:key", async (req, res) => {
    const { key } = req.params;

    if (!req.profile || req.profile.role !== "officer") {
        return res.status(403).json({ message: "Only the officer can change the website data" });
    }

    if (!allowedKeys.has(key)) {
        return res.status(400).json({ message: "Unknown data key" });
    }
    if (!req.body || typeof req.body !== "object" || !Object.hasOwn(req.body, "value")) {
        return res.status(400).json({ message: "A value is required" });
    }

    const { error } = await req.supabase
        .from("web_data")
        .upsert(
            { key, value: req.body.value, updated_at: new Date().toISOString() },
            { onConflict: "key" }
        );

    if (error) {
        console.error("Website data save error:", error);
        return res.status(500).json({ message: "Could not save the website data" });
    }
    return res.json({ message: "Saved" });
});

module.exports = router;
