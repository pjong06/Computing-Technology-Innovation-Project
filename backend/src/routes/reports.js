const express = require("express");
const PDFDocument = require("pdfkit");
const { requireAuth, requireRole } = require("../middleware/auth");
const { buildReport, buildSummary, ReportError, REPORT_TYPES, dayText, dayTimeText } = require("../services/reportService");

const router = express.Router();
const reportTypes = new Set(REPORT_TYPES);
const formats = new Set(["json", "csv", "pdf"]);
// The PDF never prints coordinates (the older "locations" type has them in its data).
const COORDINATE_KEYS = new Set(["latitude", "longitude", "lat", "lng", "location"]);
// Date columns read "1 Nov 2026" in the PDF (the CSV keeps YYYY-MM-DD, which sorts).
const DATE_KEYS = new Set(["first_recorded", "observed_at", "last_observation"]);
const pdfValue = (key, value) => (DATE_KEYS.has(key) && /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))
    ? dayText(`${value}T12:00:00Z`)
    : String(value ?? ""));

function validDate(value) {
    if (value === undefined) return true;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+@-]/.test(text.trimStart()) && !/^-\d/.test(text.trimStart())) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function fileName(report, extension) {
    const names = { inventory: "species-inventory", plants: "plant-records", botanist: "field-observations", alerts: "iot-alerts" };
    return `niah-${names[report.type] || report.type}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

// CSV: the applied filters as the first line, then the same columns as the table.
function sendCsv(res, report) {
    const lines = [
        csvCell(`${report.title} · ${report.filters_text}`),
        report.columns.map(column => csvCell(column.label)).join(","),
    ];
    for (const row of report.rows) {
        lines.push(report.columns.map(column => csvCell(row[column.key])).join(","));
    }
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${fileName(report, "csv")}"`);
    return res.send(`﻿${lines.join("\r\n")}\r\n`);
}

// ---- PDF ----
const PDF = { margin: 36, header: 9, title: 18, text: 9, table: 8, rowPad: 4 };
const FOOTER_NOTE = "Locations are not included. Confidential: for SFC staff use.";

