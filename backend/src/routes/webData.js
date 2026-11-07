const express = require("express");
const { randomUUID } = require("crypto");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFICER_ONLY_MESSAGE = "Only the officer can change the website data";

router.use(requireAuth);

function isOfficer(req) {
    return !!req.profile && req.profile.role === "officer";
}

function textOf(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function extraOf(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return JSON.stringify(value).length > 100000 ? {} : value;
}

function cleanUser(item, index) {
    const row = {
        id: typeof item.id === "string" && uuidPattern.test(item.id) ? item.id : randomUUID(),
        name: textOf(item.name, 200),
        username: textOf(item.username, 100),
        email: textOf(item.email, 200),
        role: textOf(item.role, 100),
        active: item.active !== false,
        extra: extraOf(item.extra),
        sort_order: index,
    };
    if (row.email === "") return { error: "Every record needs an email" };
    return { row };
}

router.get("/users", async (req, res) => {
    if (!isOfficer(req)) {
        return res.json({ data: [] });
    }

    const { data, error } = await req.supabase
        .from("website_users")
        .select("*")
        .order("sort_order", { ascending: true });

    if (error) {
        console.error("Website users load error:", error);
        return res.status(500).json({ message: "Could not load the users" });
    }
    return res.json({ data });
});

router.put("/users", async (req, res) => {
    if (!isOfficer(req)) {
        return res.status(403).json({ message: OFFICER_ONLY_MESSAGE });
    }
    const incoming = req.body && req.body.rows;
    if (!Array.isArray(incoming) || incoming.length > 2000) {
        return res.status(400).json({ message: "A list of users is required" });
    }

    const rows = [];
    const seen = new Set();
    for (let i = 0; i < incoming.length; i++) {
        const result = cleanUser(incoming[i] || {}, i);
        if (result.error) {
            return res.status(400).json({ message: result.error });
        }
        if (seen.has(result.row.id)) {
            return res.status(400).json({ message: "Two records have the same id" });
        }
        seen.add(result.row.id);
        rows.push(result.row);
    }

    if (rows.length > 0) {
        const { error } = await req.supabase
            .from("website_users")
            .upsert(rows, { onConflict: "id" });
        if (error) {
            console.error("Website users save error:", error);
            return res.status(500).json({ message: "Could not save the users" });
        }
    }

    const removed = Array.isArray(req.body.removed) ? req.body.removed : [];
    const removedIds = removed.filter(id => typeof id === "string" && uuidPattern.test(id));
    if (removedIds.length > 0) {
        const { error } = await req.supabase
            .from("website_users")
            .delete()
            .in("id", removedIds);
        if (error) {
            console.error("Website users remove error:", error);
            return res.status(500).json({ message: "Could not remove the deleted users" });
        }
    }

    return res.json({ data: rows });
});

module.exports = router;
