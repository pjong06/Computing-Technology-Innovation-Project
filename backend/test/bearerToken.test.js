const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBearerToken } = require('../src/middleware/bearerToken');

test('normal Bearer credentials, scheme casing and HTTP whitespace', () => {
    for (const header of ['Bearer a.b.c', 'bearer a.b.c', 'BEARER\t a.b.c']) {
        assert.equal(parseBearerToken(header), 'a.b.c');
    }
});

test('malformed schemes, empty credentials and control characters are rejected', () => {
    for (const header of [undefined, '', 'Basic a.b.c', 'Bearera.b.c', 'Bearer ',
        'Bearer\t', ' Bearer a.b.c', 'Bearer a b', 'Bearer a\r\nb', 'Bearer a\x00b',
        'Bearer\u00a0a.b.c', 'Bearer a.b.c ']) {
        assert.equal(parseBearerToken(header), null);
    }
});

test('adversarial long whitespace and credential inputs complete correctly', () => {
    assert.equal(parseBearerToken('Bearer' + ' '.repeat(100000)), null);
    assert.equal(parseBearerToken('Bearer' + ' '.repeat(100000) + 'a.b.c'), 'a.b.c');
    assert.equal(parseBearerToken('Bearer ' + 'a'.repeat(100000) + '\n'), null);
});
