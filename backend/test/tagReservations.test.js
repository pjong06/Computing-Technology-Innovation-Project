const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
const { createTagReservationsRouter } = require('../src/routes/tagReservations');
const { requireRole } = require('../src/middleware/auth');
const { QrConfigurationError } = require('../src/services/qrService');
const ID = '11111111-1111-4111-8111-111111111111';
const TAG = 'NIAH-PLT-00002';
async function setup(t, options = {}) {
    const calls = [];
    const app = express(); app.use(express.json());
    app.use(createTagReservationsRouter({
        authenticate(req, res, next) {
            if (options.role === null) return res.sendStatus(401);
            req.profile = { role: options.role || 'botanist' };
            req.user = { id: ID };
            req.supabase = { from(table) {
                calls.push(['from', table]);
                const query = {};
                for (const method of ['select', 'eq', 'is', 'not', 'order']) {
                    query[method] = (...args) => { calls.push([method, ...args]); return query; };
                }
                query.range = async (...args) => {
                    calls.push(['range', ...args]);
                    if (options.throwRpc) throw new Error('SECRET');
                    return options.result || { data: [{ qr_code_value: TAG, request_id: ID }], count: 3 };
                };
                return query;
            }, rpc: async (...args) => {
                calls.push(args);
                if (options.throwRpc) throw new Error('SECRET');
                return options.result || { data: [{ qr_code_value: TAG }] };
            } }; next();
        }, authorize: requireRole,
        checkDestination: options.destination || (() => {}),
        generatePDF: options.pdf || (async tags => {
            assert.deepEqual(tags, [TAG]); return Buffer.from('%PDF-test');
        }),
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.close(); server.closeAllConnections(); });
    return { calls, get: (path = '/') => fetch(`http://127.0.0.1:${server.address().port}${path}`),
        send: (body, path = '/reserve-and-print') => fetch(
        `http://127.0.0.1:${server.address().port}${path}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        }) };
}
for (const [role, status] of [[null, 401], ['officer', 403], ['researcher', 403], ['admin', 403]]) {
    test(`reservation denies role ${role}`, async t => {
        const s = await setup(t, { role });
        assert.equal((await s.send({ count: 1, request_id: ID })).status, status);
        assert.equal(s.calls.length, 0);
    });
}
for (const body of [{}, { count: 0, request_id: ID }, { count: 101, request_id: ID },
    { count: 1.5, request_id: ID }, { count: '1', request_id: ID }, { count: 1, request_id: 'bad' }]) {
    test('invalid reservations never reach the database', async t => {
        const s = await setup(t); assert.equal((await s.send(body)).status, 400);
        assert.equal(s.calls.length, 0);
    });
}
test('reservation prints returned tags and forwards stable retry identity', async t => {
    const s = await setup(t);
    for (let i = 0; i < 2; i++) {
        const response = await s.send({ count: 1, request_id: ID });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-reservation-request-id'), ID);
        assert.match(await response.text(), /^%PDF/);
    }
    assert.deepEqual(s.calls, Array(2).fill(['reserve_plant_tags', { p_count: 1, p_request_id: ID }]));
});
test('missing QR configuration allocates no tags', async t => {
    const s = await setup(t, { destination() { throw new QrConfigurationError(); } });
    assert.equal((await s.send({ count: 1, request_id: ID })).status, 503);
    assert.equal(s.calls.length, 0);
});
test('PDF failure tells the caller to retry the same request', async t => {
    const s = await setup(t, { pdf() { throw new Error('SECRET'); } });
    const response = await s.send({ count: 1, request_id: ID });
    assert.equal(response.status, 503); assert.match(await response.text(), /same request_id/);
});
for (const [code, status] of [['42501', 403], ['23505', 409], ['P0001', 409], ['22023', 400], ['PGRST202', 503]]) {
    test(`database error ${code} has a safe response`, async t => {
        const s = await setup(t, { result: { error: { code, message: 'SECRET' } } });
        const response = await s.send({ count: 1, request_id: ID });
        assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /SECRET/);
    });
}
test('malformed database results are not printed', async t => {
    const s = await setup(t, { result: { data: [{ qr_code_value: '../admin' }] } });
    assert.equal((await s.send({ count: 1, request_id: ID })).status, 503);
});
test('valid attachment returns the binding', async t => {
    const s = await setup(t, { result: { data: ID } });
    const response = await s.send({ tag: TAG }, `/${ID}/attach`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { plant_id: ID, qr_code_value: TAG });
    assert.deepEqual(s.calls, [['attach_reserved_plant_tag', { p_plant_id: ID, p_tag: TAG }]]);
});
test('invalid attachment does not reach the database', async t => {
    const s = await setup(t);
    assert.equal((await s.send({ tag: '../x' }, `/${ID}/attach`)).status, 400);
    assert.equal(s.calls.length, 0);
});
test('unavailable attachment service does not leak errors', async t => {
    const s = await setup(t, { throwRpc: true });
    const response = await s.send({ tag: TAG }, `/${ID}/attach`);
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /SECRET/);
});
test('reservation route generates a real PDF with configured public URLs', async t => {
    const { generateQRBatchPDF } = require('../src/services/qrPdfService');
    const s = await setup(t, { pdf: tags => generateQRBatchPDF(tags, {
        publicBaseUrl: 'https://plants.example.test/p/',
    }) });
    const response = await s.send({ count: 1, request_id: ID });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/pdf/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    assert.ok(bytes.length > 1000);
});
test('attachment accepts canonical UUID casing returned by PostgreSQL', async t => {
    const plantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const s = await setup(t, { result: { data: plantId } });
    assert.equal((await s.send({ tag: TAG }, `/${plantId.toUpperCase()}/attach`)).status, 200);
});
test('reservation list uses explicit ownership, stable ordering and exact pagination', async t => {
    const s = await setup(t);
    const response = await s.get('/?page=2&page_size=2');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).pagination, { page: 2, page_size: 2, total: 3, total_pages: 2 });
    assert.ok(s.calls.some(call => JSON.stringify(call) === JSON.stringify(['eq', 'reserved_by', ID])));
    assert.deepEqual(s.calls.slice(-3), [['order', 'reserved_at', { ascending: false }],
        ['order', 'qr_code_value'], ['range', 2, 3]]);
});
for (const [status, method, args] of [['reserved', 'is', ['bound_plant_id', null]],
    ['bound', 'not', ['bound_plant_id', 'is', null]]]) {
    test(`reservation list filters ${status} and batch identity`, async t => {
        const s = await setup(t);
        assert.equal((await s.get(`/?status=${status}&request_id=${ID}`)).status, 200);
        assert.ok(s.calls.some(call => JSON.stringify(call) === JSON.stringify([method, ...args])));
        assert.ok(s.calls.some(call => JSON.stringify(call) === JSON.stringify(['eq', 'request_id', ID])));
    });
}
for (const query of ['page=0', 'page=1.5', 'page=100001', 'page=1&page=2', 'page_size=101',
    'page_size=Infinity', 'status=invalid', 'status=reserved&status=bound', 'request_id=invalid']) {
    test(`reservation list rejects invalid query ${query}`, async t => {
        const s = await setup(t); assert.equal((await s.get('/?' + query)).status, 400);
        assert.equal(s.calls.length, 0);
    });
}
for (const role of [null, 'officer', 'researcher', 'admin']) {
    test(`reservation list rejects role ${role}`, async t => {
        const s = await setup(t, { role }); assert.equal((await s.get()).status, role === null ? 401 : 403);
        assert.equal(s.calls.length, 0);
    });
}
test('empty reservation pages retain exact totals', async t => {
    const s = await setup(t, { result: { data: [], count: 3 } });
    const response = await s.get('/?page=3&page_size=2');
    assert.deepEqual(await response.json(), { data: [], pagination: { page: 3, page_size: 2, total: 3, total_pages: 2 } });
});
for (const options of [{ result: { error: { code: 'PGRST205', message: 'SECRET' } } }, { throwRpc: true }]) {
    test('unavailable reservation lists hide database errors', async t => {
        const s = await setup(t, options); const response = await s.get();
        assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /SECRET/);
    });
}

// POST /reserve (My QR tags "Get N tags"): reserves and returns the tags, no PDF; the layout
// is chosen afterwards when printing. Same request_id -> the same tags.
test('reserve returns the reserved tags (no PDF) and keeps the retry identity', async t => {
    const s = await setup(t, { pdf: async () => { throw new Error('no PDF on /reserve'); } });
    for (let i = 0; i < 2; i++) {
        const response = await s.send({ count: 1, request_id: ID }, '/reserve');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { request_id: ID, tags: [TAG] });
    }
    const rpcCalls = s.calls.filter((call) => call[0] === 'reserve_plant_tags');
    assert.deepEqual(rpcCalls.map((call) => call[1]), [{ p_count: 1, p_request_id: ID }, { p_count: 1, p_request_id: ID }]);
});

for (const body of [{ count: 0, request_id: ID }, { count: 101, request_id: ID }, { count: 'ten', request_id: ID }, { count: 2.5, request_id: ID }, { count: 3, request_id: 'bad' }]) {
    test(`reserve refuses ${JSON.stringify(body)} before the database`, async t => {
        const s = await setup(t);
        assert.equal((await s.send(body, '/reserve')).status, 400);
        assert.equal(s.calls.length, 0);
    });
}

test('reserve is for botanists only, and a short reservation result is not accepted', async t => {
    const officer = await setup(t, { role: 'officer' });
    assert.equal((await officer.send({ count: 1, request_id: ID }, '/reserve')).status, 403);
    assert.equal(officer.calls.length, 0);
    const short = await setup(t, { result: { data: [{ qr_code_value: TAG }] } });
    assert.equal((await short.send({ count: 2, request_id: ID }, '/reserve')).status, 503);
});

test('print sends exactly the chosen tags to the PDF (3 chosen -> 3 printed)', async t => {
    const chosen = ['NIAH-PLT-00012', 'NIAH-PLT-00004', 'NIAH-PLT-00007'];
    let printed = null;
    let lookedUp = null;
    const app = express(); app.use(express.json());
    app.use(createTagReservationsRouter({
        authenticate(req, _res, next) {
            req.profile = { role: 'botanist' };
            req.user = { id: ID };
            // The ownership check finds the botanist's own copies of exactly the chosen tags.
            const query = { select: () => query, eq: () => query, in: (_column, tags) => { lookedUp = tags; return query; },
                then: (resolve) => resolve({ data: chosen.map((tag) => ({ qr_code_value: tag })), error: null }) };
            req.supabase = { from: () => query };
            next();
        },
        authorize: requireRole,
        generatePDF: async (tags, options) => { printed = { tags, options }; return Buffer.from('%PDF-test'); },
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.close(); server.closeAllConnections(); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/print`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tags: chosen, layout: 'single' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(lookedUp, chosen);
    assert.deepEqual(printed, { tags: [...chosen].sort(), options: { layout: 'single' } });
});
