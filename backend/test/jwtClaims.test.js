const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hasExpectedClaims } = require('../src/middleware/verifiedJwtClaims');

// An isolated trusted test key, not a Supabase production signing key.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const projectUrl = 'https://security-test.example';
const userId = 'test-user';
const base = { iss: `${projectUrl}/auth/v1`, aud: 'authenticated', sub: userId };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function signed(claims) {
    const payload = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode(claims)}`;
    return `${payload}.${crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url')}`;
}

function middlewareHarness() {
    const source = fs.readFileSync(path.join(__dirname, '../src/middleware/auth.js'), 'utf8');
    const counters = { verified: 0, profile: 0 };
    const exported = { exports: {} };
    vm.runInNewContext(source, {
        module: exported,
        process: { env: { SUPABASE_URL: projectUrl } },
        require(name) {
            if (name === './verifiedJwtClaims') return { hasExpectedClaims };
            if (name !== '../config/supabase') throw new Error('Unexpected test dependency');
            return {
                verifier: { auth: { async getUser(token) {
                    const parts = token.split('.');
                    const valid = crypto.verify(null, Buffer.from(parts.slice(0, 2).join('.')), publicKey, Buffer.from(parts[2], 'base64url'));
                    if (valid) counters.verified++;
                    return { data: { user: valid ? { id: userId } : null }, error: valid ? null : new Error('Invalid signature') };
                } } },
                forUser() {
                    counters.profile++;
                    return { from() { return { select() { return { eq() { return { async maybeSingle() {
                        return { data: { id: userId, role: 'researcher', account_status: 'active' }, error: null };
                    } }; } }; } }; } };
                },
            };
        },
    });
    return { middleware: exported.exports.requireAuth, counters };
}

for (const [name, claims, expected] of [
    ['expected issuer and audience', base, true],
    ['audience array contains authenticated', { ...base, aud: ['authenticated'] }, true],
    ['wrong issuer with valid trusted signature', { ...base, iss: 'https://other-project.example/auth/v1' }, false],
    ['wrong audience with valid trusted signature', { ...base, aud: 'service_role' }, false],
    ['missing issuer', { ...base, iss: undefined }, false],
    ['missing audience', { ...base, aud: undefined }, false],
    ['missing subject', { ...base, sub: undefined }, false],
    ['subject differs from verified user', { ...base, sub: 'other-user' }, false],
]) {
    test(`Authentication claim guard: ${name}`, async () => {
        const { middleware, counters } = middlewareHarness();
        let status, body, nextCalled = false;
        const response = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
        await middleware({ get: () => `Bearer ${signed(claims)}` }, response, () => { nextCalled = true; });
        assert.equal(counters.verified, 1, 'signature must pass before claims are assessed');
        assert.equal(nextCalled, expected);
        assert.equal(counters.profile, expected ? 1 : 0);
        if (!expected) {
            assert.equal(status, 401);
            assert.deepEqual(JSON.parse(JSON.stringify(body)), { message: 'Invalid or expired token' });
        }
    });
}

test('Malformed claims fail closed', () => {
    assert.equal(hasExpectedClaims('invalid', userId, projectUrl), false);
    assert.equal(hasExpectedClaims('a.invalid.c', userId, projectUrl), false);
    assert.equal(hasExpectedClaims(signed(base), userId, undefined), false);
});

test('Issuer normalization removes trailing slashes without backtracking', () => {
    const token = signed(base);
    assert.equal(hasExpectedClaims(token, userId, projectUrl + '/'), true);
    assert.equal(hasExpectedClaims(token, userId, projectUrl + '/'.repeat(100000)), true);
    assert.equal(hasExpectedClaims(token, userId, projectUrl + '/other/'), false);
});
