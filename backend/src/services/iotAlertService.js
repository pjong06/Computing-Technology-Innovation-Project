const { randomUUID } = require('node:crypto');
const {
  evaluateThreats,
  evaluateDatabaseRules,
} = require('./threatDetectionService');

const AlertStatus = Object.freeze({
  ACTIVE: 'active',
  RESOLVED: 'resolved',
});

const alerts = [];
const activeAlertsByKey = new Map();
const MAX_ALERT_HISTORY = 500;

function activeAlertKey(stationId, evaluation) {
  if (evaluation.type.startsWith('database_rule:')) {
    return `${stationId}:${evaluation.type}`;
  }

  if (evaluation.rule_key) {
    return `${stationId}:rule:${evaluation.rule_key}`;
  }

  return `${stationId}:${evaluation.type}`;
}

function readingTime(reading, fallback = new Date()) {
  const value = reading.received_at || fallback.toISOString();
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('received_at must be a valid date when provided');
  }
  return timestamp.toISOString();
}

function snapshot(alert) {
  return { ...alert };
}

function trimResolvedHistory() {
  while (alerts.length > MAX_ALERT_HISTORY) {
    const removableIndex = alerts.findIndex(
      (alert) => alert.status === AlertStatus.RESOLVED,
    );
    if (removableIndex === -1) return;
    alerts.splice(removableIndex, 1);
  }
}

function createAlert(reading, evaluation, detectedAt) {
  const alert = {
    id: randomUUID(),
    station_id: reading.station_id,
    rule_key: evaluation.rule_key ?? null,
    type: evaluation.type,
    severity: evaluation.severity,
    status: AlertStatus.ACTIVE,
    sensor: evaluation.sensor,
    value: evaluation.value,
    threshold: evaluation.threshold,
    message: evaluation.message,
    reading_sequence: reading.sequence,
    occurrence_count: 1,
    first_detected_at: detectedAt,
    last_detected_at: detectedAt,
    resolved_at: null,
  };

  alerts.push(alert);
  activeAlertsByKey.set(activeAlertKey(reading.station_id, evaluation), alert);
  trimResolvedHistory();
  return alert;
}

function updateAlert(alert, reading, evaluation, detectedAt) {
  alert.rule_key = evaluation.rule_key ?? null;
  alert.severity = evaluation.severity;
  alert.sensor = evaluation.sensor;
  alert.value = evaluation.value;
  alert.threshold = evaluation.threshold;
  alert.message = evaluation.message;
  alert.reading_sequence = reading.sequence;
  alert.occurrence_count += 1;
  alert.last_detected_at = detectedAt;
  return alert;
}

function resolveAlert(alert, reading, evaluation, resolvedAt) {
  alert.status = AlertStatus.RESOLVED;
  alert.reading_sequence = reading.sequence;
  alert.resolved_at = resolvedAt;
  activeAlertsByKey.delete(activeAlertKey(reading.station_id, evaluation));
  return alert;
}

function processTelemetryForAlerts(reading, options = {}) {
  if (typeof reading.station_id !== 'string' || reading.station_id.length === 0) {
    throw new Error('station_id is required to process telemetry alerts');
  }

  const processedAt = readingTime(reading, options.processedAt);
const evaluations = options.databaseRules !== undefined
  ? evaluateDatabaseRules(reading, options.databaseRules)
  : evaluateThreats(reading, options.thresholds);
  const changes = { created: [], updated: [], resolved: [] };

  for (const evaluation of evaluations) {
    if (!evaluation.evaluated) continue;

    const key = activeAlertKey(reading.station_id, evaluation);
    const existing = activeAlertsByKey.get(key);

    if (evaluation.triggered) {
      const changedAlert = existing
        ? updateAlert(existing, reading, evaluation, processedAt)
        : createAlert(reading, evaluation, processedAt);

      const target = existing ? changes.updated : changes.created;
      target.push(snapshot(changedAlert));
    } else if (existing) {
      changes.resolved.push(snapshot(resolveAlert(existing, reading, evaluation, processedAt))
);
    }
  }

  // Resolve alerts whose database rules are no longer enabled or present.
  if (options.databaseRules !== undefined) {
    const currentRuleKeys = new Set(
      evaluations.map((evaluation) => String(evaluation.rule_key))
    );

    for (const [key, alert] of activeAlertsByKey.entries()) {
      if (
        alert.station_id !== reading.station_id ||
        alert.rule_key == null ||
        currentRuleKeys.has(String(alert.rule_key))
      ) {
        continue;
      }

      alert.status = AlertStatus.RESOLVED;
      alert.reading_sequence = reading.sequence;
      alert.resolved_at = processedAt;
      activeAlertsByKey.delete(key);
      changes.resolved.push(snapshot(alert));
    }
  }

  return changes;
}

function getAlerts({ status, station_id: stationId, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, MAX_ALERT_HISTORY));
  return alerts
    .filter((alert) => !status || alert.status === status)
    .filter((alert) => !stationId || alert.station_id === stationId)
    .slice(-safeLimit)
    .reverse()
    .map(snapshot);
}

function getActiveAlerts() {
  return Array.from(activeAlertsByKey.values()).map(snapshot);
}

function resetAlertsForTests() {
  alerts.length = 0;
  activeAlertsByKey.clear();
}

module.exports = {
  AlertStatus,
  processTelemetryForAlerts,
  getAlerts,
  getActiveAlerts,
  resetAlertsForTests,
};
