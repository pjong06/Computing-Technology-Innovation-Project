
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadAlertRulesForStation,
} = require('../src/services/iotAlertRuleService');

const STATION_ID = 'station-uuid';

function rule(metric, stationId = null, threshold = 50) {
  return {
    station_id: stationId,
    rule_name: `Test ${metric}`,
    metric,
    comparison_operator: '<=',
    threshold_value: threshold,
    severity: 'high',
    is_enabled: true,
  };
}

function mockClient({ globalRules = [], specificRules = [], errorAt = null } = {}) {
  return {
    from(table) {
      if (table === 'sensor_stations') {
        return {
          select() {
            return {
              eq() { return this; },
              async single() {
                return errorAt === 'station'
                  ? { data: null, error: { message: 'Database error' } }
                  : { data: { id: STATION_ID }, error: null };
              },
            };
          },
        };
      }

      assert.equal(table, 'alert_rules');

      return {
        select() {
          let stationFilter = null;

          const query = {
            is(column, value) {
              assert.equal(column, 'station_id');
              assert.equal(value, null);
              stationFilter = 'global';
              return this;
            },

            eq(column, value) {
              if (column === 'station_id') {
                assert.equal(value, STATION_ID);
                stationFilter = 'specific';
              }

              return this;
            },

            then(resolve, reject) {
              const result = errorAt === stationFilter
                ? { data: null, error: { message: 'Database error' } }
                : {
                    data: stationFilter === 'global'
                      ? globalRules
                      : specificRules,
                    error: null,
                  };

              return Promise.resolve(result).then(resolve, reject);
            },
          };

          return query;
        },
      };
    },
  };
}

test('loads global rules for an active station', async () => {
  const client = mockClient({
    globalRules: [
      rule('temperature_c', null, 35),
      rule('soil_moisture_pct', null, 20),
    ],
  });

  const rules = await loadAlertRulesForStation(client, 'niah-station-01');

  assert.equal(rules.length, 2);
  assert.deepEqual(
    rules.map((item) => item.metric),
    ['temperature_c', 'soil_moisture_pct'],
  );
});

test('station-specific rule overrides global rule for the same metric', async () => {
  const client = mockClient({
    globalRules: [
      rule('movement_nearby_cm', null, 50),
      rule('temperature_c', null, 35),
    ],
    specificRules: [
      rule('movement_nearby_cm', STATION_ID, 100),
    ],
  });

  const rules = await loadAlertRulesForStation(client, 'niah-station-01');

  assert.equal(rules.length, 2);

  const proximityRules = rules.filter(
    (item) => item.metric === 'movement_nearby_cm',
  );

  assert.equal(proximityRules.length, 1);
  assert.equal(proximityRules[0].threshold_value, 100);
});

test('returns no rules when none are configured', async () => {
  const client = mockClient();

  const rules = await loadAlertRulesForStation(client, 'niah-station-01');

  assert.deepEqual(rules, []);
});

test('rejects invalid database clients and station codes', async () => {
  await assert.rejects(
    loadAlertRulesForStation(null, 'niah-station-01'),
    /database client is required/i,
  );

  await assert.rejects(
    loadAlertRulesForStation(mockClient(), ''),
    /station code is required/i,
  );
});

test('rejects database failures when looking up the station', async () => {
  await assert.rejects(
    loadAlertRulesForStation(
      mockClient({ errorAt: 'station' }),
      'niah-station-01',
    ),
    /unable to load the active sensor station/i,
  );
});

test('rejects database failures when loading global rules', async () => {
  await assert.rejects(
    loadAlertRulesForStation(
      mockClient({ errorAt: 'global' }),
      'niah-station-01',
    ),
    /unable to load IoT alert rules/i,
  );
});

test('rejects database failures when loading station-specific rules', async () => {
  await assert.rejects(
    loadAlertRulesForStation(
      mockClient({ errorAt: 'specific' }),
      'niah-station-01',
    ),
    /unable to load IoT alert rules/i,
  );
});
