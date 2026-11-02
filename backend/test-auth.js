const { createClient } = require("@supabase/supabase-js");
const fs = require("node:fs");
const path = require("node:path");
const { stdin, stdout } = require("node:process");
const { logResponseSummary, responseSummary } = require("./test-support/safeDiagnostics");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Set SUPABASE_URL and a publishable key in backend/.env first.");
    process.exit(1);
}

if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    console.error("Run this script in a normal PowerShell or terminal window.");
    process.exit(1);
}

function askInput(prompt, hidden = false) {
    return new Promise((resolve, reject) => {
        stdout.write(prompt);
        let value = "";
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding("utf8");

        function onData(char) {
            if (char === "\u0003") {
                cleanup();
                stdout.write("\n");
                reject(new Error("Cancelled"));
            } else if (char === "\r" || char === "\n") {
                cleanup();
                stdout.write("\n");
                resolve(value);
            } else if (char === "\u0008" || char === "\u007f") {
                if (value.length > 0) {
                    value = value.slice(0, -1);
                    stdout.write(hidden ? "\b \b" : "\b\b  \b\b");
                }
            } else if (char >= " ") {
                value += char;
                stdout.write(hidden ? "*" : char);
            }
        }

        function cleanup() {
            stdin.setRawMode(false);
            stdin.removeListener("data", onData);
        }

        stdin.on("data", onData);
    });
}

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Set ${name} before running this option.`);
    return value;
}

async function main() {
    try {
        const email = (await askInput("Staff account email: ")).trim();
        const password = await askInput("Password (hidden): ", true);
        const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        });

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error || !data.session?.access_token) {
            console.error("Login failed. Check the email/password or Supabase Auth settings.");
            process.exitCode = 1;
            return;
        }

        if (process.argv.includes("--check-assign-species")) {
            const { error: assignError } = await supabase.rpc(
                "officer_assign_plant_species",
                {
                    p_plant_id: "00000000-0000-0000-0000-000000000000",
                    p_species_id: "00000000-0000-0000-0000-000000000000",
                }
            );

            console.log(assignError ? "Assignment check: rejected" : "Assignment check: unexpected success");
            return;
        }

        const headers = {
            Authorization: `Bearer ${data.session.access_token}`,
        };
        const response = await fetch("http://127.0.0.1:3000/api/me", {
            headers,
        });

        console.log(`/api/me: HTTP ${response.status}`);
        await logResponseSummary(response);

        if (process.argv.includes("--review-queue")) {
            const queueResponse = await fetch(
                "http://127.0.0.1:3000/api/officer/reviews/pending",
                { headers }
            );


            console.log(`GET pending reviews: HTTP ${queueResponse.status}`);

            await logResponseSummary(queueResponse);
            return;
        }

        if (process.argv.includes("--check-officer-species-route")) {
            const assignmentResponse = await fetch(
                "http://127.0.0.1:3000/api/officer/reviews/plants/not-a-uuid/species",
                {
                    method: "PATCH",
                    headers: {
                        ...headers,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        species_id: "00000000-0000-0000-0000-000000000000"
                    })
                }
            );

            console.log(`PATCH species route: HTTP ${assignmentResponse.status}`);
            await logResponseSummary(assignmentResponse);
            return;
        }

        if (process.argv.includes("--check-officer-review-route")) {
            const reviewResponse = await fetch(
                "http://127.0.0.1:3000/api/officer/reviews/00000000-0000-0000-0000-000000000000/decision",
                {
                    method: "POST",
                    headers: {
                        ...headers,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ decision: "approved" })
                }
            );

            console.log(`POST review route: HTTP ${reviewResponse.status}`);
            await logResponseSummary(reviewResponse);
            return;
        }

        if (process.argv.includes("--report-inventory")) {
            const reportResponse = await fetch(
                "http://127.0.0.1:3000/api/reports/inventory",
                { headers }
            );

            console.log(`GET /api/reports/inventory: HTTP ${reportResponse.status}`);
            await logResponseSummary(reportResponse);
            return;
        }

        if (process.argv.includes("--report-status-csv")) {
            const reportResponse = await fetch(
                "http://127.0.0.1:3000/api/reports/status?format=csv",
                { headers }
            );

            console.log(`GET status CSV: HTTP ${reportResponse.status}`);
            console.log("Response headers received; values omitted.");
            await logResponseSummary(reportResponse);
            return;
        }

        if (process.argv.includes("--report-status-pdf")) {
            const reportResponse = await fetch(
                "http://127.0.0.1:3000/api/reports/status?format=pdf",
                { headers }
            );

            console.log(`GET status PDF: HTTP ${reportResponse.status}`);
            console.log("Response headers received; values omitted.");

            if (!reportResponse.ok) {
                await logResponseSummary(reportResponse);
                return;
            }

            const pdfPath = path.join(
                require("node:os").tmpdir(),
                "niah-status-report.pdf"
            );
            fs.writeFileSync(pdfPath, Buffer.from(await reportResponse.arrayBuffer()));
            console.log("Saved PDF in the local temporary directory.");
            return;
        }

        if (process.argv.includes("--report-botanist")) {
            const reportResponse = await fetch(
                "http://127.0.0.1:3000/api/reports/botanist",
                { headers }
            );

            const result = await reportResponse.json();
            console.log(`GET botanist report: HTTP ${reportResponse.status}`);
            console.log(JSON.stringify(responseSummary(JSON.stringify(result))));
            return;
        }

        if (process.argv.includes("--report-date-range")) {
            const reportResponse = await fetch(
                "http://127.0.0.1:3000/api/reports/inventory?from=2026-10-15&to=2026-10-15",
                { headers }
            );

            const result = await reportResponse.json();
            console.log(`GET dated inventory: HTTP ${reportResponse.status}`);
            console.log(JSON.stringify(responseSummary(JSON.stringify(result))));
            return;
        }

        if (process.argv.includes("--create-taxonomy")) {
            const taxonomy = JSON.parse(requiredEnv("KNOWLEDGE_TAXONOMY_JSON"));
            const taxonomyResponse = await fetch(
                "http://127.0.0.1:3000/api/knowledge/taxonomy",
                {
                    method: "POST",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify(taxonomy),
                }
            );

            console.log(`POST taxonomy: HTTP ${taxonomyResponse.status}`);
            await logResponseSummary(taxonomyResponse);
        }

        if (process.argv.includes("--list-manage-species")) {
            const response = await fetch(
                "http://127.0.0.1:3000/api/knowledge/species/manage",
                { headers }
            );

            console.log(`GET manage species list: HTTP ${response.status}`);
            await logResponseSummary(response);
        }

        if (process.argv.includes("--manage-species")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const manageResponse = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}/manage`,
                { headers }
            );

            console.log(`GET manage species: HTTP ${manageResponse.status}`);
            await logResponseSummary(manageResponse);
        }

        if (process.argv.includes("--create-species")) {
            const speciesResponse = await fetch("http://127.0.0.1:3000/api/knowledge/species", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ scientific_name: requiredEnv("KNOWLEDGE_SPECIES_NAME") }),
            });
            console.log(`POST /api/knowledge/species: HTTP ${speciesResponse.status}`);
            await logResponseSummary(speciesResponse);
        }

        if (process.argv.includes("--link-species-taxonomy")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const taxonomyId = requiredEnv("KNOWLEDGE_TAXONOMY_ID");

            const linkResponse = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}`,
                {
                    method: "PATCH",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify({ taxonomy_id: taxonomyId }),
                }
            );

            console.log(`PATCH species taxonomy: HTTP ${linkResponse.status}`);
            await logResponseSummary(linkResponse);
        }

        if (process.argv.includes("--rename-species")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const scientificName = requiredEnv("KNOWLEDGE_SPECIES_NAME");

            const renameResponse = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}`,
                {
                    method: "PATCH",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify({ scientific_name: scientificName }),
                }
            );

            console.log(`PATCH scientific name: HTTP ${renameResponse.status}`);
            await logResponseSummary(renameResponse);
        }

        if (process.argv.includes("--clear-habitat")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");

            const response = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}`,
                {
                    method: "PATCH",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify({ habitat: null }),
                }
            );

            console.log(`PATCH clear habitat: HTTP ${response.status}`);
            await logResponseSummary(response);
        }

        if (process.argv.includes("--edit-species")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const editResponse = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}`,
                {
                    method: "PATCH",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify({ habitat: requiredEnv("KNOWLEDGE_HABITAT") }),
                }
            );
            console.log(`PATCH /api/knowledge/species: HTTP ${editResponse.status}`);
            await logResponseSummary(editResponse);
        }

        if (process.argv.includes("--test-photo")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const photoResponse = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}/photos`,
                { method: "POST", headers }
            );

            console.log(`POST species photo: HTTP ${photoResponse.status}`);
            await logResponseSummary(photoResponse);
        }

        if (process.argv.includes("--upload-species-photo")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const photoPath = requiredEnv("KNOWLEDGE_PHOTO_PATH");
            const extension = path.extname(photoPath).toLowerCase();
            if (![".jpg", ".jpeg", ".png"].includes(extension)) {
                throw new Error("KNOWLEDGE_PHOTO_PATH must point to a JPEG or PNG file.");
            }
            const photoBytes = fs.readFileSync(photoPath);
            const contentType = extension === ".png" ? "image/png" : "image/jpeg";

            const form = new FormData();
            form.append(
                "photo",
                new Blob([photoBytes], { type: contentType }),
                path.basename(photoPath)
            );

            const uploadResponse = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}/photos`,
                { method: "POST", headers, body: form }
            );

            console.log(`POST species photo upload: HTTP ${uploadResponse.status}`);
            await logResponseSummary(uploadResponse);
        }

        if (process.argv.includes("--set-primary-photo")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const photoId = requiredEnv("KNOWLEDGE_PHOTO_ID");

            const primaryResponse = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}/photos/${photoId}/primary`,
                { method: "PATCH", headers }
            );

            console.log(`PATCH primary species photo: HTTP ${primaryResponse.status}`);
            await logResponseSummary(primaryResponse);
        }

        if (process.argv.includes("--delete-species-photo")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const photoId = requiredEnv("KNOWLEDGE_PHOTO_ID");

            const deleteResponse = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}/photos/${photoId}`,
                { method: "DELETE", headers }
            );

            console.log(`DELETE species photo: HTTP ${deleteResponse.status}`);
            await logResponseSummary(deleteResponse);
        }

        if (process.argv.includes("--archive-species")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const archiveResponse = await fetch(
                `http://127.0.0.1:3000/api/knowledge/species/${speciesId}`,
                { method: "DELETE", headers }
            );

            console.log(`DELETE /api/knowledge/species: HTTP ${archiveResponse.status}`);
            await logResponseSummary(archiveResponse);
        }

        const iotResponse = await fetch("http://127.0.0.1:3000/api/iot/summary", {
            headers,
        });
        console.log(`/api/iot/summary: HTTP ${iotResponse.status}`);
        await logResponseSummary(iotResponse);

        if (process.argv.includes("--create-test-plant")) {
            const createResponse = await fetch("http://127.0.0.1:3000/api/plants", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    scientific_name: "Clerodendrum paniculatum",
                    common_name: "Pagoda Flower",
                    latitude: 3.8176,
                    longitude: 113.781,
                    gps_accuracy_m: 5,
                    location_description: "Plant API test record",
                }),
            });
            console.log(`POST /api/plants: HTTP ${createResponse.status}`);
            await logResponseSummary(createResponse);
        }

        const plantsResponse = await fetch("http://127.0.0.1:3000/api/plants", {
            headers,
        });
        console.log(`/api/plants: HTTP ${plantsResponse.status}`);
        await logResponseSummary(plantsResponse);
    } catch (error) {
        console.error("Authentication test failed; remote details omitted.");
        process.exitCode = 1;
    }
}

void main().catch(() => {
    console.error("Authentication test stopped unexpectedly.");
    process.exitCode = 1;
});
