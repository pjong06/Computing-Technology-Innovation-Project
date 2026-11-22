"use strict";

// speciesRequestChecks.js - the "Before you decide" checks on a species request waiting for
// review (Review > Species requests). General rules, the same for every request:
//   - duplicate:     the name is already in the catalogue, or already requested (the same name,
//                    exactly or with different capitals or spacing);
//   - name_format:   "Genus species": the genus with a capital, the rest lower case
//                    (a "Fix name" is offered when that can be done by changing capitals/spaces);
//   - missing:       family or description not given (both are needed in the catalogue);
//   - short_description: a description under 40 characters (flagged only);
//   - local_name:    a local name that can't be right (a placeholder like "n/a", digits, no
//                    letters, or the scientific name again); "Clear" is offered.
// Each check is { key, message, fix? } where fix = { field, value, label } is a change the
// officer can save to the request before deciding.

const MIN_DESCRIPTION = 40;
const REQUIRED_FIELDS = [
    ["proposed_family", "family"],
    ["description", "description"],
];
const PLACEHOLDER_NAMES = new Set([
    "-", "--", "?", "??", ".", "n/a", "na", "nil", "none", "null", "unknown", "no", "test",
    "tiada", "tidak tahu", "tak tahu", "x", "xx",
]);
const CATALOGUE_STATUSES = ["approved", "pending", "archived"];
const PAGE = 1000;
const MAX_ROWS = 20000;

const normalised = (name) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// "Genus species ..." with the genus capitalised and the species part in lower case.
function nameLooksRight(name) {
    const text = String(name ?? "");
    if (text !== text.trim().replace(/\s+/g, " ")) return false;
    const [genus, epithet] = text.split(" ");
    return /^[A-Z][a-z]+(-[a-z]+)?$/.test(genus || "") && /^[a-z]+(-[a-z]+)*$/.test(epithet || "");
}

// The same name with the capitals and spaces put right, or null when that isn't enough.
function suggestedName(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return null;
    const [genus, epithet, ...rest] = words;
    const fixed = [genus.charAt(0).toUpperCase() + genus.slice(1).toLowerCase(), epithet.toLowerCase(), ...rest].join(" ");
    return nameLooksRight(fixed) && fixed !== name ? fixed : null;
}

function localNameProblem(localName, scientificName) {
    const text = String(localName ?? "").trim();
    if (!text) return false;
    return PLACEHOLDER_NAMES.has(text.toLowerCase()) || !/\p{L}/u.test(text) || /\d/.test(text) ||
        normalised(text) === normalised(scientificName);
}

// catalogue: [{ id, scientific_name, verification_status }] (every species row that is in
// the catalogue or waiting), or null when it could not be read.
function requestChecks(request, catalogue) {
    const checks = [];
    const name = String(request.scientific_name ?? "");

    if (catalogue === null) {
        checks.push({ key: "duplicate", message: "The catalogue could not be checked for this name. Try again before adding it." });
    } else {
        const same = catalogue.find(row => row.id !== request.id && normalised(row.scientific_name) === normalised(name));
        if (same) {
            const exact = String(same.scientific_name).trim() === name.trim();
            const how = exact ? "" : " (the same name with different capitals or spacing)";
            checks.push({
                key: "duplicate",
                message: same.verification_status === "pending"
                    ? `Already requested: ${same.scientific_name} is waiting for review${how}.`
                    : `Already in the catalogue as ${same.scientific_name}${how}.`,
            });
        }
    }

    if (!nameLooksRight(name)) {
        const fixed = suggestedName(name);
        checks.push({
            key: "name_format",
            message: fixed
                ? `The name should be written "${fixed}": the genus with a capital, the species part in lower case.`
                : "The name should be the genus and species, like \"Nepenthes ampullaria\": the genus with a capital, the species part in lower case.",
            ...(fixed ? { fix: { field: "scientific_name", value: fixed, label: "Fix name" } } : {}),
        });
    }

    const missing = REQUIRED_FIELDS.filter(([field]) => !String(request[field] ?? "").trim()).map(([, label]) => label);
    if (missing.length > 0) {
        checks.push({ key: "missing", message: `Not given: ${missing.join(" and ")}.` });
    }

    const description = String(request.description ?? "").trim();
    if (description && description.length < MIN_DESCRIPTION) {
        checks.push({
            key: "short_description",
            message: `The description is short (${description.length} characters). Check it says enough to tell the plant apart.`,
        });
    }

    if (localNameProblem(request.local_name, name)) {
        checks.push({
            key: "local_name",
            message: `The local name "${String(request.local_name).trim()}" doesn't look like a real name.`,
            fix: { field: "local_name", value: null, label: "Clear" },
        });
    }
    return checks;
}

// Every species name in the catalogue or waiting for review, read in pages of 1000.
// Returns null when it can't be read (the requests still load; the duplicate check says so).
async function loadCatalogueNames(supabase) {
    const rows = [];
    for (let start = 0; start < MAX_ROWS; start += PAGE) {
        const { data, error } = await supabase
            .from("species")
            .select("id, scientific_name, verification_status")
            .in("verification_status", CATALOGUE_STATUSES)
            .order("id")
            .range(start, start + PAGE - 1);
        if (error) {
            console.error("Species request catalogue check error:", error.message || error);
            return null;
        }
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
    }
    return rows;
}

module.exports = { requestChecks, loadCatalogueNames, nameLooksRight, suggestedName, localNameProblem, MIN_DESCRIPTION };
