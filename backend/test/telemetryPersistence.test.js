const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelemetryPersistence } = require('../src/services/telemetryPersistence');

test('persistence is disabled unless explicitly enabled', () => {
  assert.equal(createTelemetryPersistence({}), null);
});

test('enabled persistence requires HTTPS and a dedicated credential', () => {
  assert.throws(() => createTelemetryPersistence({
    IOT_PERSISTENCE_ENABLED: 'true', IOT_INGESTION_URL: 'http://example.com',
  }), /HTTPS/);
  assert.throws(() => createTelemetryPersistence({
    IOT_PERSISTENCE_ENABLED: 'true', IOT_INGESTION_URL: 'https://example.com',
  }), /TOKEN/);
});

test('invalid telemetry is rejected before network access', async () => {
  let called = false;
  const persist = createTelemetryPersistence({
    IOT_PERSISTENCE_ENABLED: 'true',
    IOT_INGESTION_URL: 'https://example.com/ingest',
    IOT_INGESTION_TOKEN: 'test-only',
  }, async () => { called = true; });
  await assert.rejects(persist({}), /schema_version/);
  assert.equal(called, false);
});