function pdfColumns(report, width) {
    const columns = report.columns.filter(column => !COORDINATE_KEYS.has(column.key));
    // Wider columns for names and notes; the rest share what is left.
    const weights = columns.map(column => (["scientific_name", "note", "location_note", "common_name"].includes(column.key) ? 2 : 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return columns.map((column, index) => ({ ...column, width: (width * weights[index]) / total }));
}

function drawTableHeader(pdf, columns, x, y) {
    pdf.font("Helvetica-Bold").fontSize(PDF.table);
    const height = Math.max(...columns.map(column => pdf.heightOfString(column.label, { width: column.width - 6 }))) + PDF.rowPad * 2;
    pdf.rect(x, y, columns.reduce((sum, column) => sum + column.width, 0), height).fill("#E8EFEA");
    let left = x;
    pdf.fillColor("#1E2B22");
    for (const column of columns) {
        pdf.text(column.label, left + 3, y + PDF.rowPad, { width: column.width - 6 });
        left += column.width;
    }
    pdf.font("Helvetica");
    return y + height;
}

function sendPdf(res, report, officerName) {
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${fileName(report, "pdf")}"`);
    const pdf = new PDFDocument({ size: "A4", layout: "landscape", margin: PDF.margin, bufferPages: true });
    pdf.pipe(res);
    const width = pdf.page.width - PDF.margin * 2;
    const bottom = pdf.page.height - PDF.margin - 28;

    pdf.fillColor("#46654F").fontSize(PDF.header).text("Niah BioTrack · Sarawak Forestry Corporation");
    pdf.moveDown(0.4).fillColor("#1E2B22").font("Helvetica-Bold").fontSize(PDF.title).text(report.title);
    pdf.font("Helvetica").fontSize(PDF.text).fillColor("#526158")
        .text(`Generated ${dayTimeText(new Date())} by ${officerName}`);
    pdf.text(report.filters_text);
    pdf.moveDown(0.6);

    // Summary figures.
    const figures = (report.summary || []).slice(0, 4);
    if (figures.length) {
        const boxWidth = (width - 12 * (figures.length - 1)) / figures.length;
        const top = pdf.y;
        figures.forEach((figure, index) => {
            const left = PDF.margin + index * (boxWidth + 12);
            pdf.roundedRect(left, top, boxWidth, 40, 4).fill("#F3F6F4");
            pdf.fillColor("#1E2B22").font("Helvetica-Bold").fontSize(14).text(String(figure.value), left + 8, top + 6, { width: boxWidth - 16 });
            pdf.font("Helvetica").fontSize(8).fillColor("#526158").text(figure.label, left + 8, top + 25, { width: boxWidth - 16 });
        });
        pdf.y = top + 52;
    }

    // The table, its header repeated on each page.
    const columns = pdfColumns(report, width);
    let y = drawTableHeader(pdf, columns, PDF.margin, pdf.y);
    pdf.fontSize(PDF.table).fillColor("#1E2B22");
    if (report.rows.length === 0) {
        pdf.text("No records match this selection.", PDF.margin, y + 6);
    }
    report.rows.forEach((row, index) => {
        const height = Math.max(...columns.map(column =>
            pdf.heightOfString(pdfValue(column.key, row[column.key]), { width: column.width - 6 }))) + PDF.rowPad * 2;
        if (y + height > bottom) {
            pdf.addPage();
            y = drawTableHeader(pdf, columns, PDF.margin, PDF.margin);
            pdf.fontSize(PDF.table);
        }
        if (index % 2 === 1) pdf.rect(PDF.margin, y, width, height).fill("#FAFBFA");
        pdf.fillColor("#1E2B22");
        let left = PDF.margin;
        for (const column of columns) {
            const text = pdfValue(column.key, row[column.key]);
            pdf.font(column.key === "scientific_name" && text ? "Helvetica-Oblique" : "Helvetica")
                .text(text, left + 3, y + PDF.rowPad, { width: column.width - 6 });
            left += column.width;
        }
        y += height;
    });

    // Footer on every page: the note and "Page N of M".
    const range = pdf.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
        pdf.switchToPage(range.start + index);
        const footerY = pdf.page.height - PDF.margin - 12;
        pdf.font("Helvetica").fontSize(8).fillColor("#68776D");
        pdf.text(FOOTER_NOTE, PDF.margin, footerY, { width: width / 2, lineBreak: false });
        pdf.text(`Page ${index + 1} of ${range.count}`, PDF.margin + width / 2, footerY, { width: width / 2, align: "right", lineBreak: false });
    }
    pdf.end();
}

async function officerName(req) {
    try {
        const { data } = await req.supabase.from("profiles").select("full_name").eq("id", req.user.id).maybeSingle();
        return data?.full_name || "a conservation officer";
    } catch {
        return "a conservation officer";
    }
}

router.get("/summary", requireAuth, requireRole("officer"), async (req, res) => {
    try {
        return res.json({ data: await buildSummary(req.supabase) });
    } catch (error) {
        if (!(error instanceof ReportError)) {
            console.error("Report summary generation error:", error);
        }
        return res.status(500).json({ message: "Could not load report summary" });
    }
});

// Only officers can see reports containing drafts, pending reviews, and staff names.
// ?from&to (dates), ?status, ?q (search), ?sort and ?format=json|csv|pdf: the table and both
// exports contain exactly the same rows.
router.get("/:type", requireAuth, requireRole("officer"), async (req, res) => {
    const { type } = req.params;
    const { from, to, format = "json", status, sort, q } = req.query;
    if (!reportTypes.has(type)) {
        return res.status(404).json({ message: "Unknown report type" });
    }
    if (!validDate(from) || !validDate(to) ||
        (from && to && from > to) ||
        typeof format !== "string" || !formats.has(format)) {
        return res.status(400).json({ message: "Invalid report dates or format" });
    }
    const optional = (value) => (value === undefined || value === "" ? undefined : value);

    try {
        const report = await buildReport(req.supabase, type, from, to, {
            status: optional(status), sort: optional(sort), q: optional(q),
        });
        if (format === "csv") return sendCsv(res, report);
        if (format === "pdf") return sendPdf(res, report, await officerName(req));
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
