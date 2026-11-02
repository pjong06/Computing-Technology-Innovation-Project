const test = require('node:test');
const assert = require('node:assert/strict');
const { responseSummary, logResponseSummary } = require('../test-support/safeDiagnostics');

test('normal and error responses expose shape only, never fields or credentials', async () => {
  for (const input of ['{"data":[{"id":"private"}]}', '{"access_token":"test-secret","message":"bad"}', '\u001b[31mFORGED\r\nPASS', 'private csv contents']) {
    let output;
    await logResponseSummary({ text: async () => input }, value => { output = value; });
    assert.ok(['json','non-json'].includes(JSON.parse(output).format));
    assert.doesNotMatch(output, /private|test-secret|FORGED|PASS|\x1b|\r|\n/);
  }
  assert.deepEqual(responseSummary('null'), { format:'json', shape:'null' });
  assert.equal(responseSummary('{"data":{"total":3}}').rowCount, 3);
  assert.equal(responseSummary('{"data":{"total":"forged\\nPASS"}}').rowCount, undefined);
  assert.equal(responseSummary('{"data":{"total":-1}}').rowCount, undefined);
});
