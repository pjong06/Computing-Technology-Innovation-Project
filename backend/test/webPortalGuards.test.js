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

test('reports moved into Overview: reports.html redirects there and is not in the menu', () => {
  const redirect = read('frontend/reports.html');
  assert.match(redirect, /<meta http-equiv="refresh" content="0; url=overview\.html#report">/);
  assert.match(redirect, /<a href="overview\.html#report">Overview<\/a>/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'frontend/js/reports.js')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'frontend/js/pdf.js')), false);
  assert.doesNotMatch(read('frontend/js/shared.js'), /file: 'reports\.html'/);
  // The report card reads the real report endpoints only (no old portal copy).
  const overview = read('frontend/js/overview.js');
  assert.match(overview, /return '\/reports\/' \+ report\.type \+ \(query \? '\?' \+ query : ''\);/);
  assert.doesNotMatch(overview, /web-data|website_species|getSpecies\(|getObservations\(/);
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
  // api() (JSON) and apiFile() (exports) both send through fetchWithLogin, which renews the
  // login once on a 401 and otherwise sends the officer to log in.
  const send = shared.slice(shared.indexOf('async function fetchWithLogin('));
  const sendBody = send.slice(0, send.indexOf('\n}\n'));
  assert.match(sendBody, /response\.status === 401/);
  assert.match(sendBody, /sendToLoginExpired\(\)/);
  for (const name of ['api', 'apiFile']) {
    const fn = shared.slice(shared.indexOf(`async function ${name}(`));
    assert.match(fn.slice(0, fn.indexOf('\n}\n')), /await fetchWithLogin\(path, /, name);
  }
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
  assert.match(proposals, /Habitat \/ location note/);
  assert.doesNotMatch(proposals, /No reference photo provided/);
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
  // A Review tab with its own count badge (id kept; proposals.js updates it after loading).
  assert.match(shared, /\{ file: 'proposals\.html', label: 'Species requests', countId: 'species-proposals-count' \}/);
  assert.match(shared, /function makeCountBadge\(id\) \{\s*const badge = document\.createElement\('span'\);\s*badge\.id = id;/);
  assert.match(read('frontend/js/proposals.js'), /updateSpeciesProposalMenuCount\(proposals\.length\)/);
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

test('approval queue labels pending first plant records NEW PLANT and visits OBSERVATION', () => {
  const queue = read('frontend/js/queue.js');
  assert.match(queue, /observation\.plant\?\.plant_status === 'pending' \? 'New plant' : 'Observation'/);
  assert.match(queue, /label\.textContent = visitKind\(observation\)\.toUpperCase\(\);/);
  assert.match(queue, /visitKindBadge\(observation\)/);
  const reviews = read('backend/src/routes/officerReviews.js');
  assert.match(reviews, /species_id, plant_status/);
  assert.match(reviews, /plant_status: plant\.plant_status/);
});

test('no page or app screen shows a photo credit, source or licence; there is no Photo credits page', () => {
  const shared = read('frontend/js/shared.js');
  assert.doesNotMatch(shared, /needsPhotoCredit|makePhotoCreditInfo|photoCreditText|photoCreditName|SPECIES_PHOTO_LICENSES|credits\.html/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'frontend/credits.html')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'frontend/js/credits.js')), false);
  assert.doesNotMatch(read('frontend/species.html'), /credits|page-footer/);
  const css = read('frontend/css/style.css');
  assert.doesNotMatch(css, /photo-credit|credits-table|page-footer/);

  // No "Source: …", "Observer: …", "Licence: …" or "Imported from …" line, badge or filter.
  const sourceText = /Source:|Observer:|Licen[cs]e:|Imported from|Imported source|source-badge|source-filter|plant-source/;
  for (const file of ['plant.js', 'plants.js', 'map.js', 'queue.js', 'rejected.js', 'proposals.js', 'species.js', 'editor.js']) {
    assert.doesNotMatch(read(`frontend/js/${file}`), sourceText, file);
  }
  for (const file of ['plant.html', 'plants.html', 'map.html', 'queue.html', 'species.html', 'reports.html']) {
    assert.doesNotMatch(read(`frontend/${file}`), sourceText, file);
  }
  assert.doesNotMatch(read('backend/src/routes/publicPlants.js'), /Source:|source_observer|source_licence/);
  assert.doesNotMatch(read('backend/src/services/reportService.js'), /key: "source"|source_observer/);

  // The app: no credit component or helper, no source lines.
  for (const file of ['niah-biotrack/src/components/PhotoCreditInfo.tsx', 'niah-biotrack/src/utils/photoCredit.ts',
    'niah-biotrack/src/components/SpeciesPhotoCredit.tsx', 'niah-biotrack/app/photo-credits.tsx']) {
    assert.equal(fs.existsSync(path.join(repoRoot, file)), false, file);
  }
  for (const screen of ['app/plant-detail.tsx', 'app/plant-info.tsx', 'app/species-reference/[id].tsx',
    'app/(tabs)/home.tsx', 'app/(tabs)/plants.tsx', 'app/(tabs)/records.tsx', 'app/(tabs)/profile.tsx', 'app/_layout.tsx']) {
    const text = read(`niah-biotrack/${screen}`);
    assert.doesNotMatch(text, /PhotoCreditInfo|photoCreditText|photo-credits|Photo credits/, screen);
    assert.doesNotMatch(text, sourceText, screen);
  }
  assert.doesNotMatch(read('niah-biotrack/src/services/tagLookup.ts'), /sourceObserver|sourceLicence|dataSource/);
});

// Every file that makes up a page or screen people see: the web portal (HTML, scripts,
// styles), the visitor QR page, and the app's screens and their code.
function userFacingFiles() {
  const files = [];
  const walk = (dir, keep) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['node_modules', 'vendor', 'images', 'android', 'ios', 'assets'].includes(entry.name)) walk(rel, keep);
      } else if (keep(entry.name)) {
        files.push(rel);
      }
    }
  };
  walk('frontend', name => /\.(html|js|css)$/.test(name));
  walk('niah-biotrack/app', name => /\.(tsx?|js)$/.test(name));
  walk('niah-biotrack/src', name => /\.(tsx?|js)$/.test(name) && !/\.test\./.test(name));
  // The visitor page's CSS (/public-assets/plant.css) is the STYLES string in publicPlants.js.
  files.push('backend/src/routes/publicPlants.js', 'backend/src/services/reportService.js',
    'backend/src/services/qrPdfService.js', 'backend/src/services/qrLabelService.js');
  return files;
}

