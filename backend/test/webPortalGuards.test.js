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
  // Officers review botanists' proposals on the catalogue page; a rejection needs a reason.
  const species = read('frontend/js/species.js');
  assert.match(species, /'\/knowledge\/species\/proposals\/pending'/);
  assert.match(species, /'\/knowledge\/species\/proposals\/' \+ proposal\.id \+ '\/review'/);
  assert.match(species, /Please type a reason/);
  // Botanists only propose.
  assert.match(read('frontend/js/editor.js'), /'\/knowledge\/species\/proposals'/);
});

test('the species catalogue and editor render iNaturalist photo credits', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /function makeSpeciesPhotoCredit\(photo, compact\)/);
  assert.match(shared, /photo\.source !== 'inaturalist'/);
  assert.match(read('frontend/js/species.js'), /makeSpeciesPhotoCredit\(photo, true\)/);
  assert.match(read('frontend/js/editor.js'), /makeSpeciesPhotoCredit\(photo, false\)/);
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
  assert.match(read('frontend/map.html'), /<script src="js\/shared\.js"><\/script>\s*<script src="js\/map\.js"><\/script>/);
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
