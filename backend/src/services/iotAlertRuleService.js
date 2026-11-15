
const RULE_COLUMNS =
  'id,station_id,rule_name,metric,comparison_operator,threshold_value,severity,is_enabled';

async function loadAlertRulesForStation(client, stationCode) {
  if (!client || typeof client.from !== 'function') {
    throw new Error('A database client is required');
  }

  if (typeof stationCode !== 'string' || !stationCode.trim()) {
    throw new Error('A station code is required');
  }

  // Convert the ESP32 station code into the database station UUID.
  const stationResult = await client
    .from('sensor_stations')
    .select('id')
    .eq('station_code', stationCode)
    .eq('station_status', 'active')
    .single();

  if (stationResult.error || !stationResult.data?.id) {
    throw new Error('Unable to load the active sensor station');
  }

  const stationId = stationResult.data.id;

  // Load global and station-specific rules separately.
  const [globalResult, specificResult] = await Promise.all([
    client
      .from('alert_rules')
      .select(RULE_COLUMNS)
      .is('station_id', null)
      .eq('is_enabled', true),

    client
      .from('alert_rules')
      .select(RULE_COLUMNS)
      .eq('station_id', stationId)
      .eq('is_enabled', true),
  ]);

  if (globalResult.error || specificResult.error) {
    throw new Error('Unable to load IoT alert rules');
  }

  if (!Array.isArray(globalResult.data) ||
      !Array.isArray(specificResult.data)) {
    throw new Error('Invalid IoT alert rule response');
  }

  const specificMetrics = new Set(
    specificResult.data.map((rule) => rule.metric)
  );

  // A station-specific rule replaces global rules for that metric.
  const effectiveGlobalRules = globalResult.data.filter(
    (rule) => !specificMetrics.has(rule.metric)
  );

  return [
    ...effectiveGlobalRules,
    ...specificResult.data,
  ];
}

module.exports = {
  loadAlertRulesForStation,
};
