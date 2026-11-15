
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateDatabaseRules,
} = require('../src/services/threatDetectionService');

function reading(overrides = {}) {
  return {
    temperature_c: 35,
    humidity_pct: 80,
    dht_valid: true,
    soil_moisture_pct: 20,
    rain_intensity_pct: 70,
    distance_cm: 50,
    distance_valid: true,
    motion_detected: false,
    ...overrides,
  };
}

function rule(metric, operator, threshold, overrides = {}) {
  return {
    station_id: null,
    rule_name: `Test ${metric}`,
    metric,
    comparison_operator: operator,
    threshold_value: threshold,
    severity: 'high',
    is_enabled: true,
    ...overrides,
  };
}

test('evaluates all four IoT sensor thresholds at their boundaries', () => {
  const results = evaluateDatabaseRules(reading(), [
    rule('temperature_c', '>=', 35),
    rule('soil_moisture_pct', '<=', 20),
    rule('rain_intensity_pct', '>=', 70),
    rule('movement_nearby_cm', '<=', 50),
  ]);

  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result.evaluated));
  assert.ok(results.every((result) => result.triggered));
});

test('supports every database comparison operator', () => {
  const rules = [
    rule('temperature_c', '>', 34),
    rule('temperature_c', '>=', 35, { rule_name: 'greater or equal' }),
    rule('temperature_c', '<', 36, { rule_name: 'less than' }),
    rule('temperature_c', '<=', 35, { rule_name: 'less or equal' }),
    rule('temperature_c', '=', 35, { rule_name: 'equal' }),
  ];

  const results = evaluateDatabaseRules(reading(), rules);

  assert.equal(results.length, 5);
  assert.ok(results.every((result) => result.triggered));
});

test('disabled database rules are not evaluated', () => {
  const results = evaluateDatabaseRules(reading(), [
    rule('temperature_c', '>=', 35, { is_enabled: false }),
  ]);

  assert.deepEqual(results, []);
});

test('invalid DHT readings cannot trigger temperature alerts', () => {
  const results = evaluateDatabaseRules(
    reading({ dht_valid: false }),
    [rule('temperature_c', '>=', 35)],
  );

  assert.equal(results[0].evaluated, false);
  assert.equal(results[0].triggered, false);
});

test('invalid distance readings cannot trigger proximity alerts', () => {
  const results = evaluateDatabaseRules(
    reading({ distance_valid: false }),
    [rule('movement_nearby_cm', '<=', 50)],
  );

  assert.equal(results[0].evaluated, false);
  assert.equal(results[0].triggered, false);
});

test('proximity evaluation does not require motion detection', () => {
  const results = evaluateDatabaseRules(
    reading({ motion_detected: false }),
    [rule('movement_nearby_cm', '<=', 50)],
  );

  assert.equal(results[0].triggered, true);
});

test('invalid database rule configurations are rejected', () => {
  assert.throws(
    () => evaluateDatabaseRules(reading(), [
      rule('temperature_c', 'invalid', 35),
    ]),
    /Invalid database alert rule configuration/,
  );

  assert.throws(
    () => evaluateDatabaseRules(reading(), [
      rule('temperature_c', '>=', 'invalid'),
    ]),
    /Invalid database alert rule configuration/,
  );
});

test('unsupported database metrics are rejected explicitly', () => {
  assert.throws(
    () => evaluateDatabaseRules(reading(), [
      rule('unknown_metric', '>=', 1),
    ]),
    /Unsupported database alert metric/,
  );
});

test('empty rule sets produce no evaluations', () => {
  assert.deepEqual(evaluateDatabaseRules(reading(), []), []);
});
