const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createQrLimiter, publicQrData } = require('../src/middleware/publicQrProtection');
const { createAuthRouter } = require('../src/routes/auth');

test('client separation, bounded state, expiry and invalid policy', () => {
    assert.throws(() => createQrLimiter({ limit: 0 }), /Invalid/);
    let now = 0;
    const limiter = createQrLimiter({ limit: 1, maxClients: 2, windowMs: 1000, now: () => now });
    function request(ip) {
        let status = 200;
        const res = { set() {}, status(code) { status = code; return this; }, json() {} };
        limiter({ ip }, res, () => {});
        return status;
    }
    assert.equal(request('a'), 200);
    assert.equal(request('a'), 429);
    assert.equal(request('b'), 200);
    assert.equal(request('c'), 503);
    now = 1000;
    assert.equal(request('c'), 200);
});

test('real HTTP limiter enforces window, ignores spoofed forwarding and recovers', async () => {
    let now = 0;
    const app = express();
    app.disable('x-powered-by');
    app.get('/qr', createQrLimiter({ limit: 2, windowMs: 1000, now: () => now }), (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const url = `http://127.0.0.1:${server.address().port}/qr`;
        assert.equal((await fetch(url)).status, 200);
        assert.equal((await fetch(url)).status, 200);
        const denied = await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.9' } });
        assert.equal(denied.status, 429);
        assert.equal(denied.headers.get('retry-after'), '1');
        assert.equal(denied.headers.get('cache-control'), 'no-store');
        now = 1000;
        assert.equal((await fetch(url)).status, 200);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('three-hop ingress keeps real clients separate and shares a client quota across connections', async () => {
    let now = 0;
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 3);
    app.get('/qr', createQrLimiter({ limit: 2, windowMs: 1000, now: () => now }),
        (req, res) => res.json({ client: req.ip }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const url = `http://127.0.0.1:${server.address().port}/qr`;
        const request = client => fetch(url, { headers: {
            'X-Forwarded-For': `${client}, 203.0.113.2, 203.0.113.3`, Connection: 'close'
        } });
        assert.equal((await (await request('198.51.100.20')).json()).client, '198.51.100.20');
        assert.equal((await request('198.51.100.20')).status, 200);
        assert.equal((await request('198.51.100.20')).status, 429);
        const other = await request('198.51.100.21');
        assert.equal(other.status, 200);
        assert.equal((await other.json()).client, '198.51.100.21');
        now = 1000;
        assert.equal((await request('198.51.100.20')).status, 200);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('three-hop ingress ignores spoofed prefixes and alternative client-IP headers', async () => {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 3);
    app.get('/qr', createQrLimiter({ limit: 1 }), (req, res) => res.json({ client: req.ip }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const url = `http://127.0.0.1:${server.address().port}/qr`;
        // Simulate trusted ingress preserving the genuine client and its two proxy entries.
        const chain = '198.51.100.20, 203.0.113.2, 203.0.113.3';
        const allowed = await fetch(url, { headers: { 'X-Forwarded-For': chain } });
        assert.equal((await allowed.json()).client, '198.51.100.20');
        for (const forged of ['192.0.2.40', '192.0.2.41, 192.0.2.42']) {
            const denied = await fetch(url, { headers: {
                'X-Forwarded-For': `${forged}, ${chain}`,
                'X-Real-IP': '192.0.2.43', 'CF-Connecting-IP': '192.0.2.44',
                Forwarded: 'for=192.0.2.45', Connection: 'close'
            } });
            assert.equal(denied.status, 429);
            assert.ok(Number(denied.headers.get('retry-after')) >= 1);
        }
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('three-hop ingress preserves per-client recovery throttling without contacting Auth', async () => {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 3);
    app.use(express.json());
    app.use('/auth', createAuthRouter({
        config: {},
        createRecoveryClient: () => { throw new Error('Auth must not be contacted'); },
        resolveStaffEmail: () => { throw new Error('Staff lookup must not be contacted'); }
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const request = (route, client, forged = '') => fetch(
            `http://127.0.0.1:${server.address().port}/auth/${route}`, {
                method: 'POST', body: '{}', headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-For': `${forged}${client}, 203.0.113.2, 203.0.113.3`
                }
            });
        for (const [route, baseline] of [['forgot-password', 400], ['reset-password', 503]]) {
            for (let n = 0; n < 20; n++) {
                assert.equal((await request(route, '198.51.100.20')).status, baseline);
            }
            assert.equal((await request(route, '198.51.100.20', '192.0.2.40, ')).status, 429);
            assert.equal((await request(route, '198.51.100.21')).status, baseline);
        }
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('location is LC-only, unknown is closed, unapproved nested fields are excluded', () => {
    for (const status of ['EN','VU','NT','CR','DD',null,undefined]) {
        const data = publicQrData({ conservation_status: status, latitude: 1, longitude: 2,
            location_description: 'synthetic', private: { gps: 1 } });
        assert.equal(data.latitude, null); assert.equal(data.longitude, null);
        assert.equal(data.location_description, null); assert.equal(data.private, undefined);
    }
    assert.equal(publicQrData({ conservation_status: 'LC', latitude: 0 }).latitude, 0);
});

test('public QR data strips legacy observation notes and excludes legacy photo fields', () => {
    const data = publicQrData({
        conservation_status: 'LC',
        description: 'Species description.\nSource: iNaturalist observation https://www.inaturalist.org/observations/123',
        reference_image_url: 'https://example.test/legacy.jpg',
        reference_observation_url: 'https://example.test/observation',
        reference_image_credit: 'Legacy photographer',
        reference_image_license: 'CC-BY-NC',
        data_source: 'inaturalist',
        source_observer: 'Aina Rahman',
        source_licence: 'CC0',
        source_url: 'https://www.inaturalist.org/observations/123',
    });
    assert.equal(data.description, 'Species description.');
    assert.equal(data.data_source, 'inaturalist');
    assert.equal(data.source_observer, 'Aina Rahman');
    assert.equal(data.source_licence, 'CC0');
    assert.equal(data.source_url, undefined);
    assert.equal(Object.keys(data).some(key => key.startsWith('reference_')), false);
});
