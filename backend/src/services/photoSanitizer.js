"use strict";

// photoSanitizer.js - every photo stored through the backend is re-encoded first, so no
// file keeps the camera's metadata (EXIF with GPS position, XMP, maker notes, ICC profiles).
//
// sharp writes only the pixels: without withMetadata()/keepExif()/keepIccProfile() the
// output has no EXIF, XMP or IPTC, and colour is converted to sRGB without embedding a
// profile. rotate() first applies the EXIF orientation, so the photo still shows upright.

const sharp = require("sharp");

const MAX_INPUT_PIXELS = 25_000_000;
const FORMAT_FOR_MIME = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

class InvalidPhotoError extends Error {
    constructor(message) {
        super(message);
        this.name = "InvalidPhotoError";
    }
}

// Returns a fresh JPEG (at most maxSide pixels on the long side) without any metadata.
// expectedMime: the type the client declared; the content must match it.
async function stripPhotoMetadata(buffer, { expectedMime, maxSide = 2000, quality = 85 } = {}) {
    let metadata;
    try {
        metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
        throw new InvalidPhotoError("Invalid photo");
    }
    const expectedFormat = expectedMime ? FORMAT_FOR_MIME[expectedMime] : null;
    if (!["jpeg", "png", "webp"].includes(metadata.format) ||
        (expectedFormat && metadata.format !== expectedFormat)) {
        throw new InvalidPhotoError("The photo content must match its JPEG, PNG or WebP type");
    }
    try {
        return await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
            .rotate()
            .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality })
            .toBuffer();
    } catch {
        throw new InvalidPhotoError("Invalid photo");
    }
}

module.exports = { stripPhotoMetadata, InvalidPhotoError };
