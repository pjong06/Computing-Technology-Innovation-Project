'use strict';

// The Overview page's Report card: four tabs (Species inventory, Plant records, Field
// observations, IoT alerts), each with date range, status, search and sort; the table, the
// CSV and the PDF contain exactly the same rows. Officer only; no coordinates anywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const zlib = require('node:zlib');
const { mockAuth, callRoute } = require('./helpers/routeTestKit');
const { rankOf, alertType } = require('../src/services/reportService');

const OFFICER = '11111111-1111-4111-8111-111111111111';
let role = 'officer';
let db;
mockAuth(() => ({ userId: OFFICER, role, db }));
const router = require('../src/routes/reports');

// A small database that applies the filters the reports use.
function fakeDb(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      let limit = Infinity;
      let range = null;
      const query = {
        select(columns) { calls.push([table, 'select', columns]); return query; },
        order() { return query; },
        limit(n) { limit = n; return query; },
        range(a, b) { range = [a, b]; return query; },
        eq(c, v) { calls.push([table, 'eq', c, v]); filters.push(r => r[c] === v); return query; },
        is(c, v) { calls.push([table, 'is', c, v]); filters.push(r => (r[c] ?? null) === v); return query; },
        in(c, v) { calls.push([table, 'in', c, v]); filters.push(r => v.includes(r[c])); return query; },
        gte(c, v) { calls.push([table, 'gte', c, v]); filters.push(r => String(r[c] ?? '') >= v); return query; },
        lte(c, v) { calls.push([table, 'lte', c, v]); filters.push(r => String(r[c] ?? '') <= v); return query; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve, reject) {
          const all = rows();
          const data = range ? all.slice(range[0], range[1] + 1) : all.slice(0, limit);
          return Promise.resolve({ data, count: all.length, error: null }).then(resolve, reject);
        },
      };
      const rows = () => (tables[table] || []).filter(r => filters.every(f => f(r)));
      return query;
    },
  };
}

const T = {
  species: [
    { id: 's1', scientific_name: 'Shorea', taxon_rank: 'genus', common_name: 'Meranti', conservation_status: 'CR', verification_status: 'approved', created_at: '2026-11-10T00:00:00Z', taxonomy: { family: 'Dipterocarpaceae' } },
    { id: 's2', scientific_name: 'Aeridinae', taxon_rank: 'other', common_name: null, conservation_status: null, verification_status: 'approved', created_at: '2026-03-01T00:00:00Z', taxonomy: null },
    { id: 's3', scientific_name: 'Begonia niahensis', taxon_rank: 'species', common_name: null, conservation_status: 'EN', verification_status: 'approved', created_at: '2026-11-01T00:00:00Z', taxonomy: { family: 'Begoniaceae' } },
    { id: 's4', scientific_name: 'Pending one', conservation_status: 'CR', verification_status: 'pending', created_at: '2026-11-01T00:00:00Z' },
  ],
  plants: [
    { id: 'p1', species_id: 's1', qr_code_value: 'NIAH-PLT-00001', plant_status: 'approved', location_description: 'Limestone slope, Zone B', registered_by: 'u1', registered_at: '2026-11-05T00:00:00Z', deleted_at: null, latitude: 3.81, longitude: 113.77 },
    { id: 'p2', species_id: 's1', qr_code_value: 'plant:abc', plant_status: 'pending', location_description: null, registered_by: 'u1', registered_at: '2026-10-05T00:00:00Z', deleted_at: null },
    { id: 'p3', species_id: 's3', qr_code_value: 'NIAH-PLT-00003', plant_status: 'approved', registered_by: 'u1', registered_at: '2026-09-05T00:00:00Z', deleted_at: '2026-11-01T00:00:00Z' },
  ],
  observations: [
    { id: 'o1', plant_id: 'p1', observer_id: 'u1', observed_at: '2026-11-06T02:00:00Z', health_status: 'healthy', life_stage: 'seedling_sapling', height_cm: 1250, diameter_cm: 40.5, review_status: 'approved', deleted_at: null },
    { id: 'o2', plant_id: 'p2', observer_id: 'u1', observed_at: '2026-10-06T02:00:00Z', health_status: 'stressed', life_stage: 'mature', height_cm: null, diameter_cm: null, review_status: 'pending', deleted_at: null },
  ],
  profiles: [{ id: 'u1', full_name: 'Aina Rahman' }, { id: OFFICER, full_name: 'Officer Lim' }, { id: 'u9', full_name: 'Ravi K' }],
  sensor_stations: [{ id: 'st1', station_code: 'NIAH-ST-01', latitude: 3.8, longitude: 113.7 }],
  alerts: [
    { id: 'a1', station_id: 'st1', alert_message: 'camera movement nearby', severity: 'high', alert_status: 'open', triggered_at: '2026-11-20T02:00:00Z', resolved_by: null, resolution_notes: null, resolution_source: 'staff' },
    { id: 'a2', station_id: 'st1', alert_message: 'soil_moisture low', severity: 'warning', alert_status: 'resolved', triggered_at: '2026-11-18T02:00:00Z', resolved_by: 'u9', resolution_notes: 'Watered the seedlings', resolution_source: 'staff' },
    { id: 'a3', station_id: 'st1', alert_message: 'camera movement', severity: 'critical', alert_status: 'resolved', triggered_at: '2026-11-19T02:00:00Z', resolved_by: null, resolution_notes: 'No person in the photo', resolution_source: 'ai' },
  ],
};