test('no user-facing web or app file contains "iNaturalist"', () => {
  const files = userFacingFiles();
  assert.ok(files.length > 50, `found ${files.length} files`);
  assert.ok(files.includes('frontend/plants.html') && files.includes('niah-biotrack/app/plant-info.tsx'));
  const offenders = files.filter(file => read(file).includes('iNaturalist'));
  assert.deepEqual(offenders, []);
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
  // The menu and tab bars only list pages canOpen() allows; empty sections are skipped.
  assert.match(shared, /const pages = section\.pages\.filter\(page => user === null \|\| canOpen\(user, page\.file\)\);\s*if \(pages\.length === 0\) \{\s*continue;/);
  // Opening map.html directly sends a non-officer away with a message.
  assert.match(shared, /if \(canOpen\(user, file\) === false\) \{\s*rememberToast\(OFFICER_ONLY_PAGE_MESSAGE\);\s*location\.replace\('species\.html'\);\s*return false;/);
  assert.match(shared, /const pageAllowed = guardPages\(\);/);
  // map.js asks for plant locations only when the page guard let this person stay.
  const guard = map.indexOf('if (pageAllowed === false)');
  assert.ok(guard !== -1, 'map.js must check pageAllowed');
  assert.ok(guard < map.indexOf('loadPlants().catch'), 'map.js must check pageAllowed before loading plants');
  assert.doesNotMatch(map, /Imported from|Observer:|Licence:/);
  assert.match(read('frontend/map.html'), /<script src="js\/shared\.js"><\/script>\s*<script src="js\/map\.js"><\/script>/);
});

test('the plant catalogue is officer-only, linked from the menu and its page controls exist', () => {
  const shared = read('frontend/js/shared.js');
  const botanistPages = shared.slice(
    shared.indexOf('const BOTANIST_PAGES'),
    shared.indexOf('];', shared.indexOf('const BOTANIST_PAGES'))
  );
  assert.doesNotMatch(botanistPages, /plants\.html|plant\.html/);

  // Plants section: List (plant catalogue, also for plant detail) then Map; the species
  // editor is no longer a menu page.
  const sections = shared.slice(shared.indexOf('const NAV_SECTIONS'), shared.indexOf('// Every page reachable from the menu'));
  assert.match(sections, /label: 'Plants',\s*carrySpecies: true,\s*pages: \[\s*\{ file: 'plants\.html', label: 'List', alsoActiveOn: \['plant\.html'\] \},\s*\{ file: 'map\.html', label: 'Map' \}/);
  assert.doesNotMatch(sections, /file: 'editor\.html'/);

  const catalogue = read('frontend/js/plants.js');
  const detail = read('frontend/js/plant.js');
  assert.match(catalogue, /if \(pageAllowed === false\)/);
  assert.match(detail, /if \(pageAllowed === false\)/);
  assert.ok(catalogue.indexOf('if (pageAllowed === false)') < catalogue.indexOf('loadFilterOptions().then'));
  assert.ok(detail.indexOf('if (pageAllowed === false)') < detail.indexOf('loadPlant().catch'));
  assert.match(catalogue, /api\('\/officer\/plants\?/);
  assert.match(detail, /api\('\/officer\/plants\//);
  assert.doesNotMatch(catalogue, /Imported from|Observer:|source-filter/);
  // A plant without its own photo shows the placeholder: no species photo, no credit.
  assert.match(catalogue, /image\.src = plant\.photo_thumbnail\?\.url \|\| PICTURE_BLANK;/);
  assert.doesNotMatch(catalogue, /species_photo|Species photo|makeSpeciesPhotoCredit|makePhotoCreditInfo|photoCreditText/);
  assert.doesNotMatch(detail, /Imported from|Observer:|plant-source/);
  assert.match(detail, /renderPhotos\(plant\.photos \|\| \[\]\);/);
  assert.match(detail, /byId\('plant-no-photos'\)\.hidden = photos\.length > 0;/);
  assert.doesNotMatch(detail, /species_photo|speciesFallback|makePhotoCreditInfo|Species reference photo/);

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

test('every element overview.js reads exists in overview.html, and the report table has a head and body', () => {
  const html = read('frontend/overview.html');
  const script = read('frontend/js/overview.js');
  const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const scriptIds = Array.from(script.matchAll(/(?:getElementById|setOverviewText|setMonthLine)\(['"]([^'"]+)['"]/g), match => match[1]);
  assert.ok(scriptIds.length > 0);
  for (const id of scriptIds) {
    assert.ok(htmlIds.has(id), `overview.js reads #${id}, which is missing from overview.html`);
  }
  // overview.js fills the table's <thead> and first <tbody>, so both must be inside #report-table.
  assert.match(html, /<table id="report-table">\s*(?:<caption[^>]*>[^<]*<\/caption>\s*)?<thead>[\s\S]*<\/thead>\s*<tbody>[\s\S]*<\/tbody>\s*<\/table>/);
  // The table has a header row from the start (replaced when a report loads).
  assert.match(html, /<thead><tr><th scope="col">Report<\/th><\/tr><\/thead>/);
});

test('Overview layout: four cards, three panels, the Report card with tabs, filters and exports', () => {
  const html = read('frontend/overview.html');
  assert.match(html, /<h1>Overview<\/h1>\s*<p class="lead">See the numbers at a glance, then export the data you need, for the conservation officer\.<\/p>/);
  for (const card of ['Approved species', 'Threatened (CR + EN)', 'Waiting for review', 'Plant records']) {
    assert.ok(html.includes(`<span>${card}</span>`), card);
  }
  assert.match(html, /<a href="species\.html\?status=threatened">View these species<\/a>/);
  assert.match(html, /<a href="queue\.html">Go to Review<\/a>/);
  for (const panel of ['Species by conservation status', 'Field observations per month', 'IoT protection']) {
    assert.ok(html.includes(`<h2>${panel}</h2>`), panel);
  }
  assert.doesNotMatch(html, /Data completeness/);
  assert.match(html, /<a href="iot-workspace\.html">/);
  // Tabs, exports, toolbar.
  for (const tab of ['Species inventory', 'Plant records', 'Field observations', 'IoT alerts']) {
    assert.match(html, new RegExp(`role="tab"[^>]*>${tab}</button>`), tab);
  }
  assert.match(html, />CSV<\/button>/);
  assert.match(html, />PDF<\/button>/);
  assert.match(html, /placeholder="Search in this report"/);
  for (const chip of ['Last 30 days', 'This year', 'All time', 'Custom…']) assert.ok(html.includes(`>${chip}</button>`), chip);
  assert.match(html, /<label for="report-from">From <input type="date" id="report-from"><\/label>/);
  assert.match(html, /<label for="report-to">To <input type="date" id="report-to"><\/label>/);
  assert.match(html, /The date filter applies to this table and the export\./);
  const script = read('frontend/js/overview.js');
  // "+N this month" only from counts the server made from real dates.
  assert.match(script, /const ok = Number\.isInteger\(value\) && value > 0;/);
  // The current month dashed and labelled "so far"; the one-line summary.
  assert.match(script, /class: 'dashed'/);
  assert.match(script, /'so far'/);
  assert.match(script, /'Busiest month: '/);
  // Table details: rank tags, Missing family, status dots, plant bars, "No plants yet", paging.
  for (const needed of ["'rank-tag'", "'Missing'", "'status-dot '", "'plant-bar'", "'No plants yet'", "' · counts include all active plants'", 'REPORT_PAGE_SIZE = 10']) {
    assert.ok(script.includes(needed), needed);
  }
  // Exports use exactly the same request as the table.
  assert.match(script, /const file = await apiFile\(reportQuery\(format\)\);/);
  assert.match(script, /const result = await api\(reportQuery\(\)\);/);
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

test('the map does not offer trace routes (the app no longer records them); the code stays', () => {
  const map = read('frontend/js/map.js');
  const html = read('frontend/map.html');
  assert.match(map, /const ROUTES_ON_MAP = false;/);
  // No checkbox, no note, no layer and no request while it is off.
  assert.match(html, /<label class="map-toggle" id="map-routes-toggle" hidden>/);
  assert.match(html, /<p class="muted" id="map-route-note" hidden>/);
  assert.match(read('frontend/css/style.css'), /\.map-toggle\[hidden\] \{\s*display: none;/);
  assert.match(map, /if \(ROUTES_ON_MAP && document\.getElementById\('map-show-routes'\)\.checked\) \{\s*routeLayer\.addTo\(map\);/);
  assert.match(map, /if \(ROUTES_ON_MAP\) \{\s*loadRoutes\(\)\.catch/);
  assert.doesNotMatch(html, /trace routes|marker or line/);
  // The endpoint is kept.
  assert.match(read('backend/src/routes/officerMap.js'), /router\.get\("\/routes"/);
});

test('route popups escape every value (botanist, plant tag, scientific name)', () => {
  const vm = require('node:vm');
  const map = read('frontend/js/map.js');
  const piece = (start, end) => map.slice(map.indexOf(start), map.indexOf(end, map.indexOf(start)));
  const shared = read('frontend/js/shared.js');
  const sharedHelpers = shared.slice(
    shared.indexOf('// ---- Display helpers for plant tags and coordinates ----'),
    shared.indexOf('// Starts the big detail card')
  );
  // The portal's one date format (MONTHS, twoDigits, whenText, dayText, formatWhen, formatDay).
  const dateHelpers = shared.slice(
    shared.indexOf('const MONTHS = ['),
    shared.indexOf('// ---- Newest first / Oldest first, for every list ----')
  );
  const code = [
    dateHelpers,
    sharedHelpers,
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
  assert.match(popupSource, /escapePopupText\(displayTag\(plant\.tag, 'No tag'\)\)/);
  // A placeholder tag is never shown.
  const placeholder = context.makeRoutePopup({ recorded_by: 'Aron', plant: { tag: 'plant:3f6c1a2e-0000-4000-8000-000000000000' } });
  assert.match(placeholder, /Plant: No physical tag yet/);
  assert.doesNotMatch(placeholder, /plant:3f6c/);
  assert.match(popupSource, /escapePopupText\(plant\.scientific_name\)/);
  assert.match(popupSource, /escapePopupText\('Not linked to a plant'\)/);
});

test('the "Show routes" checkbox is kept (hidden for now), on by default and remembered in this browser', () => {
  const html = read('frontend/map.html');
  const map = read('frontend/js/map.js');
  // Hidden while ROUTES_ON_MAP is false (the app no longer records routes); the code stays.
  assert.match(html, /<input type="checkbox" id="map-show-routes" checked onchange="toggleRoutes\(this\.checked\)">\s*Show routes/);
  assert.match(html, /id="map-route-note" hidden>Routes from the last 90 days\.</);
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

test('species proposals load the taxonomy once, on the first approval that needs it', async () => {
  const vm = require('node:vm');
  const proposals = read('frontend/js/proposals.js');
  assert.match(proposals, /^let taxonomyRows = null;$/m);
  const line = proposals.split('\n').find(text => /taxonomyRows = await loadTaxonomy\(\)/.test(text));
  assert.ok(line, 'proposals.js loads the taxonomy when approving');
  // Run that line as written, twice: the first approval loads, the second reuses the list.
  const context = { loads: 0 };
  vm.runInNewContext(`
    var taxonomyRows = null;
    async function loadTaxonomy() { loads += 1; return [{ id: 't1', family: 'Nepenthaceae' }]; }
    async function approve() { ${line.trim()} return taxonomyRows; }
    this.done = approve().then(approve);
  `, context);
  const rows = await context.done;
  assert.equal(context.loads, 1);
  assert.equal(rows[0].family, 'Nepenthaceae');
});

// ---- Pre-freeze fixes ----

function sharedDisplayHelpers() {
  const vm = require('node:vm');
  const shared = read('frontend/js/shared.js');
  const code = shared.slice(
    shared.indexOf('// ---- Display helpers for plant tags and coordinates ----'),
    shared.indexOf('// Starts the big detail card')
  ) + '\nthis.displayTag = displayTag; this.displayCoordinates = displayCoordinates;';
  const context = {};
  vm.runInNewContext(code, context);
  return context;
}

test('placeholder "plant:" tags show as "No physical tag yet" on every web page', () => {
  const { displayTag } = sharedDisplayHelpers();
  assert.equal(displayTag('plant:3f6c1a2e-0000-4000-8000-000000000000'), 'No physical tag yet');
  assert.equal(displayTag('PLANT:abc', 'No tag'), 'No physical tag yet');
  assert.equal(displayTag('NIAH-PLT-00042'), 'NIAH-PLT-00042');
  assert.equal(displayTag('', 'No tag'), 'No tag');
  assert.equal(displayTag(null, 'No tag code'), 'No tag code');

  assert.match(read('frontend/js/plants.js'), /'Tag: ' \+ displayTag\(plant\.tag_code, 'No tag'\)/);
  assert.match(read('frontend/js/plant.js'), /byId\('plant-tag'\)\.textContent = displayTag\(plant\.tag_code, 'No tag code'\)/);
  assert.match(read('frontend/js/map.js'), /'<div>Tag: ' \+ escapePopupText\(displayTag\(plant\.tag, 'No tag'\)\)/);
  assert.match(read('frontend/js/shared.js'), /'Tag ' \+ displayTag\(plant\.tag_code\)/);
  // Reports (Overview's Report card and its exports): placeholder tags read "No physical tag yet".
  assert.match(read('backend/src/services/reportService.js'), /: "No physical tag yet";/);
  // No page prints a stored tag directly any more.
  for (const file of ['plants.js', 'plant.js', 'map.js']) {
    assert.doesNotMatch(read(`frontend/js/${file}`), /\(plant\.(tag|tag_code) \|\|/, file);
  }
});

test('plant detail shows coordinates rounded to 6 decimals', () => {
  const { displayCoordinates } = sharedDisplayHelpers();
  assert.equal(displayCoordinates(3.81761234567, 113.7810449999), '3.817612, 113.781045');
  assert.equal(displayCoordinates('3.8', '113.78'), '3.800000, 113.780000');
  assert.equal(displayCoordinates(null, 113.78), 'Not recorded');
  assert.equal(displayCoordinates('x', 'y'), 'Not recorded');
  assert.match(read('frontend/js/plant.js'), /byId\('plant-coordinates'\)\.textContent = displayCoordinates\(plant\.latitude, plant\.longitude\)/);
});

test('a request that never reaches the server says so plainly, not "Failed to fetch"', async () => {
  const vm = require('node:vm');
  const shared = read('frontend/js/shared.js');
  const start = shared.indexOf('const SERVER_UNREACHABLE_MESSAGE');
  const end = shared.indexOf('// ---------- The real species catalogue', start);
  const errors = [];
  const context = {
    window: { getOfficerAccessToken: async () => 'token' },
    fetch: async () => { throw new TypeError('Failed to fetch'); },
    console: { error: (...args) => errors.push(args) },
    FormData: class {},
  };
  vm.runInNewContext(shared.slice(start, end) + '\nthis.api = api;', context);
  await assert.rejects(
    () => context.api('/reports/summary'),
    { message: 'Could not reach the server. Check your connection and try again.' }
  );
  assert.equal(errors.length, 1, 'the browser error is kept in the console');
});

test('user admin shows a plain message when an account cannot be created', () => {
  const vm = require('node:vm');
  const users = read('frontend/js/users.js');
  const code = users.slice(users.indexOf('function plainAccountError('), users.indexOf('// Adds the user typed in the boxes'));
  const context = {};
  vm.runInNewContext(code + '\nthis.plainAccountError = plainAccountError;', context);
  const plain = message => context.plainAccountError({ message });
  assert.equal(plain('User already registered'), 'An account with this email already exists.');
  assert.match(plain('Password should be at least 6 characters.'), /password was not accepted/);
  assert.equal(plain('Unable to validate email address: invalid format'), 'That email address is not valid.');
  assert.match(plain('Email rate limit exceeded'), /wait a minute/);
  assert.equal(plain('AuthRetryableFetchError: 500'), 'The account could not be created. Please try again.');
  assert.match(users, /showToast\(plainAccountError\(result\.error\)\)/);
  assert.doesNotMatch(users, /showToast\(result\.error\.message\)/);
});

test('pre-freeze clean-ups: no dead login code, "Live data" chip, matching index link, quiet MQTT log', () => {
  const login = read('frontend/js/login.js');
  assert.doesNotMatch(login, /OFFICER_CONTACT_EMAIL|showSuspended/);
  const index = read('frontend/index.html');
  assert.match(index, /url=overview\.html/);
  assert.match(index, /<a href="overview\.html">Officer overview<\/a>/);
  const mqtt = read('backend/src/services/mqttIngestionService.js');
  assert.match(mqtt, /if \(process\.env\.IOT_DEBUG === 'true'\) \{\s*console\.log\(\s*persisted/);
});

// ---- Simpler navigation: menu sections, tab bars, landing page (lecturer feedback) ----

// The real navigation code from shared.js, run on its own with a fake API and user.
function loadNavigation({ apiAnswers = {}, apiError = null, apiNeverAnswers = false } = {}) {
  const vm = require('node:vm');
  const shared = read('frontend/js/shared.js');
  const between = (start, end) => {
    const from = shared.indexOf(start);
    const to = shared.indexOf(end, from);
    assert.ok(from !== -1 && to > from, `shared.js must contain ${start}`);
    return shared.slice(from, to);
  };
  const calls = [];
  const context = {
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console: { warn() {}, error() {} },
    api: async path => {
      calls.push(path);
      if (apiNeverAnswers) return new Promise(() => {});
      if (apiError) throw apiError;
      return apiAnswers[path];
    },
  };
  const code = [
    between('const BOTANIST_PAGES', '\n];') + '\n];',
    between('function isBotanist(', '\n}') + '\n}',
    between('function canOpen(', '\n}') + '\n}',
    between('// ---- Navigation: menu sections', '// ---- end of navigation ----'),
    'this.navFor = navFor; this.homePageFor = homePageFor;',
  ].join('\n');
  vm.runInNewContext(code, context);
  return { nav: context, calls };
}

const OFFICER = { role: 'Conservation Officer' };
const BOTANIST_USER = { role: 'Botanist' };
const plain = value => JSON.parse(JSON.stringify(value));

test('officers see Overview first, followed by the existing menu sections', () => {
  const { nav } = loadNavigation();
  const view = plain(nav.navFor(OFFICER, 'overview.html', ''));
  assert.deepEqual(view.sections.map(s => [s.label, s.href]), [
    ['Overview', 'overview.html'],
    ['Review', 'queue.html'],
    ['Species', 'species.html'],
    ['Plants', 'plants.html'],
    // The standalone alerts page left the menu in 63385ac; the section opens the workspace.
    ['IoT alerts', 'iot-workspace.html'],
    ['Admin', 'users.html'],
  ]);
  assert.equal(view.sections[1].countId, 'review-menu-count');
  assert.deepEqual(view.sections.filter(s => s.active).map(s => s.label), ['Overview']);
});

test('botanists see Species and their workspace; the editor highlights Species', () => {
  const { nav } = loadNavigation();
  for (const page of ['species.html', 'editor.html']) {
    const view = plain(nav.navFor(BOTANIST_USER, page, ''));
    assert.deepEqual(view.sections.map(s => s.label), ['Species','IoT alerts'], page);
    assert.equal(view.sections.some(s => s.href === 'overview.html'), false);
    assert.equal(view.sections[1].href,'iot-workspace.html');
    assert.equal(view.sections[0].active, true, page);
    assert.deepEqual(view.tabs, [], page);
  }
});

test('tab bars per section for officers, with the current page marked', () => {
  const { nav } = loadNavigation();
  const tabs = (page, search = '') => plain(nav.navFor(OFFICER, page, search).tabs);
  const review = [
    { label: 'Field records', href: 'queue.html', countId: 'field-records-count' },
    { label: 'Species requests', href: 'proposals.html', countId: 'species-proposals-count' },
    { label: 'Rejected history', href: 'rejected.html', countId: null },
  ];
  for (const [page, activeIndex] of [['queue.html', 0], ['proposals.html', 1], ['rejected.html', 2]]) {
    assert.deepEqual(tabs(page), review.map((tab, i) => ({ ...tab, active: i === activeIndex })), page);
  }
  assert.deepEqual(tabs('plants.html').map(t => [t.label, t.href, t.active]), [['List', 'plants.html', true], ['Map', 'map.html', false]]);
  // Plant detail belongs to the Plants list.
  assert.deepEqual(tabs('plant.html', '?id=1').map(t => [t.label, t.active]), [['List', true], ['Map', false]]);
  assert.deepEqual(tabs('map.html').map(t => [t.label, t.active]), [['List', false], ['Map', true]]);
  // One-page sections have no tab bar (Admin is Users only now); the editor highlights Species.
  for (const page of ['species.html', 'editor.html', 'users.html', 'overview.html']) {
    assert.deepEqual(tabs(page), [], page);
  }
  // IoT alerts has one page (the workspace) since 63385ac, so no tab bar either.
  assert.deepEqual(tabs('iot-workspace.html'), []);
  assert.deepEqual(plain(nav.navFor(OFFICER, 'iot-workspace.html', '')).sections.filter(s => s.active).map(s => s.label), ['IoT alerts']);
  const editor = plain(nav.navFor(OFFICER, 'editor.html', ''));
  assert.deepEqual(editor.sections.filter(s => s.active).map(s => s.label), ['Species']);
});

test('switching Plants List <-> Map keeps ?species= (and only there)', () => {
  const { nav } = loadNavigation();
  const plantsTabs = plain(nav.navFor(OFFICER, 'plants.html', '?species=abc-123').tabs);
  assert.deepEqual(plantsTabs.map(t => t.href), ['plants.html?species=abc-123', 'map.html?species=abc-123']);
  const mapTabs = plain(nav.navFor(OFFICER, 'map.html', '?species=abc-123').tabs);
  assert.deepEqual(mapTabs.map(t => t.href), ['plants.html?species=abc-123', 'map.html?species=abc-123']);
  assert.deepEqual(plain(nav.navFor(OFFICER, 'plants.html', '').tabs).map(t => t.href), ['plants.html', 'map.html']);
  assert.deepEqual(plain(nav.navFor(OFFICER, 'queue.html', '?species=abc-123').tabs).map(t => t.href),
    ['queue.html', 'proposals.html', 'rejected.html']);
});

test('landing page: officers open Overview and botanists the Species catalogue', async () => {
  const officer = loadNavigation();
  assert.equal(await officer.nav.homePageFor(OFFICER), 'overview.html');
  assert.deepEqual(officer.calls, [], 'login does not wait on overview data');

  const botanist = loadNavigation();
  assert.equal(await botanist.nav.homePageFor(BOTANIST_USER), 'species.html');
  assert.deepEqual(botanist.calls, [], 'no officer-only count is requested for a botanist');
  assert.equal(await botanist.nav.homePageFor(null), 'species.html');
});

test('review counts: field records from the officer-only summary, the Review entry shows the sum', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /async function fetchFieldRecordsCount\(\) \{\s*const result = await api\('\/reports\/summary'\);\s*return validCount\(result\?\.data\?\.pending_observation_count/);
  assert.match(read('backend/src/routes/reports.js'), /router\.get\("\/summary", requireAuth, requireRole\("officer"\)/);
  assert.match(shared, /setCountBadge\('review-menu-count', \(reviewCounts\.records \|\| 0\) \+ \(reviewCounts\.proposals \|\| 0\)/);
  // Counts are only requested for officers; each review page sets its own after loading.
  assert.match(shared, /if \(user !== null && isBotanist\(user\) === false\) \{\s*if \(thisPageName\(\) !== 'proposals\.html'\)/);
  assert.match(shared, /if \(thisPageName\(\) !== 'queue\.html'\) \{\s*refreshFieldRecordsCount\(\)/);
  assert.match(read('frontend/js/queue.js'), /drawQueue\(\);\s*\/\/[^\n]*\n\s*refreshFieldRecordsCount\(\)/);
  // Login routes directly to the role's landing page.
  assert.match(read('frontend/js/login.js'), /await goToHome\(\);/);
  assert.match(shared, /async function goToHome\(\) \{\s*location\.href = await homePageFor\(getCurrentUser\(\)\);/);
  assert.match(shared, /return 'overview\.html';/);
  assert.match(read('backend/src/server.js'), /app\.use\('\/api\/officer\/overview', officerOverviewRoutes\);/);
});

test('tab bars are drawn by shared.js as a div (not a <nav>, which has the menu styles)', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /function drawSectionTabs\(tabs\) \{/);
  assert.match(shared, /const bar = document\.createElement\('div'\);\s*bar\.id = 'section-tabs';\s*bar\.className = 'section-tabs';\s*bar\.setAttribute\('role', 'navigation'\);/);
  assert.match(shared, /main\.insertBefore\(bar, main\.firstChild\);/);
  for (const page of ['overview.html', 'queue.html', 'proposals.html', 'rejected.html', 'plants.html', 'plant.html', 'map.html', 'reports.html', 'users.html']) {
    assert.doesNotMatch(read(`frontend/${page}`), /section-tabs|class="tabs"/, `${page} has no tab bar of its own`);
  }
  const css = read('frontend/css/style.css');
  assert.match(css, /\.section-tabs \{/);
  assert.match(css, /@media \(max-width: 600px\) \{\s*\.section-tabs \{\s*width: 100%;\s*flex-wrap: nowrap;\s*overflow-x: auto;/);
});

test('review page headings, and a one-sentence description under every page heading', () => {
  // Review > Field records: the section name as the heading, then one plain line.
  assert.match(read('frontend/queue.html'), /<h1>Review<\/h1>\s*<p class="lead">Check field records before they become official, for the conservation officer\.<\/p>/);
  assert.match(read('frontend/proposals.html'), /<h1>Species <span>requests<\/span><\/h1>/);
  assert.match(read('frontend/rejected.html'), /<h1>Rejected <span>history<\/span><\/h1>/);
  for (const page of ['overview', 'species', 'editor', 'proposals', 'queue', 'rejected', 'plants', 'plant', 'map', 'users']) {
    const html = read(`frontend/${page}.html`);
    const lead = html.match(/<p class="lead"[^>]*>([\s\S]*?)<\/p>/);
    assert.ok(lead && lead[1].replace(/<[^>]+>/g, '').trim().length > 20, `${page}.html has a description`);
    assert.match(lead[1], /officer|botanist/i, `${page}.html says who the page is for`);
  }
});

test('one review status scheme: Waiting for review blue, Approved green, Needs changes red, Draft grey', () => {
  const vm = require('node:vm');
  const shared = read('frontend/js/shared.js');
  const context = {};
  vm.runInNewContext(shared.slice(
    shared.indexOf('// ---- Review status words and colours'),
    shared.indexOf('// ---- Display helpers for plant tags and coordinates ----')
  ) + '\nthis.reviewStatusDisplay = reviewStatusDisplay;', context);
  const show = value => plain(context.reviewStatusDisplay(value));
  assert.deepEqual(show('pending'), { label: 'Waiting for review', css: 'pending' });
  assert.deepEqual(show('APPROVED'), { label: 'Approved', css: 'approved' });
  assert.deepEqual(show('rejected'), { label: 'Needs changes', css: 'rejected' });
  assert.deepEqual(show('draft'), { label: 'Draft', css: 'draft' });
  assert.deepEqual(show('in_review'), { label: 'In review', css: '' });
  assert.match(read('frontend/js/plants.js'), /function formattedStatus\(value\) \{\s*return reviewStatusDisplay\(value\);/);
  assert.match(read('frontend/js/plant.js'), /function plantStatus\(value\) \{\s*return reviewStatusDisplay\(value\);/);

  const css = read('frontend/css/style.css');
  assert.match(css, /\.plant-status\.pending,\s*\.status-badge\.pending \{\s*background: var\(--info\);\s*color: var\(--infot\);/);
  assert.match(css, /\.plant-status\.approved,\s*\.status-badge\.approved \{\s*background: var\(--ok\);/);
  assert.match(css, /\.plant-status\.rejected,\s*\.status-badge\.rejected \{\s*background: var\(--er\);/);
  assert.match(css, /\.plant-status\.draft,\s*\.status-badge\.draft \{\s*background: var\(--neutral\);/);
  // Blue and grey exist in the light theme and both dark themes.
  assert.equal((css.match(/--info: /g) || []).length, 3);
  assert.equal((css.match(/--neutral: /g) || []).length, 3);
  // No page keeps its own copy of the status colours, and each IoT status is defined once.
  for (const page of ['plants.html', 'plant.html']) {
    assert.doesNotMatch(read(`frontend/${page}`), /\.plant-status\.(pending|approved|rejected)/, page);
  }
});

// ---- Usability pass: thumbnails, newest first, one date format ----

const vm = require('node:vm');

// Runs the real date and sort helpers from shared.js in a sandbox.
function loadDateAndSortHelpers() {
  const shared = read('frontend/js/shared.js');
  const code = shared.slice(
    shared.indexOf('const MONTHS = ['),
    shared.indexOf('// ---- Shared by the approval queue and the rejected list ----')
  );
  const sandbox = {};
  vm.runInNewContext(code + '\nthis.out = { whenText, dayText, formatWhen, formatDay, sortByDate, SORT_NEWEST, SORT_OLDEST };', sandbox);
  return sandbox.out;
}

test('one date format: "21 Nov 2026, 11:30" and "21 Nov 2026", with a fallback when missing', () => {
  const h = loadDateAndSortHelpers();
  const d = new Date(2026, 10, 21, 9, 5);
  assert.equal(h.whenText(d), '21 Nov 2026, 09:05');
  assert.equal(h.dayText(d), '21 Nov 2026');
  assert.equal(h.formatWhen(null, 'None recorded'), 'None recorded');
  assert.equal(h.formatDay('', 'None'), 'None');
  assert.equal(h.formatDay('not a date'), 'not a date');
  // Pages use the shared format instead of their own.
  for (const [file, call] of [
    ['frontend/js/plant.js', /formatWhen\(/],
    ['frontend/js/plants.js', /formatDay\(/],
    ['frontend/js/proposals.js', /formatWhen\(/],
    ['frontend/js/map.js', /formatDay\(/],
    ['frontend/js/overview.js', /formatDay\(/]
  ]) {
    assert.match(read(file), call, file + ' uses the shared date format');
  }
});

test('newest first: sortByDate puts the latest first by default and undated items last', () => {
  const h = loadDateAndSortHelpers();
  const list = [{ at: '2026-01-02' }, { at: null }, { at: '2026-03-04' }, { at: '2025-12-31' }];
  const newest = Array.from(h.sortByDate(list, x => x.at, h.SORT_NEWEST), x => x.at);
  assert.deepEqual(newest, ['2026-03-04', '2026-01-02', '2025-12-31', null]);
  const oldest = Array.from(h.sortByDate(list, x => x.at, h.SORT_OLDEST), x => x.at);
  assert.deepEqual(oldest, ['2025-12-31', '2026-01-02', '2026-03-04', null]);
  assert.equal(list[0].at, '2026-01-02', 'the original list is not changed');
});

test('every list has a Newest first / Oldest first sort, newest by default', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /new Option\('Newest first', SORT_NEWEST\)/);
  assert.match(shared, /new Option\('Oldest first', SORT_OLDEST\)/);
  assert.match(read('frontend/js/queue.js'), /addListSortSelect\('queue-count', 'queue-sort'/);
  assert.match(read('frontend/js/queue.js'), /sortByDate\(pending, item => item\.observed_at/);
  assert.match(read('frontend/js/rejected.js'), /addListSortSelect\('rejected-count', 'rejected-sort'/);
  assert.match(read('frontend/js/proposals.js'), /addListSortSelect\('proposals-count', 'proposals-sort'/);
  assert.match(read('frontend/js/plant.js'), /addListSortSelect\('observations-count', 'observations-sort'/);
  assert.match(read('frontend/js/users.js'), /addListSortSelect\('users-count', 'users-sort'/);
  for (const [page, id] of [
    ['frontend/plants.html', 'plant-sort'],
  ]) {
    const html = read(page);
    const select = html.slice(html.indexOf('id="' + id + '"'));
    const firstOption = select.slice(select.indexOf('<option'), select.indexOf('</option>'));
    assert.match(firstOption, /Newest first/, page + ': Newest first is the default');
  }
  // The plant catalogue asks the server for the order (paged), which only accepts newest/oldest.
  assert.match(read('frontend/js/plants.js'), /params\.set\('sort', 'oldest'\)/);
  const plantsRoute = read('backend/src/routes/officerPlants.js');
  assert.match(plantsRoute, /\["", "newest", "oldest"\]\.includes\(sort\)/);
});

test('review lists show real thumbnails, lazily loaded', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /img\.loading = 'lazy';/);
  assert.match(read('frontend/js/queue.js'), /observation\.thumbnail_url \|\| PICTURE_BLANK/);
  assert.match(read('frontend/js/rejected.js'), /observation\.thumbnail_url \|\| PICTURE_BLANK/);
  const reviews = read('backend/src/routes/officerReviews.js');
  assert.match(reviews, /async function withThumbnails\(/);
  assert.match(reviews, /createSignedUrls\(/);
});

test('small usability fixes: clear empty states, reasons on rejected cards, success toasts, no sideways scroll', () => {
  assert.match(read('frontend/queue.html'), /id="queue-empty"[^>]*>Nothing waiting for review\./);
  assert.match(read('frontend/proposals.html'), /id="proposals-empty"[^>]*>Nothing waiting for review\./);
  assert.match(read('frontend/js/rejected.js'), /reason\.className = 'list-note';/);
  assert.match(read('frontend/users.html'), /id="users-count"/);
  assert.match(read('frontend/js/users.js'), /' is now active\.' : ' is now suspended\.'/);
  const css = read('frontend/css/style.css');
  const tail = css.slice(css.indexOf('.list-sort-bar {'));
  assert.match(tail, /body \{\s*overflow-wrap: break-word;/);
  assert.match(tail, /\.app \{\s*grid-template-columns: 230px minmax\(0, 1fr\);/);
  assert.match(tail, /main \{\s*min-width: 0;/);
});
