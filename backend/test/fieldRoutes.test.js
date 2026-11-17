'use strict';

// Trace routes, phase 1 (docs/trace-route-plan.md, section 7.1, backend part):
// POST /api/routes (botanists upload their own route) and
// GET /api/officer/map/routes (officers read all routes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');

const BOTANIST = '11111111-1111-4111-8111-111111111111';
const OTHER_BOTANIST = '55555555-5555-4555-8555-555555555555';
const ROUTE_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ROUTE_ID = '33333333-3333-4333-8333-333333333333';
const PLANT_ID = '44444444-4444-4444-8444-444444444444';
const SPECIES_ID = '66666666-6666-4666-8666-666666666666';

let role = 'botanist';
let db;
mockAuth(() => ({ userId: BOTANIST, role, db }));

const fieldRoutes = require('../src/routes/fieldRoutes');
const officerMap = require('../src/routes/officerMap');

// A small stand-in for the Supabase client. answers[table] is a list of results used in
// order for that table ({ data, error }); every call is recorded.
function fakeDb(answers = {}) {
  const calls = [];
  const used = {};
  const next = table => {
    const list = answers[table] || [];
    const index = used[table] || 0;
    used[table] = index + 1;
    return list[Math.min(index, list.length - 1)] || { data: null, error: null };
  };
  return {
    calls,
    from(table) {
      const query = {};
      for (const name of ['select', 'eq', 'in', 'is', 'gte', 'lte', 'order', 'limit']) {
        query[name] = (...args) => { calls.push([table, name, ...args]); return query; };
      }
      query.insert = row => { calls.push([table, 'insert', row]); return query; };
      query.maybeSingle = async () => next(table);
      query.single = async () => next(table);
      query.then = (resolve, reject) => Promise.resolve(next(table)).then(resolve, reject);
      return query;
    },
  };
}

function validRoute(overrides = {}) {
  return {
    client_route_id: CLIENT_ROUTE_ID,
    started_at: '2026-11-18T01:00:00.000Z',
    ended_at: '2026-11-18T01:30:00.000Z',
    distance_m: 842.5,
    duration_s: 1800,
    points: [
      [3.8176, 113.781, 1795400000000, 6],
      [3.8179, 113.7814, 1795400002000, 8],
      [3.8183, 113.7819, 1795400004000, null],
    ],
    waypoints: [{ number: 1, label: 'Cave entrance', lat: 3.8179, lng: 113.7814, time: '9:01 AM' }],
    ...overrides,
  };
}

const upload = body => callRoute('/api/routes', fieldRoutes, { method: 'POST', body });
const readRoutes = (query = '') => callRoute('/api/officer/map', officerMap, { path: `/routes${query}` });

// ---- POST /api/routes ----

test('a botanist uploads a route: 201 with its id, saved as their own route', async () => {
  role = 'botanist';
  db = fakeDb({
    field_routes: [
      { data: null, error: null },              // not uploaded before
      { data: { id: ROUTE_ID }, error: null },  // insert
    ],
  });
  const result = await upload(validRoute());
  assert.equal(result.status, 201);
  assert.equal(result.body.data.id, ROUTE_ID);

  const insert = db.calls.find(call => call[0] === 'field_routes' && call[1] === 'insert');
  assert.ok(insert, 'the route is inserted');
  const row = insert[2];
  assert.equal(row.recorded_by, BOTANIST);
  assert.equal(row.client_route_id, CLIENT_ROUTE_ID);
  assert.equal(row.plant_id, null);
  assert.equal(row.point_count, 3);
  assert.deepEqual(row.points[2], [3.8183, 113.7819, 1795400004000, null]);
  assert.deepEqual(row.waypoints, [{ number: 1, label: 'Cave entrance', lat: 3.8179, lng: 113.7814, time: '9:01 AM' }]);
});

test('uploading the same route again returns 200 with the same id, without a second insert', async () => {
  role = 'botanist';
  db = fakeDb({ field_routes: [{ data: { id: ROUTE_ID }, error: null }] });
  const result = await upload(validRoute());
  assert.equal(result.status, 200);
  assert.equal(result.body.data.id, ROUTE_ID);
  assert.ok(!db.calls.some(call => call[1] === 'insert'));
  // The lookup is limited to this botanist's own routes.
  assert.ok(db.calls.some(call => call[1] === 'eq' && call[2] === 'recorded_by' && call[3] === BOTANIST));
  assert.ok(db.calls.some(call => call[1] === 'eq' && call[2] === 'client_route_id' && call[3] === CLIENT_ROUTE_ID));
});

