const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateQRBatchPDF, PDF_LAYOUTS } = require('../services/qrPdfService');
const { generateQrLabelPng } = require('../services/qrLabelService');
const { TAG_PATTERN, buildPublicPlantUrl, QrConfigurationError } = require('../services/qrService');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function databaseError(res, error) {
    if (error.code === '42501') return res.status(403).json({ message: 'Plant or tag is unavailable' });
    if (error.code === '23505' || error.code === 'P0001') {
        return res.status(409).json({ message: 'Tag allocation or binding conflict' });
    }
    if (error.code === '22023') return res.status(400).json({ message: 'Invalid or conflicting reservation request' });
    return res.status(503).json({ message: 'Tag reservation service unavailable' });
}

function createTagReservationsRouter({ authenticate = requireAuth, authorize = requireRole,
    generatePDF = generateQRBatchPDF, generatePNG = generateQrLabelPng,
    checkDestination = buildPublicPlantUrl } = {}) {
    const router = express.Router();
    router.use(authenticate, authorize('botanist'));
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    router.get('/', async (req, res) => {
        const { page = '1', page_size: pageSize = '50', status = 'all', request_id: requestId } = req.query;
        if (typeof page !== 'string' || typeof pageSize !== 'string' ||
            !/^[1-9]\d*$/.test(page) || !/^[1-9]\d*$/.test(pageSize) ||
            !Number.isSafeInteger(Number(page)) || Number(page) > 100000 || Number(pageSize) > 100 ||
            !['all', 'reserved', 'bound'].includes(status) ||
            (requestId !== undefined && (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)))) {
            return res.status(400).json({ message: 'Invalid page, page_size, status or request_id' });
        }
        const number = Number(page), size = Number(pageSize);
        try {
            let query = req.supabase.from('tag_reservations')
                .select('qr_code_value, request_id, reserved_at, bound_plant_id, bound_at', { count: 'exact' })
                .eq('reserved_by', req.user.id);
            if (status === 'reserved') query = query.is('bound_plant_id', null);
            if (status === 'bound') query = query.not('bound_plant_id', 'is', null);
            if (requestId !== undefined) query = query.eq('request_id', requestId);
            const { data, error, count } = await query.order('reserved_at', { ascending: false })
                .order('qr_code_value').range((number - 1) * size, number * size - 1);
            if (error) return databaseError(res, error);
            return res.json({ data: data || [], pagination: { page: number, page_size: size,
                total: count ?? 0, total_pages: Math.ceil((count ?? 0) / size) } });
        } catch { return res.status(503).json({ message: 'Tag reservation service unavailable' }); }
    });
    // Retrying the same request_id and quantity returns the same tags, including after PDF failure.
    router.post('/reserve-and-print', async (req, res) => {
        const { count, request_id: requestId, layout = 'sheet' } = req.body || {};
        if (!Number.isInteger(count) || count < 1 || count > 100 ||
            typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
            return res.status(400).json({ message: 'count must be 1-100 and request_id must be a UUID' });
        }
        // The layout only changes the PDF, never which tags are reserved.
        if (!PDF_LAYOUTS.includes(layout)) {
            return res.status(400).json({ message: 'layout must be "sheet" or "single"' });
        }
        try {
            checkDestination('NIAH-PLT-00001');
            const { data, error } = await req.supabase.rpc('reserve_plant_tags', {
                p_count: count, p_request_id: requestId,
            });
            if (error) return databaseError(res, error);
            const tags = Array.isArray(data) ? data.map(row => row.qr_code_value) : [];
            if (tags.length !== count || new Set(tags).size !== count ||
                tags.some(tag => typeof tag !== 'string' || !TAG_PATTERN.test(tag))) {
                return res.status(503).json({ message: 'Invalid reservation result; retry using the same request_id' });
            }
            const pdf = await generatePDF(tags, { layout });
            res.set({ 'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="reserved-plant-tags.pdf"',
                'X-Reservation-Request-Id': requestId });
            return res.send(pdf);
        } catch (error) {
            if (error instanceof QrConfigurationError) {
                return res.status(503).json({ message: 'Public QR URL is not configured' });
            }
            return res.status(503).json({ message: 'Could not print reservation; retry using the same request_id' });
        }
    });
    // Prints chosen tags again: only tags this botanist reserved (unused or on a plant).
    router.post('/print', async (req, res) => {
        const { tags, layout = 'sheet' } = req.body || {};
        if (!Array.isArray(tags) || tags.length === 0 || tags.length > 100 ||
            tags.some(tag => typeof tag !== 'string' || !TAG_PATTERN.test(tag)) ||
            new Set(tags).size !== tags.length) {
            return res.status(400).json({ message: 'Choose 1-100 different NIAH-PLT tags' });
        }
        if (!PDF_LAYOUTS.includes(layout)) {
            return res.status(400).json({ message: 'layout must be "sheet" or "single"' });
        }
        try {
            const { data, error } = await req.supabase.from('tag_reservations')
                .select('qr_code_value').eq('reserved_by', req.user.id).in('qr_code_value', tags);
            if (error) return databaseError(res, error);
            const mine = new Set((data || []).map(row => row.qr_code_value));
            if (tags.some(tag => !mine.has(tag))) {
                return res.status(403).json({ message: 'One or more tags are not yours' });
            }
            const pdf = await generatePDF([...tags].sort(), { layout });
            res.set({ 'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="plant-qr-tags.pdf"' });
            return res.send(pdf);
        } catch (error) {
            if (error instanceof QrConfigurationError) {
                return res.status(503).json({ message: 'Public QR URL is not configured' });
            }
            return res.status(503).json({ message: 'Could not print the tags; please try again' });
        }
    });
    // One unused tag of this botanist as a PNG label (QR + tag text). A tag that is already on
    // a plant uses the plant's own image: GET /api/plants/:id/qr/image.
    router.get('/:tag/image', async (req, res) => {
        const tag = req.params.tag;
        if (!TAG_PATTERN.test(tag)) return res.status(400).json({ message: 'Tag must follow NIAH-PLT-00001 format' });
        try {
            const { data, error } = await req.supabase.from('tag_reservations')
                .select('qr_code_value, bound_plant_id').eq('reserved_by', req.user.id)
                .eq('qr_code_value', tag).maybeSingle();
            if (error) return databaseError(res, error);
            if (!data) return res.status(404).json({ message: 'Tag not found' });
            if (data.bound_plant_id) {
                return res.status(409).json({ message: "This tag is on a plant; use the plant's QR image" });
            }
            const png = await generatePNG(tag);
            res.set({ 'Content-Type': 'image/png',
                'Content-Disposition': `attachment; filename="${tag}.png"` });
            return res.send(png);
        } catch (error) {
            if (error instanceof QrConfigurationError) {
                return res.status(503).json({ message: 'Public QR URL is not configured' });
            }
            return res.status(503).json({ message: 'Could not make the tag image; please try again' });
        }
    });
    router.post('/:plantId/attach', async (req, res) => {
        const tag = req.body?.tag;
        if (!UUID_PATTERN.test(req.params.plantId) || typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
            return res.status(400).json({ message: 'A valid plant UUID and physical tag are required' });
        }
        try {
            const { data, error } = await req.supabase.rpc('attach_reserved_plant_tag', {
                p_plant_id: req.params.plantId, p_tag: tag,
            });
            if (error) return databaseError(res, error);
            if (typeof data !== 'string' || data.toLowerCase() !== req.params.plantId.toLowerCase()) {
                return res.status(503).json({ message: 'Could not confirm tag binding' });
            }
            return res.json({ plant_id: data, qr_code_value: tag });
        } catch { return res.status(503).json({ message: 'Tag binding service unavailable' }); }
    });
    return router;
}
module.exports = createTagReservationsRouter();
module.exports.createTagReservationsRouter = createTagReservationsRouter;
