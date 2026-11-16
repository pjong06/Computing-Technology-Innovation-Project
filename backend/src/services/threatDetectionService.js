const { getThreatThresholds } = require('../config/iotThreatConfig');

const ThreatType = Object.freeze({
  HIGH_TEMPERATURE: 'high_temperature',
  LOW_SOIL_MOISTURE: 'low_soil_moisture',
  MOTION_DETECTED: 'motion_detected',
  PROXIMITY_BREACH: 'proximity_breach',
  HEAVY_RAIN: 'heavy_rain',
});

const ThreatSeverity = Object.freeze({
  WARNING: 'warning',
  CRITICAL: 'critical',
});

function result(details, evaluated, triggered) {
  return {
    ...details,
    evaluated,
    triggered: evaluated && triggered,
  };
}

function evaluateThreats(reading, thresholds = getThreatThresholds()) {
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) {
    throw new Error('A validated telemetry reading is required');
  }

  return [
    result(
      {
        type: ThreatType.HIGH_TEMPERATURE,
        severity: ThreatSeverity.WARNING,
        sensor: 'temperature_c',
        value: reading.temperature_c,
        threshold: thresholds.high_temperature_c,
        message: `High temperature at ${reading.temperature_c} C`,
      },
      reading.dht_valid === true,
      reading.temperature_c >= thresholds.high_temperature_c,
    ),
    result(
      {
        type: ThreatType.LOW_SOIL_MOISTURE,
        severity: ThreatSeverity.WARNING,
        sensor: 'soil_moisture_pct',
        value: reading.soil_moisture_pct,
        threshold: thresholds.low_soil_moisture_pct,
        message: `Low soil moisture at ${reading.soil_moisture_pct}%`,
      },
      Number.isFinite(reading.soil_moisture_pct),
      reading.soil_moisture_pct <= thresholds.low_soil_moisture_pct,
    ),
    result(
      {
        type: ThreatType.MOTION_DETECTED,
        severity: ThreatSeverity.WARNING,
        sensor: 'motion_detected',
        value: reading.motion_detected,
        threshold: null,
        message: 'Motion detected near the monitoring station',
      },
      typeof reading.motion_detected === 'boolean',
      reading.motion_detected === true,
    ),
    result(
      {
        type: ThreatType.PROXIMITY_BREACH,
        severity: ThreatSeverity.CRITICAL,
        sensor: 'distance_cm',
        value: reading.distance_cm,
        threshold: thresholds.proximity_cm,
        message: `Object detected within ${reading.distance_cm} cm`,
      },
      reading.distance_valid === true,
      reading.distance_cm <= thresholds.proximity_cm,
    ),
    result(
      {
        type: ThreatType.HEAVY_RAIN,
        severity: ThreatSeverity.WARNING,
        sensor: 'rain_intensity_pct',
        value: reading.rain_intensity_pct,
        threshold: thresholds.heavy_rain_pct,
        message: `Heavy rain intensity at ${reading.rain_intensity_pct}%`,
      },
      Number.isFinite(reading.rain_intensity_pct),
      reading.rain_intensity_pct >= thresholds.heavy_rain_pct,
    ),
  ];
}


function evaluateDatabaseRules(reading, rules) {
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) {
    throw new Error('A validated telemetry reading is required');
  }

  if (!Array.isArray(rules)) {
    throw new Error('Database alert rules must be an array');
  }

  const measurements = {
    temperature_c: reading.dht_valid === true
      ? reading.temperature_c
      : null,
    humidity_percent: reading.dht_valid === true
      ? reading.humidity_pct
      : null,
    soil_moisture_pct: reading.soil_moisture_pct,
    rain_intensity_pct: reading.rain_intensity_pct,
    movement_nearby_cm: reading.distance_valid === true
      ? reading.distance_cm
      : null,
    movement_detected: typeof reading.motion_detected === 'boolean'
      ? Number(reading.motion_detected)
      : null,
  };

  const compare = {
    '>': (value, threshold) => value > threshold,
    '>=': (value, threshold) => value >= threshold,
    '<': (value, threshold) => value < threshold,
    '<=': (value, threshold) => value <= threshold,
    '=': (value, threshold) => value === threshold,
  };

  return rules
    .filter((rule) => rule.is_enabled === true)
    .map((rule) => {
      if (!Object.hasOwn(measurements, rule.metric)) {
        throw new Error(`Unsupported database alert metric: ${rule.metric}`);
      }

      const comparison = compare[rule.comparison_operator];
      const threshold = Number(rule.threshold_value);

      if (!comparison || !Number.isFinite(threshold)) {
        throw new Error('Invalid database alert rule configuration');
      }

      const value = measurements[rule.metric];
      const evaluated = typeof value === 'number' && Number.isFinite(value);

      return {
        rule_key: rule.id || `${rule.metric}:${rule.rule_name}`,
        type: rule.metric === 'movement_detected'
  ? ThreatType.MOTION_DETECTED
  : rule.metric === 'movement_nearby_cm'
    ? ThreatType.PROXIMITY_BREACH
    : rule.metric === 'temperature_c'
      ? ThreatType.HIGH_TEMPERATURE
      : rule.metric === 'soil_moisture_pct'
        ? ThreatType.LOW_SOIL_MOISTURE
        : rule.metric === 'rain_intensity_pct'
          ? ThreatType.HEAVY_RAIN
          : `database_rule:${rule.metric}:${rule.rule_name}`,
        severity: rule.severity === 'high'
          ? ThreatSeverity.CRITICAL
          : ThreatSeverity.WARNING,
        sensor: rule.metric,
        value,
        threshold,
        message: rule.rule_name,
        evaluated,
        triggered: evaluated && comparison(value, threshold),
      };
    });
}

module.exports = {
  ThreatType,
  ThreatSeverity,
  evaluateThreats,
  evaluateDatabaseRules,
};
