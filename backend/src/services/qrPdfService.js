const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { buildPublicPlantUrl } = require("./qrService");

// The two ways to print QR labels on A4:
//   "sheet"  - a grid of 3 x 5 labels per page, with light dashed cut lines between them
//   "single" - one large label per page
const PDF_LAYOUTS = ["sheet", "single"];

// Generate an A4 PDF containing multiple plant QR tags
async function generateQRBatchPDF(tagValues, { publicBaseUrl, layout = "sheet" } = {}) {
    if (
        !Array.isArray(tagValues) ||
        tagValues.length === 0 ||
        tagValues.length > 100 ||
        tagValues.some(
            tag => typeof tag !== "string" ||
            !/^NIAH-PLT-\d{5}$/.test(tag)
        ) ||
        new Set(tagValues).size !== tagValues.length
    ) {
        throw new Error("Invalid or duplicate plant tags");
    }
    if (!PDF_LAYOUTS.includes(layout)) {
        throw new Error("Invalid PDF layout");
    }

    // Validate the configured destination before creating a PDF stream.
    const publicUrls = tagValues.map(tag => buildPublicPlantUrl(tag, publicBaseUrl));

    const doc = new PDFDocument({
        size: "A4",
        margin: 40
    });

    const chunks = [];

    doc.on("data", chunk => chunks.push(chunk));

    const pdfPromise = new Promise((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
    });

    if (layout === "single") {
        await drawOneLabelPerPage(doc, tagValues, publicUrls);
    } else {
        await drawSheetOfLabels(doc, tagValues, publicUrls);
    }

    doc.end();

    return pdfPromise;
}

async function drawSheetOfLabels(doc, tagValues, publicUrls) {
    const columns = 3;
    const rows = 5;
    const perPage = columns * rows;
    const cellWidth = 170;
    const cellHeight = 140;
    const startX = 42;
    const startY = 55;

    for (let i = 0; i < tagValues.length; i++) {
        if (i > 0 && i % perPage === 0) {
            doc.addPage();
        }

        const position = i % perPage;
        const col = position % columns;
        const row = Math.floor(position / columns);

        const x = startX + col * cellWidth;
        const y = startY + row * cellHeight;

        const qrBuffer = await QRCode.toBuffer(publicUrls[i], {
            width: 250,
            margin: 4,
            errorCorrectionLevel: "M"
        });

        doc.image(qrBuffer, x + 37, y + 12, {
            width: 95,
            height: 95
        });

        doc.fillColor("#000000").fontSize(10).text(
            tagValues[i],
            x + 5,
            y + 114,
            {
                width: cellWidth - 10,
                align: "center"
            }
        );

        // Light dashed cut lines around the label on this page's grid.
        const onPage = Math.min(perPage, tagValues.length - (i - position));
        if (position === onPage - 1) {
            drawCutLines(doc, { startX, startY, cellWidth, cellHeight, columns, count: onPage });
        }
    }
}

// The cut lines for the `count` labels on one page: the outline of every label, drawn once.
function drawCutLines(doc, { startX, startY, cellWidth, cellHeight, columns, count }) {
    doc.save();
    doc.lineWidth(0.5).strokeColor("#B5B5B5").dash(4, { space: 3 });
    for (let index = 0; index < count; index++) {
        const x = startX + (index % columns) * cellWidth;
        const y = startY + Math.floor(index / columns) * cellHeight;
        doc.rect(x, y, cellWidth, cellHeight).stroke();
    }
    doc.undash();
    doc.restore();
}

async function drawOneLabelPerPage(doc, tagValues, publicUrls) {
    const pageWidth = doc.page.width;
    const size = 340;
    const x = (pageWidth - size) / 2;
    const y = 170;

    for (let i = 0; i < tagValues.length; i++) {
        if (i > 0) doc.addPage();

        const qrBuffer = await QRCode.toBuffer(publicUrls[i], {
            width: 800,
            margin: 4,
            errorCorrectionLevel: "M"
        });

        doc.image(qrBuffer, x, y, { width: size, height: size });

        doc.fillColor("#000000").fontSize(28).text(tagValues[i], 40, y + size + 24, {
            width: pageWidth - 80,
            align: "center"
        });
    }
}

module.exports = { generateQRBatchPDF, PDF_LAYOUTS };
