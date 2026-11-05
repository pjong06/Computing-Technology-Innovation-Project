const test = require('node:test');
const assert = require('node:assert/strict');
const { expiryEvidence } = require('../camera/accessAssertions');
test('expiry evidence accepts exp-claim denial without requiring the word expired', () => {
  assert.deepEqual(expiryEvidence(400, JSON.stringify({ error: 'InvalidJWT', message: '"exp" claim timestamp check failed' })),
    { status: 400, reason: 'exp_claim_timestamp_check_failed', pass: true });
  assert.equal(expiryEvidence(401, JSON.stringify({ message: 'jwt expired' })).pass, true);
});
test('expiry evidence rejects generic failures, success and server errors', () => {
  for (const [status, body] of [[400, '{"message":"Object not found"}'], [403, '{"message":"Invalid signature"}'],
    [200, 'jwt expired'], [500, 'jwt expired']]) assert.equal(expiryEvidence(status, body).pass, false);
});
