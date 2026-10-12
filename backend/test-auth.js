const { createClient } = require("@supabase/supabase-js");
const fs = require("node:fs");
const path = require("node:path");
const { stdin, stdout } = require("node:process");
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

        const headers = {
            Authorization: `Bearer ${data.session.access_token}`,
        };
        const response = await fetch("http://localhost:3000/api/me", {
            headers,
        });

        console.log(`/api/me: HTTP ${response.status}`);
        console.log(await response.text());

        if (process.argv.includes("--create-species")) {
            const speciesResponse = await fetch("http://localhost:3000/api/knowledge/species", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ scientific_name: requiredEnv("KNOWLEDGE_SPECIES_NAME") }),
            });
            console.log(`POST /api/knowledge/species: HTTP ${speciesResponse.status}`);
            console.log(await speciesResponse.text());
        }

        if (process.argv.includes("--edit-species")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const editResponse = await fetch(
                `http://localhost:3000/api/knowledge/species/${speciesId}`,
                {
                    method: "PATCH",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify({ habitat: requiredEnv("KNOWLEDGE_HABITAT") }),
                }
            );
            console.log(`PATCH /api/knowledge/species: HTTP ${editResponse.status}`);
            console.log(await editResponse.text());
        }

        if (process.argv.includes("--test-photo")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const photoResponse = await fetch(
                `http://localhost:3000/api/knowledge/species/${speciesId}/photos`,
                { method: "POST", headers }
            );

            console.log(`POST species photo: HTTP ${photoResponse.status}`);
            console.log(await photoResponse.text());
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
                `http://localhost:3000/api/knowledge/species/${speciesId}/photos`,
                { method: "POST", headers, body: form }
            );

            console.log(`POST species photo upload: HTTP ${uploadResponse.status}`);
            console.log(await uploadResponse.text());
        }

        if (process.argv.includes("--archive-species")) {
            const speciesId = requiredEnv("KNOWLEDGE_SPECIES_ID");
            const archiveResponse = await fetch(
                `http://localhost:3000/api/knowledge/species/${speciesId}`,
                { method: "DELETE", headers }
            );

            console.log(`DELETE /api/knowledge/species: HTTP ${archiveResponse.status}`);
            console.log(await archiveResponse.text());
        }

        const iotResponse = await fetch("http://localhost:3000/api/iot/summary", {
            headers,
        });
        console.log(`/api/iot/summary: HTTP ${iotResponse.status}`);
        console.log(await iotResponse.text());

        if (process.argv.includes("--create-test-plant")) {
            const createResponse = await fetch("http://localhost:3000/api/plants", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    scientific_name: "RBAC test plant",
                    common_name: "Temporary test record",
                    latitude: 0,
                    longitude: 0,
                    gps_accuracy_m: 0,
                }),
            });
            console.log(`POST /api/plants: HTTP ${createResponse.status}`);
            console.log(await createResponse.text());
        }

        const plantsResponse = await fetch("http://localhost:3000/api/plants", {
            headers,
        });
        console.log(`/api/plants: HTTP ${plantsResponse.status}`);
        console.log(await plantsResponse.text());
    } catch (error) {
        console.error(error.message || "Authentication test failed.");
        process.exitCode = 1;
    }
}

main();
