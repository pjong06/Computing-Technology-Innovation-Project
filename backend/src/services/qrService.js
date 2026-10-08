const QRCode = require("qrcode");

async function generatePlantQR(plantId) {
    const qrValue = `plant:${plantId}`;

    const qrCode = await QRCode.toDataURL(qrValue);

    return {
        qrValue: qrValue,
        qrCode: qrCode
    };
}

module.exports = {
    generatePlantQR
};