const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createQrLimiter, publicQrData } = require('../src/middleware/publicQrProtection');

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

test('location is LC-only, unknown is closed, unapproved nested fields are excluded', () => {
    for (const status of ['EN','VU','NT','CR','DD',null,undefined]) {
        const data = publicQrData({ conservation_status: status, latitude: 1, longitude: 2,
            location_description: 'synthetic', private: { gps: 1 } });
        assert.equal(data.latitude, null); assert.equal(data.longitude, null);
        assert.equal(data.location_description, null); assert.equal(data.private, undefined);
    }
    assert.equal(publicQrData({ conservation_status: 'LC', latitude: 0 }).latitude, 0);
});