test('two uploads of the same route at once: the one that loses the race gets 200 with the saved id', async () => {
  role = 'botanist';
  db = fakeDb({
    field_routes: [
      { data: null, error: null },                                      // not there yet
      { data: null, error: { code: '23505', message: 'duplicate key' } }, // insert lost the race
      { data: { id: ROUTE_ID }, error: null },                           // read the saved row
    ],
  });
  const result = await upload(validRoute());
  assert.equal(result.status, 200);
  assert.equal(result.body.data.id, ROUTE_ID);
});

test('a linked plant is checked and stored; an unknown plant gets a plain 400', async () => {
  role = 'botanist';
  db = fakeDb({
    field_routes: [{ data: null, error: null }, { data: { id: ROUTE_ID }, error: null }],
    plants: [{ data: { id: PLANT_ID }, error: null }],
  });
  const linked = await upload(validRoute({ plant_id: PLANT_ID }));
  assert.equal(linked.status, 201);
  assert.equal(db.calls.find(call => call[1] === 'insert')[2].plant_id, PLANT_ID);
  assert.ok(db.calls.some(call => call[0] === 'plants' && call[1] === 'is' && call[2] === 'deleted_at'));

  db = fakeDb({ field_routes: [{ data: null, error: null }], plants: [{ data: null, error: null }] });
  const unknown = await upload(validRoute({ plant_id: PLANT_ID }));
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.message, /linked plant was not found/);
  assert.ok(!db.calls.some(call => call[1] === 'insert'));
});

test('upload validation: plain 400 messages and nothing is saved', async () => {
  role = 'botanist';
  const tooManyPoints = Array.from({ length: 20001 }, (_, i) => [3.8, 113.7, 1795400000000 + i, 5]);
  const cases = [
    [{ client_route_id: undefined }, /client_route_id/],
    [{ client_route_id: 'not-a-uuid' }, /client_route_id/],
    [{ points: [] }, /no GPS points/],
    [{ points: undefined }, /no GPS points/],
    [{ points: [[91, 113.7, 1795400000000, 5]] }, /latitude or longitude out of range/],
    [{ points: [[3.8, 181, 1795400000000, 5]] }, /latitude or longitude out of range/],
    [{ points: [[3.8, 113.7, 'yesterday', 5]] }, /no valid time/],
    [{ points: [[3.8, 113.7, 1795400000000, -1]] }, /accuracy/],
    [{ duration_s: -1 }, /walking time/],
    [{ duration_s: 86401 }, /walking time/],
    [{ distance_m: -5 }, /distance/],
    [{ distance_m: 100001 }, /distance/],
    [{ started_at: 'soon' }, /start and end times/],
    [{ ended_at: '2026-11-18T00:00:00.000Z' }, /ends before it starts/],
    [{ plant_id: 'plant-1' }, /linked plant ID is not valid/],
    [{ waypoints: Array.from({ length: 201 }, (_, i) => ({ number: i + 1, lat: 3.8, lng: 113.7 })) }, /too many waypoints/],
    [{ waypoints: [{ number: 1, lat: 95, lng: 113.7 }] }, /Waypoint 1 has a latitude or longitude/],
  ];
  for (const [change, message] of cases) {
    db = fakeDb();
    const result = await upload(validRoute(change));
    assert.equal(result.status, 400, JSON.stringify(change).slice(0, 80));
    assert.match(result.body.message, message);
    assert.equal(db.calls.length, 0, 'the database is not touched');
  }

  // 20,001 points (about 560 KB) is checked by the validator directly: the test kit's
  // parser has Express's default 100 KB limit, the real app allows 25 MB.
  assert.match(
    fieldRoutes.validateRoutePayload(validRoute({ points: tooManyPoints })).error,
    /too many GPS points \(at most 20000\)/
  );
  const atCap = fieldRoutes.validateRoutePayload(validRoute({ points: tooManyPoints.slice(0, 20000) }));
  assert.equal(atCap.route.point_count, 20000);
});

test('only botanists can upload routes: officer, researcher and visitor get 403', async () => {
  for (const other of ['officer', 'researcher', 'visitor']) {
    role = other;
    db = fakeDb();
    const result = await upload(validRoute());
    assert.equal(result.status, 403, other);
    assert.equal(db.calls.length, 0);
  }
});

