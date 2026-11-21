const express = require('express');
const path = require('node:path');
const { TAG_PATTERN } = require('../services/qrService');
const { publicPlantPhotoExists, publicPhotoUrl, readPublicPlantPhoto, PUBLIC_THUMBNAIL_MAX_SIDE } = require('../services/publicPlantPhotos');
const { cleanSpeciesText, SPECIES_TEXT_FIELDS } = require('../utils/speciesDescription');

const STYLES = `
:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#20392d;background:#f3f4ec}
*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:820px;margin:auto;padding:24px 28px}
header{display:flex;justify-content:space-between;gap:20px;align-items:center;padding-top:30px}
.brand{display:block;width:160px;height:auto;max-width:100%}.place{font-size:13px;color:#516353}
main{padding-top:48px;padding-bottom:56px}.tag{font-size:14px;font-weight:650;color:#48604e;overflow-wrap:anywhere}
h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-style:italic;font-size:clamp(36px,7vw,62px);line-height:1.08;margin:18px 0 14px;overflow-wrap:anywhere}
.common{font-size:23px;margin:0 0 10px}.local{color:#516353;margin:0}.status{display:inline-block;margin:28px 0 12px;padding:9px 14px;background:#dfebcf;font-size:14px;font-weight:650}
section{margin-top:34px;max-width:68ch}section section{margin-top:22px}h2{font-size:18px;line-height:1.4;margin:0 0 10px}h3{font-size:15px;line-height:1.4;margin:0 0 8px;color:#355241}.part>.status{margin-top:4px}p{line-height:1.75;margin:0;white-space:pre-line;overflow-wrap:anywhere}
.plant-photo{margin:24px 0 0;max-width:540px}.plant-photo img{display:block;width:100%;height:auto;border-radius:10px;background:#dfebcf}
.demo{margin:20px 0;padding:16px 18px;background:#f5e8c9;color:#574421;font-size:15px;line-height:1.6}footer{color:#516353;font-size:13px;padding-bottom:38px}.notice{margin-top:20px;font-size:14px;color:#516353}
@media(max-width:480px){header,main,footer{padding-left:22px;padding-right:22px}header{align-items:flex-start;flex-direction:column;gap:8px}main{padding-top:24px}.common{font-size:21px}}
`;
const PUBLIC_FIELDS = ['scientific_name', 'common_name', 'local_name', 'description',
    'morphology', 'habitat', 'conservation_status', 'cultural_significance'];
const STATUS_NAMES = { LC: 'Least Concern', NT: 'Near Threatened', VU: 'Vulnerable',
    EN: 'Endangered', CR: 'Critically Endangered', DD: 'Data Deficient', NE: 'Not Evaluated' };

