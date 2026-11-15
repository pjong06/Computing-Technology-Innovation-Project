'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const SPECIES_ID = '44444444-4444-4444-8444-444444444444';
const PLANT_ID = '33333333-3333-4333-8333-333333333333';
const TEST_PLANT_ID = '66666666-6666-4666-8666-666666666666';

let role = 'officer';
let db;
mockAuth(() => ({ userId: '11111111-1111-4111-8111-111111111111', role, db }));

const router = require('../src/routes/officerMap');

function fakeDb(tables = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = {};
      for (const method of ['select', 'in', 'is', 'limit']) {
        query[method] = (...args) => {
          calls.push([table, method, ...args]);
          return query;
        };
      }
      query.then = (resolve, reject) => {
        const answer = tables[table] || { data: [], error: null };
        return Promise.resolve(answer).then(resolve, reject);
      };
      return query;
    },
  };
}

async function getPlants() {
  return callRoute('/api/officer/map', router, { path: '/plants' });
}

test('officer gets plants combined with species and their latest visit', async () => {
  role = 'officer';
  db = fakeDb({
    plant_map_points: {
      data: [{
        id: PLANT_ID,
        latitude: 3.2,
        longitude: 113.7,
        qr_code_value: 'NIAH-PLT-1',
        plant_status: 'healthy',
        location_description: 'Near the trail',
        species_id: SPECIES_ID,
      }],
      error: null,
    },
    species: {
      data: [{
        id: SPECIES_ID,
        scientific_name: 'Nepenthes ampullaria',
        common_name: 'Pitcher plant',
        conservation_status: 'LC',
      }],
      error: null,
    },
    observations: {
      data: [
        { plant_id: PLANT_ID, observed_at: '2026-10-01T10:00:00Z' },
        { plant_id: PLANT_ID, observed_at: '2026-11-02T10:00:00Z' },
      ],
      error: null,
    },
  });

  const result = await getPlants();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, [{
    id: PLANT_ID,
    latitude: 3.2,
    longitude: 113.7,
    tag: 'NIAH-PLT-1',
    status: 'healthy',
    landmark: 'Near the trail',
    species: {
      id: SPECIES_ID,
      scientific_name: 'Nepenthes ampullaria',
      common_name: 'Pitcher plant',
      conservation_status: 'LC',
    },
    last_visit: '2026-11-02T10:00:00Z',
  }]);
  assert.ok(db.calls.some(call => call[0] === 'plant_map_points' && call[1] === 'select' &&
    call[2] === 'id, latitude, longitude, qr_code_value, plant_status, location_description, species_id'));
  assert.ok(db.calls.some(call => call[0] === 'observations' && call[1] === 'is' &&
    call[2] === 'deleted_at' && call[3] === null));
});

test('0,0 test plants are omitted from map results', async () => {
  role = 'officer';
  db = fakeDb({
    plant_map_points: {
      data: [
        { id: PLANT_ID, latitude: 3.2, longitude: 113.7, species_id: null },
        { id: TEST_PLANT_ID, latitude: 0, longitude: 0, species_id: null },
      ],
      error: null,
    },
  });

  const result = await getPlants();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map(plant => plant.id), [PLANT_ID]);
});

test('plants without a species return species null and skip the species lookup', async () => {
  role = 'officer';
  db = fakeDb({
    plant_map_points: {
      data: [{ id: PLANT_ID, latitude: 3.2, longitude: 113.7, species_id: null }],
      error: null,
    },
  });

  const result = await getPlants();
  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].species, null);
  assert.ok(!db.calls.some(call => call[0] === 'species'));
});

test('botanists, researchers, and visitors cannot access the map API', async () => {
  for (const disallowedRole of ['botanist', 'researcher', 'visitor']) {
    role = disallowedRole;
    db = fakeDb();
    const result = await getPlants();
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { message: 'Insufficient permissions' });
    assert.equal(db.calls.length, 0);
  }
  role = 'officer';
});

test('database errors return a generic message and are logged', async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    for (const failedTable of ['plant_map_points', 'species', 'observations']) {
      role = 'officer';
      const tables = {
        plant_map_points: {
          data: [{ id: PLANT_ID, latitude: 3.2, longitude: 113.7, species_id: SPECIES_ID }],
          error: null,
        },
        species: { data: [{ id: SPECIES_ID }], error: null },
        observations: { data: [], error: null },
      };
      tables[failedTable] = { data: null, error: { message: 'SECRET_DATABASE_DETAILS' } };
      db = fakeDb(tables);

      const result = await getPlants();
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { message: 'Could not load plant locations' });
      assert.ok(!JSON.stringify(result.body).includes('SECRET_DATABASE_DETAILS'));
    }
  } finally {
    console.error = originalError;
  }
  assert.equal(logged.length, 3);
  assert.ok(logged.every(args => args[0] === 'Map plants error:' &&
    args[1].message === 'SECRET_DATABASE_DETAILS'));
});


test('officer can retrieve sensor station locations', async () => {
  role = 'officer';

  db = fakeDb({
    sensor_stations: {
      data: [
        {
          id: 'station-1',
          station_code: 'NIAH-01',
          station_status: 'active',
          latitude: 3.2,
          longitude: 113.7,
          location_note: 'Near the main trail',
        },
        {
          id: 'station-2',
          station_code: 'NIAH-02',
          station_status: 'active',
          latitude: null,
          longitude: null,
          location_note: null,
        },
      ],
      error: null,
    },
  });

  const result = await callRoute('/api/officer/map', router, {
    path: '/stations',
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 1);
  assert.equal(result.body.data[0].station_code, 'NIAH-01');
  assert.equal(result.body.data[0].location_note, 'Near the main trail');
});


test('only officers can view sensor station locations', async () => {
  db = fakeDb({
    sensor_stations: {
      data: [{
        id: 'station-1',
        station_code: 'NIAH-01',
        station_status: 'active',
        latitude: 3.2,
        longitude: 113.7,
        location_note: 'Test location',
      }],
      error: null,
    },
  });

  for (const deniedRole of ['botanist', 'researcher', 'visitor']) {
    role = deniedRole;

    const result = await callRoute('/api/officer/map', router, {
      path: '/stations',
    });

    assert.equal(result.status, 403);
  }

  role = 'officer';
});


test('sensor station database errors return a safe message', async () => {
  role = 'officer';

  db = fakeDb({
    sensor_stations: {
      data: null,
      error: { message: 'SECRET_DATABASE_DETAILS' },
    },
  });

  const originalError = console.error;
  console.error = () => {};

  try {
    const result = await callRoute('/api/officer/map', router, {
      path: '/stations',
    });

    assert.equal(result.status, 500);
    assert.equal(
      result.body.message,
      'Could not load sensor station locations'
    );
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /SECRET_DATABASE_DETAILS/
    );
  } finally {
    console.error = originalError;
  }
});
