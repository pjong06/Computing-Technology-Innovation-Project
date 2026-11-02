const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { buildPublicPlantUrl } = require("./qrService");

// Generate an A4 PDF containing multiple plant QR tags
async function generateQRBatchPDF(tagValues, { publicBaseUrl } = {}) {
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

    const columns = 3;
    const rows = 5;
    const cellWidth = 170;
    const cellHeight = 140;
    const startX = 42;
    const startY = 55;

    for (let i = 0; i < tagValues.length; i++) {
        if (i > 0 && i % (columns * rows) === 0) {
            doc.addPage();
        }

        const position = i % (columns * rows);
        const col = position % columns;
        const row = Math.floor(position / columns);

        const x = startX + col * cellWidth;
        const y = startY + row * cellHeight;

        const qrBuffer = await QRCode.toBuffer(publicUrls[i], {
            width: 250,
            margin: 4,
            errorCorrectionLevel: "M"
        });

        doc.rect(x, y, cellWidth - 5, cellHeight - 5).stroke();

        doc.image(qrBuffer, x + 35, y + 10, {
            width: 95,
            height: 95
        });

        doc.fontSize(10).text(
            tagValues[i],
            x + 5,
            y + 112,
            {
                width: cellWidth - 15,
                align: "center"
            }
        );
    }

    doc.end();

    return pdfPromise;
}

module.exports = { generateQRBatchPDF };