"use strict";

// qrLabelService.js - one QR label as a PNG: the plant's QR code with its tag written
// underneath (e.g. NIAH-PLT-00031), on white with a margin, 1000 px wide.
//
// The tag text is drawn with a small built-in block font (only the characters a tag can
// have), so the label looks the same on every server and never depends on installed fonts.
// sharp (already used for photos) turns the drawing into a PNG.

const QRCode = require("qrcode");
const sharp = require("sharp");
const { buildPublicPlantUrl, TAG_PATTERN } = require("./qrService");

const LABEL_WIDTH = 1000;
const QR_SIZE = 860; // includes the QR code's own white quiet zone
const QR_TOP = 50;
const DOT = 10; // size of one block of the tag text
const TEXT_TOP = QR_TOP + QR_SIZE + 40;
const LABEL_HEIGHT = TEXT_TOP + 7 * DOT + 60;

// 5 x 7 blocks per character.
const GLYPHS = {
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    3: ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

// The tag as SVG blocks, centred in a LABEL_WIDTH-wide strip.
function tagTextSvg(tag) {
    const advance = 6 * DOT; // 5 blocks + 1 gap
    const width = tag.length * advance - DOT;
    const left = Math.round((LABEL_WIDTH - width) / 2);
    const rects = [];
    [...tag].forEach((char, index) => {
        const glyph = GLYPHS[char];
        glyph.forEach((row, y) => {
            [...row].forEach((bit, x) => {
                if (bit === "1") {
                    rects.push(`<rect x="${left + index * advance + x * DOT}" y="${y * DOT}" width="${DOT}" height="${DOT}"/>`);
                }
            });
        });
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH}" height="${7 * DOT}"><g fill="#000">${rects.join("")}</g></svg>`;
}

async function generateQrLabelPng(tag, { publicBaseUrl } = {}) {
    if (typeof tag !== "string" || !TAG_PATTERN.test(tag)) throw new Error("Invalid plant QR tag");
    const publicUrl = buildPublicPlantUrl(tag, publicBaseUrl);
    const qr = await QRCode.toBuffer(publicUrl, { width: QR_SIZE, margin: 2, errorCorrectionLevel: "M" });
    return sharp({
        create: { width: LABEL_WIDTH, height: LABEL_HEIGHT, channels: 3, background: "#ffffff" },
    })
        .composite([
            { input: qr, left: Math.round((LABEL_WIDTH - QR_SIZE) / 2), top: QR_TOP },
            { input: Buffer.from(tagTextSvg(tag)), left: 0, top: TEXT_TOP },
        ])
        .png()
        .toBuffer();
}

module.exports = { generateQrLabelPng, LABEL_WIDTH, LABEL_HEIGHT };
