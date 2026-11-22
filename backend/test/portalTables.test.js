'use strict';

// The officer table pages (Species catalogue, Plants, Users) and the plant detail page:
// shared table helpers (no duplicated table code), wording, and actions that identify
// records by id.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/\r\n/g, '\n');

// The pure helpers of the shared table kit, run outside the browser.
function tableHelpers() {
  const shared = read('frontend/js/shared.js');
  const kit = shared.slice(
    shared.indexOf('// ---------- Officer data tables'),
    shared.indexOf('// The IoT workspace verifies')
  );
  const context = {};
  vm.runInNewContext(`${kit}\nthis.sortRows = sortRows; this.nextSort = nextSort; this.pageOf = pageOf;` +
    ' this.TABLE_PAGE_SIZE = TABLE_PAGE_SIZE; this.THREATENED_CODES = THREATENED_CODES;', context);
  return context;
}

test('shared table helpers: sorting (empty values last), header toggling and 10-row pages', () => {
  const helpers = tableHelpers();
  // Values made in the sandbox are copied out, so they compare as plain arrays and objects.
  const plain = (fn) => (...args) => JSON.parse(JSON.stringify(fn(...args)));
  const sortRows = plain(helpers.sortRows);
  const nextSort = plain(helpers.nextSort);
  const pageOf = plain(helpers.pageOf);
  const { TABLE_PAGE_SIZE, THREATENED_CODES } = helpers;
  const column = { sortValue: (row) => row.name };
  const rows = [{ name: 'shorea' }, { name: '' }, { name: 'Amorphophallus' }, { name: 'Begonia 10' }, { name: 'Begonia 9' }];
  assert.deepEqual(sortRows(rows, column, 'asc').map((row) => row.name), ['Amorphophallus', 'Begonia 9', 'Begonia 10', 'shorea', '']);
  assert.deepEqual(sortRows(rows, column, 'desc').map((row) => row.name), ['shorea', 'Begonia 10', 'Begonia 9', 'Amorphophallus', '']);
  const counts = { sortValue: (row) => row.count };
  assert.deepEqual(sortRows([{ count: 3 }, { count: null }, { count: 12 }], counts, 'desc').map((row) => row.count), [12, 3, null]);
  assert.deepEqual(nextSort(null, 'family'), { key: 'family', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'family', dir: 'asc' }, 'family'), { key: 'family', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'family', dir: 'desc' }, 'plants'), { key: 'plants', dir: 'asc' });
  assert.equal(TABLE_PAGE_SIZE, 10);
  const many = Array.from({ length: 23 }, (_, i) => i);
  assert.deepEqual(pageOf(many, 3), [20, 21, 22]);
  assert.deepEqual(JSON.parse(JSON.stringify(THREATENED_CODES)), ['CR', 'EN', 'VU']);
});

test('the paging label reads "1–10 of 178"', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /first\.toLocaleString\(\) \+ '–' \+ last\.toLocaleString\(\) \+ ' of ' \+ total\.toLocaleString\(\)/);
});

