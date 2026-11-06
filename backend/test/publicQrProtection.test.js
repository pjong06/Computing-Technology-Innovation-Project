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

test('QR diagnostics are disabled unless QR_IP_DEBUG is exactly true', () => {
    const originalDebug = process.env.QR_IP_DEBUG;
    const originalLog = console.log;
    const logs = [];
    console.log = line => logs.push(line);
    try {
        for (const value of [undefined, 'True', '1']) {
            if (value === undefined) delete process.env.QR_IP_DEBUG;
            else process.env.QR_IP_DEBUG = value;
            createQrLimiter()(
                { ip: '198.51.100.20', headers: {} },
                { set() {}, status() { return this; }, json() {} },
                () => {}
            );
        }
        assert.deepEqual(logs, []);
    } finally {
        console.log = originalLog;
        if (originalDebug === undefined) delete process.env.QR_IP_DEBUG;
        else process.env.QR_IP_DEBUG = originalDebug;
    }
});

test('QR diagnostics hash client IP and log only forwarding metadata', () => {
    const originalDebug = process.env.QR_IP_DEBUG;
    const originalLog = console.log;
    const logs = [];
    console.log = line => logs.push(line);
    try {
        process.env.QR_IP_DEBUG = 'true';
        createQrLimiter({ limit: 1 })(
            {
                ip: '198.51.100.20',
                headers: {
                    'x-forwarded-for': '203.0.113.1, 203.0.113.2',
                    'cf-connecting-ip': '203.0.113.3'
                }
            },
            { set() {}, status() { return this; }, json() {} },
            () => {}
        );
        assert.equal(logs.length, 1);
        for (const rawIp of ['198.51.100.20', '203.0.113.1', '203.0.113.2', '203.0.113.3']) {
            assert.equal(logs[0].includes(rawIp), false);
        }
        const diagnostic = JSON.parse(logs[0]);
        assert.match(diagnostic.timestamp, /^\d{4}-\d{2}-\d{2}T/);
        assert.match(diagnostic.ipHash, /^[a-f0-9]{16}$/);
        assert.equal(diagnostic.event, 'qr-ip-diagnostic');
        assert.equal(diagnostic.count, 1);
        assert.equal(diagnostic.limit, 1);
        assert.equal(diagnostic.windowMs, 60000);
        assert.equal(diagnostic.forwardedForEntries, 2);
        assert.equal(diagnostic.cfConnectingIpPresent, true);
        assert.equal(diagnostic.rateLimited, false);
    } finally {
        console.log = originalLog;
        if (originalDebug === undefined) delete process.env.QR_IP_DEBUG;
        else process.env.QR_IP_DEBUG = originalDebug;
    }
});

test('QR diagnostics correlate bounded markers, proxy hashes and quota without raw inputs', () => {
    const previous = process.env.QR_IP_DEBUG;
    const previousLog = console.log;
    const logs = [];
    console.log = value => logs.push(JSON.parse(value));
    try {
        process.env.QR_IP_DEBUG = 'true';
        let now = 1000;
        const limiter = createQrLimiter({ limit: 1, windowMs: 1000, now: () => now });
        const request = (ip, marker) => limiter({
            ip, ips: [ip, '203.0.113.2'], socket: { remoteAddress: '203.0.113.9' },
            query: { sec76_client_check: marker, token: 'never-log-this-token' },
            headers: { 'x-forwarded-for': `${ip}, 203.0.113.2`,
                'cf-connecting-ip': ip, authorization: 'Bearer never-log-this-token' }
        }, { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json() {} }, () => {});
        request('198.51.100.20', 'sec76-computer-1793960000000-1');
        request('198.51.100.20', 'sec76-computer-1793960000000-2');
        request('198.51.100.21', 'sec76-phone-1793960000000-1');
        now = 2000;
        request('198.51.100.20', 'never-log-this-token\nforged');
        assert.deepEqual(logs.map(x => x.count), [1, 2, 1, 1]);
        assert.deepEqual(logs.map(x => x.rateLimited), [false, true, false, false]);
        assert.equal(logs[0].testMarker, 'sec76-computer-1793960000000-1');
        assert.equal(logs[3].testMarker, null);
        assert.equal(new Set(logs.map(x => x.processInstance)).size, 1);
        assert.equal(logs[0].ipHash, logs[1].ipHash);
        assert.notEqual(logs[0].ipHash, logs[2].ipHash);
        assert.equal(logs[0].ipHash, logs[0].forwardedForHashes[0]);
        assert.equal(logs[0].ipHash, logs[0].reqIpsHashes[0]);
        assert.equal(logs[0].ipHash, logs[0].cfConnectingIpHash);
        assert.notEqual(logs[0].windowEndsAt, logs[3].windowEndsAt);
        const text = JSON.stringify(logs);
        for (const raw of ['198.51.100.', '203.0.113.', 'never-log-this-token', 'Bearer']) {
            assert.equal(text.includes(raw), false);
        }
    } finally {
        console.log = previousLog;
        if (previous === undefined) delete process.env.QR_IP_DEBUG;
        else process.env.QR_IP_DEBUG = previous;
    }
});

test('QR diagnostics record final HTTP status and distinguish capacity from per-IP denial', async () => {
    const previous = process.env.QR_IP_DEBUG;
    const previousLog = console.log;
    const logs = [];
    console.log = value => logs.push(JSON.parse(value));
    let server;
    try {
        process.env.QR_IP_DEBUG = 'true';
        const app = express();
        app.disable('x-powered-by');
        app.get('/qr', createQrLimiter({ limit: 1 }), (_req, res) => res.status(400).json({ error: 'empty' }));
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const url = `http://127.0.0.1:${server.address().port}/qr?sec76_client_check=sec76-computer-1793960000000-1`;
        assert.equal((await fetch(url)).status, 400);
        assert.equal((await fetch(url)).status, 429);
        assert.deepEqual(logs.map(x => x.status), [400, 429]);
        assert.deepEqual(logs.map(x => x.outcome), ['allowed', 'rate-limit']);
        const capacity = createQrLimiter({ maxClients: 1 });
        const response = () => ({ set() {}, status() { return this; }, json() {} });
        capacity({ ip: 'a' }, response(), () => {});
        capacity({ ip: 'b' }, response(), () => {});
        assert.equal(logs.at(-1).outcome, 'capacity');
        assert.equal(logs.at(-1).count, null);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        console.log = previousLog;
        if (previous === undefined) delete process.env.QR_IP_DEBUG;
        else process.env.QR_IP_DEBUG = previous;
    }
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

test('location is LC-only, unknown is closed, unapproved nested fields are excluded', () => {
    for (const status of ['EN','VU','NT','CR','DD',null,undefined]) {
        const data = publicQrData({ conservation_status: status, latitude: 1, longitude: 2,
            location_description: 'synthetic', private: { gps: 1 } });
        assert.equal(data.latitude, null); assert.equal(data.longitude, null);
        assert.equal(data.location_description, null); assert.equal(data.private, undefined);
    }
    assert.equal(publicQrData({ conservation_status: 'LC', latitude: 0 }).latitude, 0);
});
