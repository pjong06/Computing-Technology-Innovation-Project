const express = require('express');
const { TAG_PATTERN } = require('../services/qrService');

const STYLES = `
:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#20392d;background:#f3f4ec}
*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:820px;margin:auto;padding:24px 28px}
header{display:flex;justify-content:space-between;gap:20px;align-items:center;padding-top:30px}
.brand{font-weight:750;letter-spacing:-.04em;font-size:23px}.place{font-size:13px;color:#516353}
main{padding-top:48px;padding-bottom:56px}.tag{font-size:14px;font-weight:650;color:#48604e;overflow-wrap:anywhere}
h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-style:italic;font-size:clamp(36px,7vw,62px);line-height:1.08;margin:18px 0 14px;overflow-wrap:anywhere}
.common{font-size:23px;margin:0 0 10px}.local{color:#516353;margin:0}.status{display:inline-block;margin:28px 0 12px;padding:9px 14px;background:#dfebcf;font-size:14px;font-weight:650}
section{margin-top:34px;max-width:68ch}h2{font-size:18px;line-height:1.4;margin:0 0 10px}p{line-height:1.75;margin:0;white-space:pre-line;overflow-wrap:anywhere}
.demo{margin:20px 0;padding:16px 18px;background:#f5e8c9;color:#574421;font-size:15px;line-height:1.6}footer{color:#516353;font-size:13px;padding-bottom:38px}.notice{margin-top:20px;font-size:14px;color:#516353}
@media(max-width:480px){header,main,footer{padding-left:22px;padding-right:22px}header{align-items:flex-start;flex-direction:column;gap:8px}main{padding-top:24px}.common{font-size:21px}}
`;
const PUBLIC_FIELDS = ['scientific_name', 'common_name', 'local_name', 'description',
    'morphology', 'habitat', 'conservation_status', 'cultural_significance'];
const STATUS_NAMES = { LC: 'Least Concern', NT: 'Near Threatened', VU: 'Vulnerable',
    EN: 'Endangered', CR: 'Critically Endangered', NE: 'Not Evaluated' };

function escapeHtml(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function documentHtml(title, content) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} | Niah Biotrack</title>
<link rel="stylesheet" href="/public-assets/plant.css"></head><body>
<header><span class="brand">Niah Biotrack</span><span class="place">Plant reference | Niah National Park</span></header>
<main>${content}</main><footer>Public plant information. Exact locations are not shown on this page.</footer></body></html>`;
}

function publicPlantHtml(tag, row) {
    // Explicit allowlist: never serialize the RPC result, staff identity or coordinates into HTML.
    const plant = Object.fromEntries(PUBLIC_FIELDS.map(key => [key,
        typeof row[key] === 'string' ? row[key].slice(0, 10000) : '']));
    const isDemo = Object.values(plant).some(value => /\bDEMO\b/i.test(value));
    const status = plant.conservation_status || 'Unknown';
    const sections = [['About this species', plant.description], ['Appearance', plant.morphology],
        ['Habitat', plant.habitat], ['Cultural significance', plant.cultural_significance]];
    return documentHtml(plant.scientific_name || 'Plant information',
        `<div class="tag">${escapeHtml(tag)}</div>` +
        (isDemo ? '<aside class="demo"><strong>Demonstration record</strong><br>Not real research data. Approved status is for demonstration only and does not represent officer review.</aside>' : '') +
        `<h1>${escapeHtml(plant.scientific_name || 'Plant information')}</h1>` +
        (plant.common_name ? `<p class="common">${escapeHtml(plant.common_name)}</p>` : '') +
        (plant.local_name ? `<p class="local">Local name: ${escapeHtml(plant.local_name)}</p>` : '') +
        `<div class="status">Conservation status: ${escapeHtml(STATUS_NAMES[status] || status)}</div>` +
        sections.filter(([, value]) => value.trim()).map(([label, value]) =>
            `<section><h2>${label}</h2><p>${escapeHtml(value)}</p></section>`).join('') +
        (!plant.description.trim() ? '<p class="notice">A species description has not yet been provided.</p>' : ''));
}

function createPublicPlantsRouter({ client } = {}) {
    const router = express.Router();
    // A bounded process-local limit supplements, but does not replace, deployment-level rate limits.
    const requests = new Map();
    router.use(['/p', '/public-assets'], (_req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
        next();
    });
    router.get('/public-assets/plant.css', (_req, res) => res.type('css').send(STYLES));
    router.get('/p/:tag', async (req, res) => {
        const tag = req.params.tag;
        const errorPage = (status, title, message) => res.status(status).type('html')
            .send(documentHtml(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`));
        if (!TAG_PATTERN.test(tag)) return errorPage(400, 'Invalid plant tag', 'Use a valid Niah plant QR tag.');
        const now = Date.now();
        for (const [key, value] of requests) if (value.until <= now) requests.delete(key);
        let bucket = requests.get(req.ip);
        if (!bucket) {
            if (requests.size >= 10000) return errorPage(429, 'Please try again later', 'Too many requests.');
            bucket = { count: 0, until: now + 60000 }; requests.set(req.ip, bucket);
        }
        bucket.count++;
        if (bucket.count > 60) {
            res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - now) / 1000))));
            return errorPage(429, 'Please try again later', 'Too many requests.');
        }
        try {
            const database = client || require('../config/supabase').publicClient;
            // This existing RPC filters approved plants/species and approved observations.
            const { data, error } = await database.rpc('public_plant_by_qr_v2', { p_qr: tag });
            if (error) return errorPage(503, 'Temporarily unavailable', 'Plant information could not be loaded. Please try again later.');
            if (!Array.isArray(data) || data.length === 0) {
                return errorPage(404, 'Plant information unavailable', 'This tag has no approved public record yet.');
            }
            return res.type('html').send(publicPlantHtml(tag, data[0]));
        } catch {
            return errorPage(503, 'Temporarily unavailable', 'Plant information could not be loaded. Please try again later.');
        }
    });
    return router;
}

module.exports = createPublicPlantsRouter();
module.exports.createPublicPlantsRouter = createPublicPlantsRouter;
