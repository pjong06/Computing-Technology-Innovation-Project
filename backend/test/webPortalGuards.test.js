'use strict';

// The web portal was replaced once by an older upload that brought back sample data,
// browser-only reviews and user changes, and public sign-up. These checks read the
// portal's source so that kind of revert fails the test run instead of going unnoticed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// ---- No sample data, and load errors are shown ----

test('shared.js seeds no sample data and has no upgradeOldData wipe', () => {
  const shared = read('frontend/js/shared.js');
  assert.doesNotMatch(shared, /makeStarting(Species|Observations|Users)/);
  assert.doesNotMatch(shared, /upgradeOldData/);
  assert.doesNotMatch(shared, /REMOVED_SAMPLE_EMAILS|OLD_DEMO_HASHES/);
});

test('shared.js shows the database error banner on every page with a menu', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /function showDatabaseProblem\(\)/);
  const drawMenu = shared.slice(shared.indexOf('function drawMenu('));
  assert.match(drawMenu.slice(0, drawMenu.indexOf('\n}')), /showDatabaseProblem\(\);/);
});

// ---- Reviews use the real officer API ----

test('the approval queue loads, shows photos for and decides on real reviews', () => {
  const queue = read('frontend/js/queue.js');
  assert.match(queue, /api\('\/officer\/reviews\/pending'\)/);
  assert.match(queue, /'\/officer\/reviews\/' \+ id \+ '\/photos'/);
  assert.match(queue, /'\/officer\/reviews\/' \+ id \+ '\/decision'/);
  assert.doesNotMatch(queue, /getObservations\(|writeStorage\(OBSERVATIONS_KEY/);
});

test('the rejected list reads real rejected reviews', () => {
  const rejected = read('frontend/js/rejected.js');
  assert.match(rejected, /api\('\/officer\/reviews\/rejected'\)/);
  assert.doesNotMatch(rejected, /getObservations\(|writeStorage\(OBSERVATIONS_KEY/);
});

test('the distribution map loads real plants from the officer map API', () => {
  const map = read('frontend/js/map.js');
  assert.match(map, /api\('\/officer\/map\/plants'\)/);
  assert.doesNotMatch(map, /web-data|website_species|getSpecies\(/);
});

test('reports.js does not load the old portal copy', () => {
  const reports = read('frontend/js/reports.js');
  assert.doesNotMatch(reports, /web-data|website_species|getSpecies\(|getObservations\(/);
});

// ---- User admin changes real permissions ----

test('user changes are saved to website_users, which the database copies to profiles', () => {
  const shared = read('frontend/js/shared.js');
  const users = read('frontend/js/users.js');
  // USERS_KEY is saved through /api/web-data/users (website_users), not only in the browser.
  assert.match(shared, /key: USERS_KEY/);
  assert.match(shared, /request\.open\(method, '\/api\/web-data\/users'/);
  assert.match(read('backend/src/routes/webData.js'), /website_users/);
  // The page shows the real account status and can activate pending accounts.
  assert.match(users, /from\('profiles'\)\.select\('id, account_status'\)/);
  assert.match(users, /Pending approval/);
  assert.match(users, /if \(writeStorage\(USERS_KEY, list\)\)/);
  // The trigger that copies website_users changes to profiles (role, account_status).
  const migrations = fs.readdirSync(path.join(repoRoot, 'supabase/migrations'))
    .map(file => read(path.join('supabase/migrations', file)))
    .join('\n');
  assert.match(migrations, /FUNCTION public\.sync_website_user_to_profile\(\)/);
});

test('every users.js DOM id exists in users.html', () => {
  const html = read('frontend/users.html');
  const users = read('frontend/js/users.js');
  const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const scriptIds = Array.from(
    users.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g),
    match => match[1]
  );

  assert.ok(scriptIds.length > 0);
  for (const id of scriptIds) {
    assert.ok(htmlIds.has(id), `users.js reads #${id}, which is missing from users.html`);
  }
});

test('only the officer can change website data on the server', () => {
  const webData = read('backend/src/routes/webData.js');
  assert.match(webData, /function isOfficer\(req\)/);
  assert.match(webData, /router\.get\("\/users", async \(req, res\) => \{/);
  assert.match(webData, /router\.put\("\/users", async \(req, res\) => \{\s*if \(!isOfficer\(req\)\)/);
  assert.doesNotMatch(webData, /website_species|website_observations|web_data|\/species|\/observations/);
});

test('frontend no longer references the removed portal-copy data', () => {
  const frontendRoot = path.join(repoRoot, 'frontend');
  const files = [];
  function collectFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collectFiles(file);
      } else if (/\.(?:html|js|css)$/.test(entry.name)) {
        files.push(file);
      }
    }
  }
  collectFiles(frontendRoot);

  const legacyData = /\/(?:api\/)?web-data\/(?:species|observations)\b|website_(?:species|observations)/i;
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), legacyData, path.relative(repoRoot, file));
  }
});

// ---- No public sign-up, staff-only portal ----

test('the login page does not offer sign-up and keeps non-staff accounts out', () => {
  const login = read('frontend/js/login.js');
  assert.match(login, /\['botanist', 'officer', 'researcher', 'admin'\]\.indexOf\(me\.role\) === -1/);
  assert.doesNotMatch(login, /Create an account/i);
  assert.doesNotMatch(read('frontend/users.html'), /sign-up page/i);
});

// ---- Expired logins are renewed, or the officer is sent to log in again ----

test('api() renews an expiring login and sends the officer to log in when it cannot', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /const SESSION_EXPIRED_MESSAGE = 'Your session expired, please log in again\.';/);
  const getToken = shared.slice(shared.indexOf('window.getOfficerAccessToken'), shared.indexOf('async function sendToLoginExpired'));
  assert.match(getToken, /sb\.auth\.refreshSession\(\)/);
  const api = shared.slice(shared.indexOf('async function api('));
  const apiBody = api.slice(0, api.indexOf('\n}\n'));
  assert.match(apiBody, /response\.status === 401/);
  assert.match(apiBody, /sendToLoginExpired\(\)/);
  assert.match(shared, /location\.replace\('login\.html'\)/);
});

// ---- The species catalogue and editor use the real species table ----

test('species.js and editor.js use /api/knowledge, not the old website copy', () => {
  for (const file of ['frontend/js/species.js', 'frontend/js/editor.js']) {
    const source = read(file);
    assert.match(source, /\/knowledge\/species/, file);
    assert.doesNotMatch(source, /web-data|getSpecies\(|SPECIES_KEY|getObservations\(|OBSERVATIONS_KEY/, file);
  }
  // Proposal reviews live on their own officer page; botanists only submit proposals.
  const species = read('frontend/js/species.js');
  assert.doesNotMatch(species, /species\/proposals\/pending|reviewProposal/);
  assert.doesNotMatch(read('frontend/species.html'), /proposals-section|proposals-list/);
  const proposals = read('frontend/js/proposals.js');
  assert.match(proposals, /'\/knowledge\/species\/proposals\/pending'/);
  assert.doesNotMatch(species, /\/knowledge\/species\/proposals\/|review_comment/);
  assert.match(proposals, /'\/knowledge\/species\/proposals\/' \+ proposal\.id \+ '\/review'/);
  assert.match(proposals, /proposal\.created_at/);
  assert.match(proposals, /proposal\.habitat/);
  assert.match(read('frontend/proposals.html'), /id="reject-reason"/);
  assert.doesNotMatch(proposals, /prompt\(/);
  assert.match(proposals, /Proposed habitat \/ location note/);
  assert.match(proposals, /No reference photo provided/);
  // Botanists only propose.
  assert.match(read('frontend/js/editor.js'), /'\/knowledge\/species\/proposals'/);
});

test('species proposals page is officer-only, guarded, and its controls match the page', () => {
  const shared = read('frontend/js/shared.js');
  const botanistPages = shared.slice(
    shared.indexOf('const BOTANIST_PAGES'),
    shared.indexOf('];', shared.indexOf('const BOTANIST_PAGES'))
  );
  assert.doesNotMatch(botanistPages, /proposals\.html/);
  assert.match(shared, /file: 'proposals\.html', label: 'Species proposals'/);
  assert.match(shared, /badge\.id = 'species-proposals-count'/);
  assert.match(shared, /refreshSpeciesProposalMenuCount\(\)/);
  assert.match(shared, /api\('\/knowledge\/species\/proposals\/pending\?page=1&page_size=1'\)/);

  const html = read('frontend/proposals.html');
  const script = read('frontend/js/proposals.js');
  assert.match(script, /if \(pageAllowed === false\)/);
  assert.match(script, /loadProposals\(\)\.catch/);
  assert.match(html, /<dialog[^>]+id="reject-dialog"/);
  assert.match(html, /<textarea[^>]+id="reject-reason" required/);

  const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const scriptIds = Array.from(script.matchAll(/byId\(['"]([^'"]+)['"]\)/g), match => match[1]);
  assert.ok(scriptIds.length > 0);
  for (const id of scriptIds) {
    assert.ok(htmlIds.has(id), `proposals.js reads #${id}, which is missing from proposals.html`);
  }
  assert.match(html, /<script src="js\/proposals\.js"><\/script>/);
});

test('approval queue labels pending first plant records and revisits', () => {
  const queue = read('frontend/js/queue.js');
  assert.match(queue, /observation\.plant\?\.plant_status === 'pending' \? 'New plant' : 'Revisit'/);
  assert.match(queue, /visitKindBadge\(observation\)/);
  const reviews = read('backend/src/routes/officerReviews.js');
  assert.match(reviews, /species_id, plant_status/);
  assert.match(reviews, /plant_status: plant\.plant_status/);
});

test('the species catalogue and editor render iNaturalist photo credits', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /function makeSpeciesPhotoCredit\(photo, compact\)/);
  assert.match(shared, /photo\.source !== 'inaturalist'/);
  assert.match(read('frontend/js/species.js'), /makeSpeciesPhotoCredit\(photo, true\)/);
  assert.match(read('frontend/js/editor.js'), /makeSpeciesPhotoCredit\(photo, false\)/);

  const creditStart = shared.indexOf('function makeSpeciesPhotoCredit(');
  const creditEnd = shared.indexOf('\n}', creditStart);
  const creditRenderer = shared.slice(creditStart, creditEnd);
  assert.match(creditRenderer, /credit\.textContent = fullCredit/);
  assert.match(shared, /'cc-by': 'CC BY'/);
  assert.match(shared, /'cc-by-sa': 'CC BY-SA'/);
  assert.match(shared, /cc0: 'CC0'/);
  assert.doesNotMatch(creditRenderer, /createElement\(['"]a['"]\)|\.href\s*=|source_url/);

  // The app builds the same plain-text credit in src/utils/photoCredit.ts
  // (photoCredit.test.js checks web and app give the same text).
  const mobileCredit = read('niah-biotrack/src/components/SpeciesPhotoCredit.tsx');
  const mobileCreditText = read('niah-biotrack/src/utils/photoCredit.ts');
  assert.match(mobileCredit, /\{photoCreditText\(photo\)\}/);
  assert.match(mobileCreditText, /Photo: \$\{photoCreditName\(photo\)\}, \$\{licence\} via iNaturalist/);
  for (const source of [mobileCredit, mobileCreditText]) {
    assert.doesNotMatch(source, /Linking|onPress|accessibilityRole|source_url|creativecommons\.org/);
  }
});

test('web and mobile species screens do not use legacy reference-photo fields', () => {
  const legacyFields = /reference_(?:image_url|observation_url|image_credit|image_license)/;
  for (const file of [
    'frontend/js/species.js',
    'frontend/js/editor.js',
    'frontend/js/shared.js',
    'niah-biotrack/app/plant-info.tsx',
    'niah-biotrack/app/species-reference/[id].tsx',
  ]) {
    assert.doesNotMatch(read(file), legacyFields, file);
  }
});

test('species catalogue controls match the JavaScript selectors and redraw on changes', () => {
  const html = read('frontend/species.html');
  const script = read('frontend/js/species.js');
  const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const scriptIds = Array.from(script.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g), match => match[1]);
  for (const id of scriptIds) {
    assert.ok(htmlIds.has(id), `species.js reads #${id}, which is missing from species.html`);
  }
  assert.match(html, /id="search-box"[^>]*aria-label="Search species by name"[^>]*oninput="drawSpeciesTable\(\)"/);
  assert.match(html, /id="status-filter"[^>]*aria-label="Filter by conservation status"[^>]*onchange="drawSpeciesTable\(\)"/);
  assert.match(script, /const searchInput = document\.getElementById\('search-box'\)/);
});

test('the distribution map is officer-only in the menu, the page list and on the page itself', () => {
  const shared = read('frontend/js/shared.js');
  const map = read('frontend/js/map.js');
  // Non-officers (botanists, and researchers, who sign in as Botanist on the web) may open
  // only BOTANIST_PAGES, and the menu hides every page canOpen() refuses.
  const botanistPages = shared.slice(shared.indexOf('const BOTANIST_PAGES'), shared.indexOf('];', shared.indexOf('const BOTANIST_PAGES')));
  assert.doesNotMatch(botanistPages, /map\.html/);
  assert.match(shared, /if \(user !== null && canOpen\(user, MENU\[i\]\.file\) === false\) \{\s*continue;/);
  // Opening map.html directly sends a non-officer away with a message.
  assert.match(shared, /if \(canOpen\(user, file\) === false\) \{\s*rememberToast\(OFFICER_ONLY_PAGE_MESSAGE\);\s*location\.replace\('species\.html'\);\s*return false;/);
  assert.match(shared, /const pageAllowed = guardPages\(\);/);
  // map.js asks for plant locations only when the page guard let this person stay.
  const guard = map.indexOf('if (pageAllowed === false)');
  assert.ok(guard !== -1, 'map.js must check pageAllowed');
  assert.ok(guard < map.indexOf('loadPlants().catch'), 'map.js must check pageAllowed before loading plants');
  assert.match(map, /Imported from iNaturalist · Observer:/);
  assert.match(read('frontend/map.html'), /<script src="js\/shared\.js"><\/script>\s*<script src="js\/map\.js"><\/script>/);
});

test('the plant catalogue is officer-only, linked from the menu and its page controls exist', () => {
  const shared = read('frontend/js/shared.js');
  const botanistPages = shared.slice(
    shared.indexOf('const BOTANIST_PAGES'),
    shared.indexOf('];', shared.indexOf('const BOTANIST_PAGES'))
  );
  assert.doesNotMatch(botanistPages, /plants\.html|plant\.html/);

  const menu = shared.slice(shared.indexOf('const MENU'), shared.indexOf('];', shared.indexOf('const MENU')));
  const speciesPosition = menu.indexOf("file: 'species.html'");
  const plantsPosition = menu.indexOf("file: 'plants.html'");
  const editorPosition = menu.indexOf("file: 'editor.html'");
  assert.ok(speciesPosition < plantsPosition && plantsPosition < editorPosition);
  assert.match(menu, /file: 'plants\.html', label: 'Plant catalogue'/);

  const catalogue = read('frontend/js/plants.js');
  const detail = read('frontend/js/plant.js');
  assert.match(catalogue, /if \(pageAllowed === false\)/);
  assert.match(detail, /if \(pageAllowed === false\)/);
  assert.ok(catalogue.indexOf('if (pageAllowed === false)') < catalogue.indexOf('loadFilterOptions().then'));
  assert.ok(detail.indexOf('if (pageAllowed === false)') < detail.indexOf('loadPlant().catch'));
  assert.match(catalogue, /api\('\/officer\/plants\?/);
  assert.match(detail, /api\('\/officer\/plants\//);
  assert.match(catalogue, /Imported from iNaturalist · Observer:/);
  assert.match(catalogue, /plant\.species_photo/);
  assert.match(catalogue, /makeSpeciesPhotoCredit/);
  assert.match(catalogue, /speciesPhotoLabel\.textContent = 'Species photo'/);
  assert.match(detail, /Imported from iNaturalist · Observer:/);
  assert.match(detail, /plant\.species_photo/);
  assert.match(detail, /makeSpeciesPhotoCredit/);
  assert.match(detail, /Species reference photo/);

  for (const [htmlPath, scriptPath] of [
    ['frontend/plants.html', 'frontend/js/plants.js'],
    ['frontend/plant.html', 'frontend/js/plant.js'],
  ]) {
    const html = read(htmlPath);
    const script = read(scriptPath);
    const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
    const scriptIds = Array.from(script.matchAll(/byId\(['"]([^'"]+)['"]\)/g), match => match[1]);
    assert.ok(scriptIds.length > 0);
    for (const id of scriptIds) {
      assert.ok(htmlIds.has(id), `${scriptPath} reads #${id}, which is missing from ${htmlPath}`);
    }
    assert.match(html, new RegExp(`<script src="js/${scriptPath.split('/').pop()}"></script>`));
  }

  assert.match(read('frontend/js/species.js'), /plants\.html\?species=/);
  assert.match(read('frontend/js/species.js'), /View plants \(/);
});

test('every element reports.js reads exists in reports.html, and the table has a head and body', () => {
  const html = read('frontend/reports.html');
  const script = read('frontend/js/reports.js');
  const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const scriptIds = Array.from(script.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g), match => match[1]);
  assert.ok(scriptIds.length > 0);
  for (const id of scriptIds) {
    assert.ok(htmlIds.has(id), `reports.js reads #${id}, which is missing from reports.html`);
  }
  // reports.js fills the table's <thead> and first <tbody>, so both must be inside #report-table.
  assert.match(html, /<table id="report-table">\s*<thead>[\s\S]*<\/thead>\s*<tbody>[\s\S]*<\/tbody>\s*<\/table>/);
  // A missing table shows a message instead of throwing.
  assert.match(script, /if \(parts === null\) \{\s*document\.getElementById\('report-note'\)\.textContent = REPORT_TABLE_MISSING;/);
});


test('distribution map loads sensor stations with a separate marker layer', () => {
  const mapCode = fs.readFileSync(
    path.join(__dirname, '../../frontend/js/map.js'),
    'utf8'
  );

  assert.match(mapCode, /api\('\/officer\/map\/stations'\)/);
  assert.match(mapCode, /function drawSensorMarkers\(\)/);
  assert.match(mapCode, /sensorMarkerLayer = L\.layerGroup\(\)\.addTo\(map\)/);
  assert.match(mapCode, /loadSensorStations\(\)\.catch/);
  assert.match(mapCode, /escapePopupText\(station\.station_code\)/);
  assert.match(mapCode, /escapePopupText\(station\.location_note/);
});

// ---- Trace routes on the distribution map (docs/trace-route-plan.md, phase 3) ----

test('the map loads routes only from the officer-only endpoint, after the page guard', () => {
  const map = read('frontend/js/map.js');
  assert.match(map, /api\('\/officer\/map\/routes'\)/);
  // The endpoint is officer-only: officerMap.js puts requireRole("officer") before every route.
  const officerMap = read('backend/src/routes/officerMap.js');
  const guard = officerMap.indexOf('router.use(requireAuth, requireRole("officer"));');
  assert.ok(guard !== -1, 'officerMap.js must be officer-only');
  assert.ok(guard < officerMap.indexOf('router.get("/routes"'), 'the routes endpoint comes after the officer guard');
  // Routes are requested only when the page guard let this person stay.
  assert.ok(map.indexOf('if (pageAllowed === false)') < map.indexOf('loadRoutes().catch'));
  // If routes fail, the plants still show and a short note says so.
  assert.match(map, /loadRoutes\(\)\.catch\(error => \{[\s\S]*?'Routes could not be loaded\.'/);
  assert.doesNotMatch(map, /loadRoutes\(\)\.catch\(error => \{[^}]*showUnexpectedError/);
});

test('route popups escape every value (botanist, plant tag, scientific name)', () => {
  const vm = require('node:vm');
  const map = read('frontend/js/map.js');
  const piece = (start, end) => map.slice(map.indexOf(start), map.indexOf(end, map.indexOf(start)));
  const code = [
    piece('function escapePopupText(', 'function makePopup('),
    piece('function displayRouteDistance(', '// [lat, lng, time, accuracy]'),
    'this.makeRoutePopup = makeRoutePopup;',
  ].join('\n');
  const context = {};
  vm.runInNewContext(code, context);

  const evil = '<img src=x onerror=alert(1)>';
  const html = context.makeRoutePopup({
    recorded_by: evil,
    ended_at: '2026-11-18T01:30:00Z',
    distance_m: 1234.5,
    duration_s: 4500,
    plant: { tag: evil, scientific_name: '<script>x</script>' },
  });
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Distance: 1\.23 km/);
  assert.match(html, /Walking time: 1 h 15 min/);

  const unlinked = context.makeRoutePopup({ recorded_by: 'Aron', distance_m: 420, duration_s: 600, plant: null });
  assert.match(unlinked, /Not linked to a plant/);
  assert.match(unlinked, /Distance: 420 m/);

  // Every value in the popup goes through escapePopupText.
  const popupSource = piece('function makeRoutePopup(', '// [lat, lng, time, accuracy]');
  assert.doesNotMatch(popupSource, /\+\s*(route|plant)\.[a-z_]+/);
  assert.match(popupSource, /escapePopupText\(route\.recorded_by/);
  assert.match(popupSource, /escapePopupText\(plant\.tag/);
  assert.match(popupSource, /escapePopupText\(plant\.scientific_name\)/);
  assert.match(popupSource, /escapePopupText\('Not linked to a plant'\)/);
});

test('the "Show routes" checkbox exists, is on by default and is remembered in this browser', () => {
  const html = read('frontend/map.html');
  const map = read('frontend/js/map.js');
  assert.match(html, /<input type="checkbox" id="map-show-routes" checked onchange="toggleRoutes\(this\.checked\)">\s*Show routes/);
  assert.match(html, /id="map-route-note">Routes from the last 90 days\.</);
  assert.match(map, /function toggleRoutes\(show\)/);
  assert.match(map, /const SHOW_ROUTES_KEY = 'niah_map_show_routes';/);
  // Unknown or missing value: shown (on by default); storage errors never break the map.
  assert.match(map, /return localStorage\.getItem\(SHOW_ROUTES_KEY\) !== 'false';/);
  assert.match(map, /try \{\s*localStorage\.setItem\(SHOW_ROUTES_KEY/);
  // Routes have their own layer, separate from plant and sensor markers.
  assert.match(map, /routeLayer = L\.layerGroup\(\);/);
  assert.match(map, /L\.polyline\(latLngs/);
});

test('the map page keeps its element ids, and map.js reads only ids that exist', () => {
  const html = read('frontend/map.html');
  const map = read('frontend/js/map.js');
  const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  for (const id of ['menu', 'map-species', 'map-status', 'map-box', 'map-message', 'toast', 'map-show-routes', 'map-route-note']) {
    assert.ok(htmlIds.has(id), `map.html must keep #${id}`);
  }
  const readIds = Array.from(map.matchAll(/getElementById\('([^']+)'\)/g), match => match[1]);
  assert.ok(readIds.length > 0);
  for (const id of readIds) {
    assert.ok(htmlIds.has(id), `map.js reads #${id}, which is missing from map.html`);
  }
  assert.match(map, /L\.map\('map-box'\)/);
});