const get = (path) => callRoute('/api/reports', router, { path });

async function getFile(t, path) {
  const app = express();
  app.use('/api/reports', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reports${path}`);
  return { status: response.status, type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), body: Buffer.from(await response.arrayBuffer()) };
}

// The text drawn in a pdfkit PDF: inflate each content stream and read its strings.
function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  let out = '';
  const streams = raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g);
  for (const [, body] of streams) {
    let content;
    try { content = zlib.inflateSync(Buffer.from(body, 'latin1')).toString('latin1'); } catch { continue; }
    for (const [, hex] of content.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(hex, 'hex').toString('latin1');
    out += '\n';
  }
  return out;
}

test('every report is officer-only', async () => {
  for (const denied of ['botanist', 'researcher', 'admin']) {
    role = denied;
    db = fakeDb(T);
    for (const type of ['inventory', 'plants', 'botanist', 'alerts']) {
      assert.equal((await get(`/${type}`)).status, 403, `${denied} ${type}`);
    }
    assert.deepEqual(db.calls, []);
  }
  role = 'officer';
});

test('species inventory: rank tags, missing family, conservation words, plants recorded; status and sort', async () => {
  db = fakeDb(T);
  const all = (await get('/inventory')).body.data;
  assert.deepEqual(all.rows.map(r => [r.scientific_name, r.rank, r.family, r.conservation_status, r.plant_count]), [
    ['Shorea', 'Genus', 'Dipterocarpaceae', 'Critically Endangered', 2],
    ['Aeridinae', 'Subtribe', '', 'Not assessed', 0],
    ['Begonia niahensis', 'Species', 'Begoniaceae', 'Endangered', 0],
  ]);
  assert.equal(all.unit, 'species');
  assert.deepEqual(all.summary.map(s => [s.label, s.value]), [['Species', 3], ['Threatened (CR + EN)', 2], ['Plants recorded', 2], ['No plants yet', 2]]);
  assert.ok(all.status_options.some(o => o.value === 'threatened' && o.label === 'Threatened (CR + EN)'));
  // Threatened only, most plants first.
  db = fakeDb(T);
  const threatened = (await get('/inventory?status=threatened&sort=plants')).body.data;
  assert.deepEqual(threatened.rows.map(r => r.scientific_name), ['Shorea', 'Begonia niahensis']);
  db = fakeDb(T);
  assert.deepEqual((await get('/inventory?status=NA')).body.data.rows.map(r => r.scientific_name), ['Aeridinae']);
  // Bad values are refused before anything is read.
  for (const bad of ['?status=pending', '?sort=random', `?q=${'x'.repeat(101)}`]) {
    db = fakeDb(T);
    assert.equal((await get(`/inventory${bad}`)).status, 400, bad);
  }
  assert.equal(rankOf('Calamoideae'), 'Subfamily');
  assert.equal(rankOf('Araceae'), 'Family');
  assert.equal(rankOf('Plantae'), 'Group');
});

test('plant records: no coordinates, no placeholder tags, status words; date range and search', async () => {
  db = fakeDb(T);
  const data = (await get('/plants')).body.data;
  assert.deepEqual(data.columns.map(c => c.label), ['Plant tag', 'Species', 'Location note', 'Status', 'Registered by', 'First recorded', 'Last observation']);
  assert.deepEqual(data.rows.map(r => [r.plant_tag, r.plant_status, r.last_observation]), [
    ['NIAH-PLT-00001', 'Approved', '2026-11-06'],
    ['No physical tag yet', 'Waiting for review', '2026-10-06'],
  ]);
  assert.doesNotMatch(JSON.stringify(data), /latitude|longitude|3\.81|113\.77|plant:abc/);
  // "First recorded" range: only plants registered in it.
  db = fakeDb(T);
  const november = (await get('/plants?from=2026-11-01&to=2026-11-30')).body.data;
  assert.deepEqual(november.rows.map(r => r.plant_tag), ['NIAH-PLT-00001']);
  assert.match(november.filters_text, /^First recorded: 1 Nov 2026 – 30 Nov 2026 · Status: All · Sort: Newest first$/);
  // Search in any shown column.
  db = fakeDb(T);
  assert.deepEqual((await get('/plants?q=zone%20b')).body.data.rows.map(r => r.plant_tag), ['NIAH-PLT-00001']);
});

test('field observations: Height (m) / Diameter (cm), words for health, stage and status', async () => {
  db = fakeDb(T);
  const data = (await get('/botanist?status=approved')).body.data;
  assert.ok(data.columns.some(c => c.label === 'Height (m)') && data.columns.some(c => c.label === 'Diameter (cm)'));
  assert.deepEqual(data.rows, [{
    observed_at: '2026-11-06', scientific_name: 'Shorea', plant_tag: 'NIAH-PLT-00001', botanist: 'Aina Rahman',
    health_status: 'Healthy', life_stage: 'Seedling sapling', height_m: 12.5, diameter_cm: 40.5,
    review_status: 'Approved', status_code: 'approved',
  }]);
});

test('IoT alerts report: time, station, type, severity, status, resolved by, note; no station locations', async () => {
  db = fakeDb(T);
  const data = (await get('/alerts')).body.data;
  assert.deepEqual(data.columns.map(c => c.label), ['Time', 'Station', 'Type', 'Severity', 'Status', 'Resolved by', 'Note']);
  assert.deepEqual(data.rows.map(r => [r.station, r.type, r.severity, r.alert_status, r.resolved_by, r.note]), [
    ['NIAH-ST-01', 'Movement', 'High', 'Open', '', ''],
    ['NIAH-ST-01', 'Movement', 'Critical', 'Resolved', 'AI (camera check)', 'No person in the photo'],
    ['NIAH-ST-01', 'Soil moisture', 'Warning', 'Resolved', 'Ravi K', 'Watered the seedlings'],
  ]);
  assert.equal(data.rows[0].triggered_at, '20 Nov 2026, 10:00', 'Sarawak time');
  assert.ok(db.calls.some(c => c[0] === 'sensor_stations' && c[1] === 'select' && c[2] === 'id, station_code'));
  assert.doesNotMatch(JSON.stringify(data), /latitude|longitude|113\.7/);
  db = fakeDb(T);
  assert.deepEqual((await get('/alerts?sort=severity')).body.data.rows.map(r => r.severity), ['Critical', 'High', 'Warning']);
  db = fakeDb(T);
  assert.deepEqual((await get('/alerts?status=open')).body.data.rows.length, 1);
  assert.equal(alertType('rain_intensity high'), 'Rain');
});

test('CSV: the filters as the first line, then the same columns and rows as the table', async (t) => {
  db = fakeDb(T);
  const table = (await get('/inventory?status=threatened&q=shorea')).body.data;
  db = fakeDb(T);
  const csv = await getFile(t, '/inventory?status=threatened&q=shorea&format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.disposition, /filename="niah-species-inventory-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = csv.body.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], '"Species inventory · First recorded: all time · Status: Threatened (CR + EN) · Search: ""shorea"" · Sort: Name A–Z"');
  assert.equal(lines[1], table.columns.map(c => `"${c.label}"`).join(','));
  assert.equal(lines.length, 2 + table.rows.length);
  assert.match(lines[2], /^"Shorea","Genus","Meranti","Dipterocarpaceae","Critically Endangered","2",/);
});

test('PDF: header, title, generated by the officer, filters, summary figures, table and footer; never coordinates', async (t) => {
  db = fakeDb(T);
  const pdf = await getFile(t, '/plants?from=2026-10-01&to=2026-11-30&format=pdf');
  assert.equal(pdf.status, 200);
  assert.match(pdf.type, /application\/pdf/);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  const text = pdfText(pdf.body);
  for (const expected of [
    'Niah BioTrack · Sarawak Forestry Corporation'.replace('·', '\xb7'),
    'Plant records',
    'by Officer Lim',
    'First recorded: 1 Oct 2026 \x96 30 Nov 2026',
    'Waiting for review',
    'NIAH-PLT-00001',
    'Locations are not included. Confidential: for SFC staff use.',
    'Page 1 of 1',
  ]) {
    assert.ok(text.includes(expected), `PDF has "${expected}"`);
  }
  assert.match(text, /Generated \d{1,2} \w{3} \d{4}, \d{2}:\d{2} by Officer Lim/);
  assert.doesNotMatch(text, /Latitude|Longitude|3\.81|113\.77/);
  // Even the older locations report, which has coordinates in its data, prints none.
  db = fakeDb({ ...T, plant_map_points: [{ id: 'p1', species_id: 's1', qr_code_value: 'NIAH-PLT-00001', plant_status: 'approved', latitude: 3.81, longitude: 113.77 }] });
  const legacy = pdfText((await getFile(t, '/locations?format=pdf')).body);
  assert.ok(legacy.includes('Plant locations'));
  assert.doesNotMatch(legacy, /Latitude|Longitude|3\.81|113\.77/);
});
