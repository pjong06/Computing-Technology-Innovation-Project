const express = require("express");
const PDFDocument = require("pdfkit");
const { requireAuth, requireRole } = require("../middleware/auth");
const { buildReport, ReportError } = require("../services/reportService");

const router = express.Router();
const reportTypes = new Set(["inventory", "status", "botanist"]);
const formats = new Set(["json", "csv", "pdf"]);

function validDate(value) {
    if (value === undefined) return true;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+@-]/.test(text.trimStart())) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function sendCsv(res, report) {
    const lines = [report.columns.map(column => csvCell(column.label)).join(",")];
    for (const row of report.rows) {
        lines.push(report.columns.map(column => csvCell(row[column.key])).join(","));
    }
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="niah-${report.type}-${Date.now()}.csv"`);
    return res.send(`\uFEFF${lines.join("\r\n")}\r\n`);
}

function sendPdf(res, report) {
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="niah-${report.type}-${Date.now()}.pdf"`);
    const pdf = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    pdf.pipe(res);
    pdf.fontSize(18).text(report.title);
    pdf.moveDown(0.3).fontSize(9).text(`Generated ${report.generated_at} | ${report.total} row(s)`);
    pdf.text(report.note);
    pdf.moveDown();

    if (report.rows.length === 0) pdf.text("No records match this selection.");
    for (const row of report.rows) {
        const text = report.columns
            .map(column => `${column.label}: ${String(row[column.key] ?? "")}`)
            .join("    |    ");
        pdf.fontSize(9).text(text, { width: 760 });
        pdf.moveDown(0.3);
    }
    pdf.end();
}

// Only officers can see reports containing drafts, pending reviews, and staff names.
router.get("/:type", requireAuth, requireRole("officer"), async (req, res) => {
    const { type } = req.params;
    const { from, to, format = "json" } = req.query;
    if (!reportTypes.has(type)) {
        return res.status(404).json({ message: "Unknown report type" });
    }
    if (!validDate(from) || !validDate(to) ||
        (from && to && from > to) ||
        typeof format !== "string" || !formats.has(format)) {
        return res.status(400).json({ message: "Invalid report dates or format" });
    }

    try {
        const report = await buildReport(req.supabase, type, from, to);
        if (format === "csv") return sendCsv(res, report);
        if (format === "pdf") return sendPdf(res, report);
        return res.json({ data: report });
    } catch (error) {
        if (error instanceof ReportError) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error("Report generation error:", error);
        return res.status(500).json({ message: "Could not generate report" });
    }
});

module.exports = router;
