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
                res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
                return res.status(503).json({ message: 'Please retry later' });
            }
            bucket = { count: 0, until: time + windowMs };
            clients.set(key, bucket);
        }
        bucket.count++;
        if (bucket.count > limit) {
            res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
            return res.status(429).json({ message: 'Too many QR lookups; please retry later' });
        }
        next();
    };
}

function publicQrData(row) {
    const fields = ['plant_id', 'qr_code_value', 'scientific_name', 'common_name', 'local_name',
        'description', 'morphology', 'habitat', 'conservation_status', 'cultural_significance'];
    const data = Object.fromEntries(fields.map(key => [key, row[key] ?? null]));
    for (const key of ['location_description', 'latitude', 'longitude']) {
        data[key] = row.conservation_status === 'LC' ? row[key] ?? null : null;
    }
    return data;
}

module.exports = { createQrLimiter, publicQrData };
