const PROTOTYPE_THREAT_THRESHOLDS = Object.freeze({
  high_temperature_c: 35,
  low_soil_moisture_pct: 20,
  proximity_cm: 50,
  heavy_rain_pct: 70,
});

const THRESHOLD_SPECS = Object.freeze({
  high_temperature_c: {
    environmentVariable: 'IOT_HIGH_TEMPERATURE_C',
    minimum: -50,
    maximum: 100,
  },
  low_soil_moisture_pct: {
    environmentVariable: 'IOT_LOW_SOIL_MOISTURE_PCT',
    minimum: 0,
    maximum: 100,
  },
  proximity_cm: {
    environmentVariable: 'IOT_PROXIMITY_CM',
    minimum: 0,
    maximum: 1000,
  },
  heavy_rain_pct: {
    environmentVariable: 'IOT_HEAVY_RAIN_PCT',
    minimum: 0,
    maximum: 100,
  },
});

function readConfiguredNumber(environment, fallback, spec) {
  const configured = environment[spec.environmentVariable];
  if (configured === undefined || configured === '') return fallback;

  const value = Number(configured);
  if (!Number.isFinite(value) || value < spec.minimum || value > spec.maximum) {
    throw new Error(
      `${spec.environmentVariable} must be a number between ` +
      `${spec.minimum} and ${spec.maximum}`,
    );
  }

  return value;
}

function getThreatThresholds(environment = process.env) {
  return Object.fromEntries(
    Object.entries(THRESHOLD_SPECS).map(([key, spec]) => [
      key,
      readConfiguredNumber(
        environment,
        PROTOTYPE_THREAT_THRESHOLDS[key],
        spec,
      ),
    ]),
  );
}

module.exports = {
  PROTOTYPE_THREAT_THRESHOLDS,
  getThreatThresholds,
};