test('uploads are limited per botanist (30 a minute)', async () => {
  let time = 0;
  const limit = fieldRoutes.createRouteUploadLimit({ limit: 2, windowMs: 60000, now: () => time });
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    const res = { set() {}, status(code) { statuses.push(code); return { json() {} }; } };
    limit({ user: { id: BOTANIST } }, res, () => statuses.push('next'));
  }
  assert.deepEqual(statuses, ['next', 'next', 429]);
  // Another botanist has their own count.
  limit({ user: { id: OTHER_BOTANIST } }, { set() {}, status() { return { json() {} }; } }, () => statuses.push('other'));
  assert.equal(statuses.at(-1), 'other');
});

// ---- GET /api/officer/map/routes ----

test('an officer reads routes: names, linked plant, waypoints and points', async () => {
  role = 'officer';
  db = fakeDb({
    field_routes: [{
      data: [{
        id: ROUTE_ID, recorded_by: BOTANIST, plant_id: PLANT_ID,
        started_at: '2026-11-18T01:00:00Z', ended_at: '2026-11-18T01:30:00Z',
        distance_m: '842.5', duration_s: 1800, point_count: 2,
        points: [[3.8176, 113.781, 1, 6], [3.8179, 113.7814, 2, 8]],
        waypoints: [{ number: 1, label: 'Cave entrance', lat: 3.8179, lng: 113.7814, time: '9:01 AM' }],
      }],
      error: null,
    }],
    profiles: [{ data: [{ id: BOTANIST, full_name: 'Aron' }], error: null }],
    plants: [{ data: [{ id: PLANT_ID, qr_code_value: 'NIAH-PLT-00008', species_id: SPECIES_ID }], error: null }],
    species: [{ data: [{ id: SPECIES_ID, scientific_name: 'Nepenthes ampullaria' }], error: null }],
  });
  const result = await readRoutes();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data[0], {
    id: ROUTE_ID,
    recorded_by: 'Aron',
    started_at: '2026-11-18T01:00:00Z',
    ended_at: '2026-11-18T01:30:00Z',
    distance_m: 842.5,
    duration_s: 1800,
    point_count: 2,
    plant: { id: PLANT_ID, tag: 'NIAH-PLT-00008', scientific_name: 'Nepenthes ampullaria' },
    waypoints: [{ number: 1, label: 'Cave entrance', lat: 3.8179, lng: 113.7814, time: '9:01 AM' }],
    points: [[3.8176, 113.781, 1, 6], [3.8179, 113.7814, 2, 8]],
  });
});

test('without dates only routes that ended in the last 90 days are read; dates are checked', async () => {
  role = 'officer';
  db = fakeDb({ field_routes: [{ data: [], error: null }] });
  const before = Date.now();
  const result = await readRoutes();
  assert.equal(result.status, 200);
  const since = db.calls.find(call => call[0] === 'field_routes' && call[1] === 'gte');
  assert.equal(since[2], 'ended_at');
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(Date.parse(since[3]) - (before - ninetyDays)) < 60000, 'about 90 days ago');
  assert.ok(!db.calls.some(call => call[1] === 'lte'), 'no end date by default');

  db = fakeDb({ field_routes: [{ data: [], error: null }] });
  const ranged = await readRoutes('?from=2026-10-01&to=2026-10-31');
  assert.equal(ranged.status, 200);
  assert.ok(db.calls.some(call => call[1] === 'gte' && call[3] === '2026-10-01T00:00:00.000Z'));
  assert.ok(db.calls.some(call => call[1] === 'lte' && call[3] === '2026-10-31T23:59:59.999Z'));

  for (const query of ['?from=yesterday', '?to=31/10/2026', '?from=2026-11-10&to=2026-11-01']) {
    db = fakeDb();
    const bad = await readRoutes(query);
    assert.equal(bad.status, 400, query);
    assert.equal(db.calls.length, 0);
  }
});

test('only officers read the map routes: botanist, researcher and visitor get 403', async () => {
  for (const other of ['botanist', 'researcher', 'visitor']) {
    role = other;
    db = fakeDb();
    const result = await readRoutes();
    assert.equal(result.status, 403, other);
    assert.equal(db.calls.length, 0);
  }
});

