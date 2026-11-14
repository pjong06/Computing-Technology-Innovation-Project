const { createHmac, randomBytes, randomUUID } = require('node:crypto');
const { removeLegacyObservationSource } = require('../utils/speciesDescription');
const diagnosticSalt = randomBytes(32);
const processInstance = randomUUID();

function logQrRequest(req, res, clientIp, details) {
    if (process.env.QR_IP_DEBUG !== 'true') return;

    const forwardedFor = req.headers?.['x-forwarded-for'];
    const chain = (Array.isArray(forwardedFor) ? forwardedFor : [forwardedFor])
        .filter(value => typeof value === 'string')
        .flatMap(value => value.split(','))
        .map(value => value.trim()).filter(Boolean);
    const hash = value => typeof value === 'string' && value.trim()
        ? createHmac('sha256', diagnosticSalt).update(value.trim()).digest('hex').slice(0, 16)
        : null;
    const marker = req.query?.sec76_client_check;
    const testMarker = typeof marker === 'string'
        && /^sec76-(computer|phone)-[0-9]{10,16}-[1-3]$/.test(marker) ? marker : null;
    const record = {
        event: 'qr-ip-diagnostic',
        timestamp: new Date().toISOString(),
        processInstance,
        testMarker,
        ipHash: hash(clientIp),
        reqIpsHashes: (req.ips || []).slice(0, 16).map(hash),
        socketIpHash: hash(req.socket?.remoteAddress),
        forwardedForEntries: chain.length,
        forwardedForHashes: chain.slice(0, 16).map(hash),
        forwardingChainTruncated: chain.length > 16,
        cfConnectingIpHash: hash(req.headers?.['cf-connecting-ip']),
        cfConnectingIpPresent: req.headers?.['cf-connecting-ip'] !== undefined,
        ...details
    };
    const write = () => console.log(JSON.stringify({ ...record, status: res.statusCode ?? null }));
    if (typeof res.once === 'function') res.once('finish', write);
    else write();
}

function createQrLimiter({ limit = 60, windowMs = 60000, maxClients = 10000, now = Date.now } = {}) {
    if (![limit, windowMs, maxClients].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid QR rate policy');
    const clients = new Map();
    return (req, res, next) => {
        const time = now();
        for (const [key, bucket] of clients) if (bucket.until <= time) clients.delete(key);
        res.set('Cache-Control', 'no-store');
        const key = req.ip || req.socket.remoteAddress;
        let bucket = clients.get(key);
        if (!bucket) {
            if (clients.size >= maxClients) {
                logQrRequest(req, res, key, {
                    rateLimited: true, outcome: 'capacity', count: null,
                    limit, windowMs, windowEndsAt: null
                });
                res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
                return res.status(503).json({ message: 'Please retry later' });
            }
            bucket = { count: 0, until: time + windowMs };
            clients.set(key, bucket);
        }
        bucket.count++;
        const rateLimited = bucket.count > limit;
        logQrRequest(req, res, key, {
            rateLimited, outcome: rateLimited ? 'rate-limit' : 'allowed',
            count: bucket.count, limit, windowMs, windowEndsAt: new Date(bucket.until).toISOString()
        });
        if (rateLimited) {
            res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
            return res.status(429).json({ message: 'Too many QR lookups; please retry later' });
        }
        next();
    };
}

function publicQrData(row) {
    const fields = ['plant_id', 'qr_code_value', 'scientific_name', 'common_name', 'local_name',
        'description', 'morphology', 'habitat', 'conservation_status', 'cultural_significance'];
    const data = Object.fromEntries(fields.map(key => [
        key,
        key === 'description'
            ? removeLegacyObservationSource(row[key] ?? null)
            : row[key] ?? null
    ]));
    for (const key of ['location_description', 'latitude', 'longitude']) {
        data[key] = row.conservation_status === 'LC' ? row[key] ?? null : null;
    }
    return data;
}

module.exports = { createQrLimiter, publicQrData };