test('every table page uses the shared helpers instead of its own table, tabs or paging code', () => {
  for (const file of ['species.js', 'plants.js', 'users.js']) {
    const script = read(`frontend/js/${file}`);
    assert.match(script, /drawDataTable\(/, file);
    assert.match(script, /drawPager\(/, file);
    assert.doesNotMatch(script, /function (drawPager|sortRows|drawDataTable|labelSpan|downloadCsv)\b/, file);
  }
  for (const file of ['species.js', 'plants.js']) {
    const script = read(`frontend/js/${file}`);
    assert.match(script, /drawTableTabs\(/, file);
    assert.match(script, /drawBulkBar\(/, file);
    assert.match(script, /makePopover\(byId\('filters-button'\), byId\('filters-panel'\)\)/, file);
  }
  // Tables scroll sideways inside their card; text in a cell ends with an ellipsis and its
  // full text is the tooltip.
  const css = read('frontend/css/style.css');
  assert.match(css, /\.table-scroll \{\s*overflow-x: auto;/);
  assert.match(css, /\.clip \{[^}]*text-overflow: ellipsis;/);
  assert.match(read('frontend/js/shared.js'), /span\.title = text;/);
  // The Overview page uses the same tags, dots and tabs (one copy in style.css).
  const overview = read('frontend/overview.html');
  assert.doesNotMatch(overview, /\.rank-tag \{|\.status-dot \{|\.missing-badge \{|\.report-tabs \{/);
  assert.doesNotMatch(read('frontend/js/overview.js'), /function labelSpan|const STATUS_CLASS/);
});

test('page descriptions say they are for the conservation officer', () => {
  assert.match(read('frontend/species.html'), /Every plant species recorded in Niah National Park, for the conservation officer\./);
  assert.match(read('frontend/plants.html'), /Every tagged plant, its location and review status, for the conservation officer\./);
  assert.match(read('frontend/plant.html'), /for the conservation officer\./);
  assert.match(read('frontend/users.html'), /Staff accounts for the app and the portal, managed by the conservation officer\./);
});

test('Plants: thumbnails, tag chip, lock icon, tabs, and Print QR tags through the officer endpoint', () => {
  const plants = read('frontend/js/plants.js');
  assert.match(plants, /image\.src = plant\.photo_thumbnail\?\.url \|\| PICTURE_BLANK;/);
  assert.match(plants, /if \(THREATENED_CODES\.includes\(plant\.species\?\.conservation_status\)\) line\.appendChild\(lockIcon\(\)\);/);
  for (const tab of ["label: 'All'", "label: 'Waiting for review'", "label: 'Needs changes'", "label: 'Approved'"]) {
    assert.ok(plants.includes(tab), tab);
  }
  assert.match(plants, /apiFile\('\/officer\/plants\/qr-tags', \{ method: 'POST', body: JSON\.stringify\(\{ plant_ids: ids \}\) \}\)/);
  assert.match(plants, /file\.headers\.get\('X-Skipped-Count'\)/);
  assert.match(read('frontend/js/shared.js'), /labelSpan\('chip-muted', 'No tag yet'\)/);
});

test('Plant detail: gallery, chips, Measurements, Location, Field notes and Observations; empty sections hidden', () => {
  const html = read('frontend/plant.html');
  const script = read('frontend/js/plant.js');
  for (const heading of ['Latest measurements', 'Location', 'Field notes']) {
    assert.match(html, new RegExp(`<h2>${heading}</h2>`), heading);
  }
  assert.match(html, /<h2>Observations <span class="count-pill" id="observations-total"><\/span><\/h2>/);
  // Measurements come from the newest approved observation; empty tiles and cards are hidden.
  assert.match(script, /observations\.filter\(item => item\.review_status === 'approved'\)/);
  assert.match(script, /byId\('measurements-card'\)\.hidden = tiles\.length === 0;/);
  assert.match(script, /byId\('field-notes-card'\)\.hidden = box\.children\.length === 0;/);
  // Timeline line: "<date/time> · <observer>".
  assert.match(script, /formatWhen\(observation\.observed_at, 'Date not recorded'\) \+ ' · ' \+/);
  assert.match(script, /observation\.review_status === 'rejected' && observation\.reviewer_comment/);
  assert.match(html, /No observations yet/);
  // No photo credit on screen (comments aside).
  assert.doesNotMatch(script.replace(/\/\/.*$/gm, '') + html, /credit|Photo by|photographer/i);
  // Every element the script reads exists on the page.
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
  for (const id of new Set(Array.from(script.matchAll(/byId\('([^']+)'\)/g), (match) => match[1]))) {
    assert.ok(ids.has(id), `plant.js reads #${id}`);
  }
});

test('Users: actions find the account by id, confirmations, protected own account, toasts', () => {
  const users = read('frontend/js/users.js');
  // Never by row position: no list[index] edits, every action takes the user id.
  assert.doesNotMatch(users, /list\[index\]|toggleUser\(index\)|deleteUser\(index\)/);
  assert.match(users, /actionButton\('Delete', \(\) => deleteUser\(user\.id\)\)/);
  assert.match(users, /const user = list\.find\(item => item\.id === id\);/);
  assert.match(users, /"\? They won't be able to sign in until you activate them again\. Their records stay\."/);
  assert.match(users, /"\? This can't be undone\. Their records stay\."/);
  assert.match(users, /labelSpan\('protected', 'Protected account'\)/);
  assert.match(users, /return Boolean\(signedIn\) && user\.id === signedIn\.id;/);
  assert.match(users, /' account' \+ \(total === 1 \? '' : 's'\)/);
  for (const id of ['user-search', 'role-filter', 'status-filter', 'users-table', 'users-pager', 'users-count']) {
    assert.match(read('frontend/users.html'), new RegExp(`id="${id}"`), id);
  }
});

test('"Observation", never "visit", on the new pages', () => {
  for (const file of ['frontend/js/species.js', 'frontend/js/users.js', 'frontend/species.html', 'frontend/users.html', 'frontend/js/shared.js']) {
    const text = read(file).replace(/\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(text, /'[^']*\b[Vv]isits?\b[^']*'|>[^<]*\b[Vv]isits?\b[^<]*</, file);
  }
});