test('long routes are thinned to at most 2,000 points, keeping the first and last', async () => {
  const { thinPoints } = officerMap;
  const points = Array.from({ length: 20000 }, (_, i) => [3.8, 113.7, i, 5]);
  const thinned = thinPoints(points);
  assert.ok(thinned.length <= 2000 && thinned.length > 1500, `got ${thinned.length}`);
  assert.equal(thinned[0], points[0]);
  assert.equal(thinned.at(-1), points.at(-1));
  for (const length of [2001, 2500, 3999, 4001]) {
    const some = Array.from({ length }, (_, i) => [0, 0, i, 0]);
    const out = thinPoints(some);
    assert.ok(out.length <= 2000, `${length} -> ${out.length}`);
    assert.equal(out.at(-1), some.at(-1));
  }
  // Short routes are returned unchanged.
  const short = points.slice(0, 2000);
  assert.equal(thinPoints(short), short);

  role = 'officer';
  db = fakeDb({
    field_routes: [{ data: [{ id: ROUTE_ID, recorded_by: BOTANIST, plant_id: null, points, waypoints: [], point_count: 20000 }], error: null }],
    profiles: [{ data: [], error: null }],
  });
  const result = await readRoutes();
  assert.ok(result.body.data[0].points.length <= 2000);
  assert.equal(result.body.data[0].point_count, 20000, 'the stored count is unchanged');
  assert.equal(result.body.data[0].plant, null);
});

// ---- Wiring and the migration ----

test('server.js mounts the routes once; sync.js is not involved', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.equal((server.match(/require\('\.\/routes\/fieldRoutes'\)/g) || []).length, 1);
  assert.match(server, /app\.use\('\/api\/routes', require\('\.\/routes\/fieldRoutes'\)\);/);
  assert.match(server, /app\.use\('\/api\/sync', requireAuth, requireRole\('botanist'\), syncRoutes\);/);
  const sync = fs.readFileSync(path.join(__dirname, '../src/routes/sync.js'), 'utf8');
  assert.doesNotMatch(sync, /field_routes|fieldRoutes/);
  const fieldRoutesSource = fs.readFileSync(path.join(__dirname, '../src/routes/fieldRoutes.js'), 'utf8');
  assert.match(fieldRoutesSource, /router\.use\(requireAuth, requireRole\("botanist"\)\)/);
});

test('migration: field_routes with RLS, botanists own rows, officers read all, no update/delete', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../supabase/migrations/20261118100000_field_routes.sql'), 'utf8'
  ).replace(/--[^\n]*/g, '');
  assert.match(sql, /CREATE TABLE public\.field_routes/);
  assert.match(sql, /recorded_by uuid NOT NULL REFERENCES auth\.users\(id\)/);
  assert.match(sql, /plant_id uuid NULL REFERENCES public\.plants\(id\) ON DELETE SET NULL/);
  assert.match(sql, /UNIQUE \(recorded_by, client_route_id\)/);
  assert.match(sql, /BETWEEN 1 AND 20000/);
  assert.match(sql, /jsonb_array_length\(waypoints\) <= 200/);
  assert.match(sql, /CREATE INDEX field_routes_ended_at_idx ON public\.field_routes \(ended_at DESC\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.field_routes FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT SELECT, INSERT ON public\.field_routes TO authenticated;/);
  // Exactly three policies: botanist insert own, botanist read own, officer read all.
  assert.equal((sql.match(/CREATE POLICY/g) || []).length, 3);
  assert.match(sql, /FOR INSERT TO authenticated\s+WITH CHECK \(\s*recorded_by = \(SELECT auth\.uid\(\)\)\s+AND \(SELECT public\.current_app_role\(\)\) = 'botanist'/);
  assert.match(sql, /FOR SELECT TO authenticated\s+USING \(\s*recorded_by = \(SELECT auth\.uid\(\)\)\s+AND \(SELECT public\.current_app_role\(\)\) = 'botanist'/);
  assert.match(sql, /FOR SELECT TO authenticated\s+USING \(\(SELECT public\.current_app_role\(\)\) = 'officer'\)/);
  // Nothing for researchers, visitors or anon, and no way to change or remove routes.
  assert.doesNotMatch(sql, /researcher|visitor/);
  assert.doesNotMatch(sql, /FOR UPDATE|FOR DELETE|FOR ALL|GRANT [^;]*(UPDATE|DELETE)|TO anon|DISABLE ROW LEVEL SECURITY/);
});