function escapeHtml(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function documentHtml(title, content) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} | Niah Biotrack</title>
<link rel="icon" type="image/png" href="/public-assets/logo.png">
<link rel="stylesheet" href="/public-assets/plant.css"></head><body>
<header><img class="brand" src="/public-assets/logo.png" alt="Niah Biotrack"><span class="place">Plant reference | Niah National Park</span></header>
<main>${content}</main><footer>Public plant information. Exact locations are not shown on this page.</footer></body></html>`;
}

// The plant's own main photo, when it has a public copy: served by GET /p/:tag/photo
// (stripped, at most 1200 px). Never a storage path or signed link, and never a species
// reference photo.
function publicPlantHtml(tag, row, hasPhoto = false) {
    // Explicit allowlist: never serialize the RPC result, staff identity or coordinates into HTML.
    const plant = Object.fromEntries(PUBLIC_FIELDS.map(key => [key,
        typeof row[key] === 'string'
            ? (SPECIES_TEXT_FIELDS.includes(key) ? cleanSpeciesText(row[key]) : row[key]).slice(0, 10000)
            : '']));
    const isDemo = Object.values(plant).some(value => /\bDEMO\b/i.test(value));
    const status = plant.conservation_status.trim();
    const statusLabel = STATUS_NAMES[status] || status || 'Not assessed';
    // "About this species": true of every plant of this species.
    const speciesSections = [['Description', plant.description], ['Appearance', plant.morphology],
        ['Habitat', plant.habitat], ['Cultural significance', plant.cultural_significance]];
    return documentHtml(plant.scientific_name || 'Plant information',
        `<div class="tag">${escapeHtml(tag)}</div>` +
        (isDemo ? '<aside class="demo"><strong>Demonstration record</strong><br>Not real research data. Approved status is for demonstration only and does not represent officer review.</aside>' : '') +
        `<h1>${escapeHtml(plant.scientific_name || 'Plant information')}</h1>` +
        (plant.common_name ? `<p class="common">${escapeHtml(plant.common_name)}</p>` : '') +
        (plant.local_name ? `<p class="local">Local name: ${escapeHtml(plant.local_name)}</p>` : '') +
        // This plant: the one in front of the visitor, shown only when it has a photo (its tag
        // is already at the top of the page).
        (hasPhoto ? '<section class="part"><h2>This plant</h2>' +
            `<figure class="plant-photo"><img src="/p/${escapeHtml(tag)}/photo" alt="${escapeHtml(plant.scientific_name || 'Plant')}, plant ${escapeHtml(tag)}"></figure>` +
            '</section>' : '') +
        // About this species.
        '<section class="part"><h2>About this species</h2>' +
        `<div class="status">Conservation status: ${escapeHtml(statusLabel)}</div>` +
        speciesSections.filter(([, value]) => value.trim()).map(([label, value]) =>
            `<section><h3>${label}</h3><p>${escapeHtml(value)}</p></section>`).join('') +
        (!plant.description.trim() ? '<p class="notice">A species description has not yet been provided.</p>' : '') +
        '</section>');
}

const { publicQrData } = require('../middleware/publicQrProtection');

const PENDING_MESSAGE = 'This plant is being verified by Sarawak Forestry. Check back later.';

async function lookupPublicPlant(database, tag) {
    const { data, error } = await database.rpc('public_plant_by_qr_v2', { p_qr: tag });
    if (error) throw error;
    if (Array.isArray(data) && data.length) return { status: 'found', plant: data[0] };
    if (!TAG_PATTERN.test(tag)) return { status: 'not-found' };

    const result = await database.rpc('public_plant_tag_is_pending', { p_qr: tag });
    // The previous response remains available while the migration awaits rollout.
    if (result.error && result.error.code !== 'PGRST202') throw result.error;
    return { status: result.data === true && !result.error ? 'pending' : 'not-found' };
}

function createPublicQrHandler(database) {
    return async (req, res) => {
        const tag = typeof req.query.code === 'string' ? req.query.code.trim() : '';
        if (!tag || tag.length > 120) {
            return res.status(400).json({ message: 'Valid QR code is required' });
        }

        try {
            const result = await lookupPublicPlant(database, tag);
            if (result.status === 'pending') {
                return res.status(404).json({ code: 'plant_pending_verification', message: PENDING_MESSAGE });
            }
            if (result.status === 'not-found') {
                return res.status(404).json({ message: 'Approved plant not found' });
            }
            const data = publicQrData(result.plant);
            // The plant's own photo, as the visitor endpoint's address (never a storage path).
            const tagCode = result.plant.qr_code_value;
            data.photo_url = await publicPlantPhotoExists(database, tagCode) ? publicPhotoUrl(tagCode) : null;
            return res.json({ data });
        } catch (error) {
            console.error('Public QR lookup error:', error);
            return res.status(500).json({ message: 'Could not load plant information' });
        }
    };
}

function createPublicPlantsRouter({ client } = {}) {
    const router = express.Router();
    // A bounded process-local limit supplements, but does not replace, deployment-level rate limits.
    const requests = new Map();
    router.use(['/p', '/public-assets'], (_req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
        next();
    });
    router.get('/public-assets/plant.css', (_req, res) => res.type('css').send(STYLES));
    router.get('/public-assets/logo.png', (_req, res) =>
        res.sendFile(path.join(__dirname, '../../../frontend/images/logo.png')));
    // The visitor rate limit, shared by the plant page and its photo (60 a minute per address).
    // Returns null when the request may go ahead, otherwise the seconds to wait (or 0 when
    // too many visitors are being tracked).
    function visitorLimit(req) {
        const now = Date.now();
        for (const [key, value] of requests) if (value.until <= now) requests.delete(key);
        let bucket = requests.get(req.ip);
        if (!bucket) {
            if (requests.size >= 10000) return 0;
            bucket = { count: 0, until: now + 60000 }; requests.set(req.ip, bucket);
        }
        bucket.count++;
        return bucket.count > 60 ? Math.max(1, Math.ceil((bucket.until - now) / 1000)) : null;
    }
    const database = () => client || require('../config/supabase').publicClient;

    router.get('/p/:tag', async (req, res) => {
        const tag = req.params.tag;
        const errorPage = (status, title, message) => res.status(status).type('html')
            .send(documentHtml(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`));
        if (!TAG_PATTERN.test(tag)) return errorPage(400, 'Plant tag not recognised', "This QR code isn't a Niah plant tag.");
        const wait = visitorLimit(req);
        if (wait !== null) {
            if (wait > 0) res.set('Retry-After', String(wait));
            return errorPage(429, 'Please try again later', 'Too many requests.');
        }
        try {
            const result = await lookupPublicPlant(database(), tag);
            if (result.status === 'pending') return errorPage(404, 'Being verified', PENDING_MESSAGE);
            if (result.status === 'not-found') {
                return errorPage(404, 'Plant information unavailable', "Information about this plant isn't available yet.");
            }
            const hasPhoto = await publicPlantPhotoExists(database(), tag);
            return res.type('html').send(publicPlantHtml(tag, result.plant, hasPhoto));
        } catch {
            return errorPage(503, 'Temporarily unavailable', 'Plant information could not be loaded. Please try again later.');
        }
    });

    // The plant's own main photo for visitors: only while the plant is on the public QR page
    // (approved, active, approved species and visit). A fresh JPEG (at most 1200 px) without
    // any metadata. Anything else is 404, the same answer for every reason.
    router.get('/p/:tag/photo', async (req, res) => {
        const tag = req.params.tag;
        const notFound = () => res.status(404).type('text/plain').send('Not found');
        if (!TAG_PATTERN.test(tag)) return notFound();
        const wait = visitorLimit(req);
        if (wait !== null) {
            if (wait > 0) res.set('Retry-After', String(wait));
            return res.status(429).type('text/plain').send('Too many requests');
        }
        try {
            const result = await lookupPublicPlant(database(), tag);
            if (result.status !== 'found') return notFound();
            // ?size=thumb: a small copy (at most 300 px) for app lists. Anything else: full size.
            const thumb = req.query.size === 'thumb';
            const photo = await readPublicPlantPhoto(database(), tag,
                thumb ? { maxSide: PUBLIC_THUMBNAIL_MAX_SIDE } : undefined);
            if (!photo) return notFound();
            res.set('Cache-Control', 'public, max-age=86400');
            return res.type('image/jpeg').send(photo);
        } catch {
            return res.status(503).type('text/plain').send('Temporarily unavailable');
        }
    });
    return router;
}

module.exports = createPublicPlantsRouter();
module.exports.createPublicPlantsRouter = createPublicPlantsRouter;
module.exports.createPublicQrHandler = createPublicQrHandler;
