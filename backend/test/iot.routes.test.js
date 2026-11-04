
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const telemetryPath = require.resolve('../src/services/iotTelemetryService');
const alertPath = require.resolve('../src/services/iotAlertService');

// Test-only telemetry responses. No MQTT connection needed.
require.cache[telemetryPath] = {
  id: telemetryPath,
  filename: telemetryPath,
  loaded: true,
  exports: {
    getLatestReadings: () => [
      { station_id: 'station-1', temperature_c: 27 }
    ],
    getRecentReadings: () => [
      { station_id: 'station-1', temperature_c: 27 }
    ],
    getSummary: () => ({
      total_stations: 1,
      online_stations: 1
    })
  }
};

// Test-only alerts.
const sampleAlerts = [
  { id: 'alert-1', severity: 'critical', status: 'active' },
  { id: 'alert-2', severity: 'warning', status: 'resolved' }
];

require.cache[alertPath] = {
  id: alertPath,
  filename: alertPath,
  loaded: true,
  exports: {
    getAlerts: ({ status, limit }) =>
      sampleAlerts
        .filter(alert => !status || alert.status === status)
        .slice(0, limit),
    getActiveAlerts: () =>
      sampleAlerts.filter(alert => alert.status === 'active')
  }
};

const iotRouter = require('../src/routes/iot');

const sampleData = {
  sensor_readings: [
    {
      id: 'reading-1',
      station_id: 'station-1',
      temperature_c: 27,
      humidity_percent: 75
    }
  ],
  sensor_stations: [
    {
      id: 'station-1',
      station_code: 'NIAH-01',
      station_status: 'active'
    },
    {
      id: 'station-2',
      station_code: 'NIAH-02',
      station_status: 'inactive'
    }
  ],
  alerts: [
    {
      id: 'db-alert-1',
      station_id: 'station-1',
      severity: 'warning'
    }
  ]
};

function fakeSupabase(errorTable = null) {
  return {
    from(table) {
      assert.ok(
        Object.hasOwn(sampleData, table),
        `Unexpected table: ${table}`
      );

      const result = () => ({
        data: errorTable === table ? null : sampleData[table],
        error: errorTable === table
          ? { message: 'Simulated database error' }
          : null
      });

      const query = {
        order() {
          return this;
        },
        limit: async () => result(),
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        }
      };

      return {
        select() {
          return query;
        }
      };
    }
  };
}

async function withApp(run, errorTable = null, profile = { role: 'officer', account_status: 'active' }) {
  const app = express();

  // Supply a mock database only in this test application.
  app.use('/api/iot', (req, _res, next) => {
    req.supabase = fakeSupabase(errorTable);
    req.profile = profile;
    next();
  });

  app.use('/api/iot', iotRouter);

  const server = await new Promise(resolve => {
    const instance = app.listen(
      0,
      '127.0.0.1',
      () => resolve(instance)
    );
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    );
  }
}

async function get(base, endpoint) {
  const response = await fetch(`${base}/api/iot${endpoint}`);
  return {
    status: response.status,
    body: await response.json()
  };
}

test('5.2: retrieves sensor history from database', async () => {
  await withApp(async base => {
    const result = await get(base, '/readings/history');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].temperature_c, 27);
  });
});

test('5.2: retrieves recent live readings', async () => {
  await withApp(async base => {
    const result = await get(base, '/readings?limit=10');
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].station_id, 'station-1');
  });
});

test('5.2: retrieves latest station readings', async () => {
  await withApp(async base => {
    const result = await get(base, '/latest');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length, 1);
  });
});

test('5.2: calculates database station summary', async () => {
  await withApp(async base => {
    const result = await get(base, '/summary');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.total_stations, 2);
    assert.equal(result.body.data.active_stations, 1);
  });
});

test('5.2: retrieves live dashboard summary', async () => {
  await withApp(async base => {
    const result = await get(base, '/summary/live');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.online_stations, 1);
  });
});

test('5.2: retrieves stored database alerts', async () => {
  await withApp(async base => {
    const result = await get(base, '/alerts');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].id, 'db-alert-1');
  });
});

test('5.2: filters live alerts and calculates counts', async () => {
  await withApp(async base => {
    const result = await get(base, '/alerts/live?status=active');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.summary.active, 1);
    assert.equal(result.body.summary.critical, 1);
    assert.equal(result.body.summary.warning, 0);
  });
});

test('5.2: rejects invalid alert query parameters', async () => {
  await withApp(async base => {
    const badStatus = await get(base, '/alerts/live?status=unknown');
    const badLimit = await get(base, '/alerts/live?limit=-1');

    assert.equal(badStatus.status, 400);
    assert.equal(badLimit.status, 400);
  });
});

test('5.2: handles database query errors', async () => {
  await withApp(async base => {
    const result = await get(base, '/readings/history');
    assert.equal(result.status, 500);
    assert.equal(result.body.message, 'Failed to retrieve sensor readings');
  }, 'sensor_readings');
});

test('active staff can read readings and alerts while station summaries stay Officer-only', async () => {
  for (const role of ['officer', 'botanist', 'researcher']) {
    await withApp(async base => {
      for (const endpoint of ['/readings/history', '/readings', '/latest', '/alerts', '/alerts/live']) {
        assert.equal((await get(base, endpoint)).status, 200, `${role} ${endpoint}`);
        assert.equal((await fetch(`${base}/api/iot${endpoint}`, { method: 'HEAD' })).status, 200);
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const write = await fetch(`${base}/api/iot${endpoint}`, { method });
          assert.equal(write.status, role === 'officer' ? 404 : 403, `${role} ${method} ${endpoint}`);
        }
      }
      for (const endpoint of ['/summary', '/summary/live']) {
        assert.equal((await get(base, endpoint)).status, role === 'officer' ? 200 : 403, `${role} ${endpoint}`);
      }
      if (role !== 'officer') {
        assert.equal((await get(base, '/future-management-route')).status, 403);
      }
    }, null, { role, account_status: 'active' });
  }
});

test('readings and alerts reject anonymous, visitor, legacy Admin and inactive profiles', async () => {
  for (const profile of [null, { role: 'visitor', account_status: 'active' },
    { role: 'admin', account_status: 'active' }, { role: 'botanist', account_status: 'suspended' },
    { role: 'researcher', account_status: 'suspended' }, { role: 'officer', account_status: 'suspended' }]) {
    await withApp(async base => {
      for (const endpoint of ['/readings/history', '/readings', '/latest', '/alerts', '/alerts/live']) {
        const result = await get(base, endpoint);
        assert.equal(result.status, profile ? 403 : 401);
        assert.equal(result.body.data, undefined);
      }
    }, null, profile);
  }
});
