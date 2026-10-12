const QRCode = require("qrcode");

// Convert a tag number into the required format
function formatPlantTag(number) {
    if (!Number.isSafeInteger(number) || number < 1 || number > 99999) {
        throw new Error("Invalid plant tag number");
    }

    return `NIAH-PLT-${String(number).padStart(5, "0")}`;
}

// Generate a QR code from an existing plant tag
async function generatePlantQR(qrValue) {
    if (
        typeof qrValue !== "string" ||
        !/^NIAH-PLT-\d{5}$/.test(qrValue)
    ) {
        throw new Error("Invalid plant QR tag");
    }

    const qrCode = await QRCode.toDataURL(qrValue);

    return {
        qrValue,
        qrCode
    };
}

module.exports = {
    formatPlantTag,
    generatePlantQR
};