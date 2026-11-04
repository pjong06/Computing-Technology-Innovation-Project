const { validateTelemetry } = require('./iotTelemetryService');

// The receiving API must authenticate this dedicated credential and perform the
// station lookup and database insert in its own restricted security context.
function createTelemetryPersistence(env = process.env, request = fetch) {
  if (env.IOT_PERSISTENCE_ENABLED !== 'true') return null;
  const endpoint = new URL(env.IOT_INGESTION_URL);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('IOT_INGESTION_URL must be HTTPS without embedded credentials');
  }
  const credential = env.IOT_INGESTION_TOKEN;
  if (!credential) throw new Error('IOT_INGESTION_TOKEN is required');

  return async function persistTelemetry(payload) {
    const telemetry = validateTelemetry(payload);
    const response = await request(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(telemetry),
      signal: AbortSignal.timeout(10000),
    });
    // Do not log response bodies, which may include sensitive server details.
    if (!response.ok) throw new Error(`Ingestion failed (HTTP ${response.status})`);
    const result = await response.json();
    if (typeof result.reading_id !== 'string' || !result.reading_id) {
      throw new Error('Ingestion response must contain reading_id');
    }
    return result;
  };
}

module.exports = { createTelemetryPersistence };
