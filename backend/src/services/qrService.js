const QRCode = require("qrcode");

const TAG_PATTERN = /^NIAH-PLT-\d{5}$/;

class QrConfigurationError extends Error {
    constructor() {
        super("Configure PUBLIC_PLANT_BASE_URL before generating QR codes");
        this.name = "QrConfigurationError";
    }
}

// A tag as people type or scan it -> "NIAH-PLT-00015", or null. Accepts any letter case,
// missing or different separators ("niahplt00015", "NIAH PLT 00015", "niah_plt-00015") and
// a scanned URL ending in the tag. The same rule as parseTagCode in the app.
function normalizePlantTag(raw) {
    if (typeof raw !== "string") return null;
    let value = raw.trim();
    if (value.includes("/")) value = value.split("/").pop() || "";
    const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const match = /^NIAHPLT(\d{5})$/.exec(compact);
    return match ? `NIAH-PLT-${match[1]}` : null;
}

function formatPlantTag(number) {
    if (!Number.isSafeInteger(number) || number < 1 || number > 99999) {
        throw new Error("Invalid plant tag number");
    }
    return `NIAH-PLT-${String(number).padStart(5, "0")}`;
}

function isLocalHost(hostname) {
    if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return true;
    const octets = hostname.split('.').map(Number);
    if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    return octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

// One canonical payload for individual PNGs and batch PDFs. Never derive the host from a request.
function buildPublicPlantUrl(tag, baseUrl = process.env.PUBLIC_PLANT_BASE_URL) {
    if (typeof tag !== "string" || !TAG_PATTERN.test(tag)) throw new Error("Invalid plant QR tag");
    let base;
    try { base = new URL(baseUrl); } catch { throw new QrConfigurationError(); }
    const localHttp = process.env.NODE_ENV !== 'production' &&
        base.protocol === 'http:' && isLocalHost(base.hostname);
    const prefix = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
    if ((base.protocol !== 'https:' && !localHttp) || base.username || base.password ||
        base.search || base.hash || !prefix.endsWith('/p')) throw new QrConfigurationError();
    base.pathname = `${prefix}/${tag}`;
    return base.href;
}

async function generatePlantQR(qrValue, { publicBaseUrl } = {}) {
    const publicUrl = buildPublicPlantUrl(qrValue, publicBaseUrl);
    const qrCode = await QRCode.toDataURL(publicUrl, { errorCorrectionLevel: 'M', margin: 4 });
    // Keep the stored tag contract; callers can additionally display/copy the public URL.
    return { qrValue, qrCode, publicUrl };
}

module.exports = { formatPlantTag, normalizePlantTag, generatePlantQR, buildPublicPlantUrl, TAG_PATTERN, QrConfigurationError };
