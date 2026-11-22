'use strict';

// The redesigned officer pages: Plant detail (plant.html) and Review > Species requests
// (proposals.html), and the links between pages they use.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const idsOf = html => new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));

test('plant detail: breadcrumb, Print QR tag, Visitor page and the "⋯" menu; no Edit plant, no Copy coordinates', () => {
  const html = read('frontend/plant.html');
  const script = read('frontend/js/plant.js');
  assert.match(html, /<div class="breadcrumb" role="navigation" aria-label="Breadcrumb">\s*<a href="plants\.html">Plants<\/a>\s*<span aria-hidden="true">\/<\/span>\s*<span class="clip" id="plant-crumb"/);
  assert.match(html, /<button class="btn ghost" id="print-qr" type="button">Print QR tag<\/button>/);
  assert.match(html, /<a class="btn ghost" id="visitor-link" target="_blank" rel="noopener">Visitor page<\/a>/);
  assert.match(html, /id="plant-more"[^>]*>⋯<\/button>/);
  assert.match(html, /id="menu-map" role="menuitem">Show on park map<\/a>/);
  assert.doesNotMatch(html + script, /Edit plant|Copy coordinates/);
  // Print QR tag: the officer QR PDF for this one plant; only for a real tag.
  assert.match(script, /apiFile\('\/officer\/plants\/qr-tags', \{ method: 'POST', body: JSON\.stringify\(\{ plant_ids: \[plant\.id\] \}\) \}\)/);
  assert.match(script, /const REAL_TAG = \/\^NIAH-PLT-\\d\{5\}\$\/;/);
  // Visitor page: the public /p/<tag> page in a new tab.
  assert.match(script, /visitor\.href = '\/p\/' \+ encodeURIComponent\(plant\.tag_code\);/);
  // Show on park map: the Plants map centred on this plant.
  assert.match(script, /return 'map\.html\?plant=' \+ encodeURIComponent\(plant\.id\);/);
  assert.match(script, /makePopover\(byId\('plant-more'\), byId\('plant-menu'\)\);/);
});

test('plant detail: "N new observation(s) from <botanist> waiting for review" opens Review at that record', () => {
  const script = read('frontend/js/plant.js');
  assert.match(script, /observations\.filter\(item => item\.review_status === 'pending'\)/);
  assert.match(script, /' new observation' \+ \(waiting\.length === 1 \? '' : 's'\) \+\s*' from ' \+ from \+ ' waiting for review'/);
  assert.match(script, /byId\('pending-link'\)\.href = 'queue\.html\?observation=' \+ encodeURIComponent\(waiting\[0\]\.id\);/);
  assert.match(read('frontend/plant.html'), /<a class="btn" id="pending-link">Review it<\/a>/);
  // Review > Field records opens at ?observation=<id> (a UUID only).
  const queue = read('frontend/js/queue.js');
  assert.match(queue, /new URLSearchParams\(location\.search\)\.get\('observation'\)/);
  assert.match(queue, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
  // The map centres on ?plant=<id> and opens its popup.
  const map = read('frontend/js/map.js');
  assert.match(map, /const focusPlantId = new URLSearchParams\(location\.search\)\.get\('plant'\) \|\| '';/);
  assert.match(map, /map\.setView\(marker\.getLatLng\(\), 18\);\s*marker\.openPopup\(\);/);
});

test('plant detail header: photo caption, full size, View all N; tag, review and conservation chips; facts without coordinates', () => {
  const html = read('frontend/plant.html');
  const script = read('frontend/js/plant.js');
  assert.match(script, /formatDay\(photo\.taken_at \|\| plant\.registered_at, ''\), photo\.added_by_name \|\| plant\.registered_by \|\| ''/);
  assert.match(script, /all\.textContent = 'View all ' \+ ordered\.length;/);
  assert.match(html, /id="gallery-expand"[^>]*aria-label="Show this photo full size"/);
  assert.match(html, /<dialog class="photo-dialog" id="photo-dialog"/);
  assert.match(script, /chips\.appendChild\(conservationChip\(species\.conservation_status\)\);/);
  assert.match(script, /open\.textContent = 'Open species';/);
  const facts = script.slice(script.indexOf("['Registered by'"), script.indexOf("['Last observation'") + 80);
  assert.match(facts, /'Registered by'[\s\S]*'Registered'[\s\S]*'Last observation'/);
  assert.doesNotMatch(facts, /Coordinates|observation_count/);
  // Plant first: the tag is the large title, then the species line, then the location note
  // (its own line, so not in the facts), then the status and conservation chips.
  assert.match(script, /byId\('plant-title'\)\.textContent = hasTag \? tag : 'No tag yet';/);
  assert.match(script, /scientific\.className = 'sci';/);
  assert.match(script, /if \(common\) sub\.append\(' · ' \+ common\);/);
  assert.match(script, /byId\('plant-location'\)\.textContent = plant\.location_description \|\| '';/);
  const header = html.slice(html.indexOf('id="plant-title"'), html.indexOf('id="plant-facts"'));
  assert.ok(header.indexOf('id="plant-species"') < header.indexOf('id="plant-location"') &&
    header.indexOf('id="plant-location"') < header.indexOf('id="plant-chips"'), 'title, species, location, chips');
  assert.doesNotMatch(script, /labelSpan\('chip-muted', 'No tag yet'\)/);
  // Location: officers only, coordinates and accuracy as text, nearby stations on the map.
  assert.match(html, /<h2>Location<\/h2>\s*<span class="officer-only">Officers only<\/span>/);
  assert.match(script, /\['GPS accuracy', /);
  assert.match(script, /api\('\/officer\/map\/stations'\)/);
  assert.match(html, /id="location-map-link">Show on park map<\/a>/);
  // Every element the script reads exists on the page.
  const ids = idsOf(html);
  for (const id of new Set(Array.from(script.matchAll(/byId\('([^']+)'\)/g), match => match[1]))) {
    assert.ok(ids.has(id), `plant.js reads #${id}`);
  }
});

test('plant detail Latest measurements: from the last approved observation, change since the first', () => {
  const script = read('frontend/js/plant.js');
  assert.match(script, /const latest = approved\[0\];\s*const first = approved\[approved\.length - 1\];/);
  assert.match(script, /byId\('measurements-date'\)\.textContent = 'Observed ' \+ formatDay\(latest\.observed_at\);/);
  const context = { MONTHS: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
  vm.runInNewContext(script.slice(script.indexOf('const hasValue'), script.indexOf('function renderMeasurements')) +
    '\nthis.changeText = changeText;', context);
  const first = { observed_at: '2026-08-10T09:00:00', height_cm: 120, diameter_cm: 8 };
  const latest = { observed_at: '2026-11-20T09:00:00', height_cm: 140, diameter_cm: 8 };
  assert.equal(context.changeText(latest, first, 'height_cm', 'm', 100, 2), '+0.2 m since Aug');
  assert.equal(context.changeText(latest, first, 'diameter_cm', 'cm', 1, 1), 'No change since Aug');
  assert.equal(context.changeText({ ...latest, height_cm: 100 }, first, 'height_cm', 'm', 100, 2), '−0.2 m since Aug');
  assert.equal(context.changeText(latest, { ...first, observed_at: '2025-12-01T09:00:00' }, 'height_cm', 'm', 100, 2), '+0.2 m since Dec 2025');
  assert.equal(context.changeText(latest, latest, 'height_cm', 'm', 100, 2), '', 'only one approved observation');
  assert.equal(context.changeText(latest, { ...first, height_cm: null }, 'height_cm', 'm', 100, 2), '');
});

test('plant detail Observations timeline: date/time · observer, status, note, measurement chips, reason when sent back', () => {
  const script = read('frontend/js/plant.js');
  assert.match(script, /note\.textContent = observation\.notes;/);
  assert.match(script, /for \(const text of chips\) row\.appendChild\(labelSpan\('chip-muted', text\)\);/);
  assert.match(script, /reason\.textContent = 'Reason: ' \+ observation\.reviewer_comment;/);
  assert.match(script, /sortByDate\(observations, observation => observation\.observed_at, historySort\)/);
});

test('species requests: a table of waiting requests only, with the listed columns', () => {
  const html = read('frontend/proposals.html');
  const script = read('frontend/js/proposals.js');
  assert.match(html, /<h2>Species requests<\/h2>\s*<\/div>\s*<p class="table-note">Botanists ask to add a species that isn't in the catalogue yet\.<\/p>/);
  assert.match(html, /<input id="proposals-search" type="search"/);
  assert.match(script, /addListSortSelect\('proposals-count', 'proposals-sort'/);
  const labels = Array.from(script.slice(script.indexOf('const REQUEST_COLUMNS'), script.indexOf('];', script.indexOf('const REQUEST_COLUMNS')))
    .matchAll(/label: '([^']*)'/g), match => match[1]);
  assert.deepEqual(labels, ['Requested species', 'Common name', 'Family', 'Requested by', 'Requested on', 'Checks', '']);
  assert.match(script, /labelSpan\('check-badge good', 'Looks good'\)/);
  assert.match(script, /labelSpan\('check-badge warn', count \+ ' to check'\)/);
  assert.match(script, /button\.textContent = open \? 'Close' : 'Review';/);
  // Waiting requests only: no Added / Not added tabs (those decisions are in Review history).
  assert.match(script, /fetchAllPages\('\/knowledge\/species\/proposals\/pending'\)/);
  assert.doesNotMatch(script + html, /drawTableTabs|'Added'|'Not added'/);
  // The open request is drawn under its row by the shared table.
  assert.match(script, /expandedKey: openId,\s*renderExpanded: renderOpenRequest,/);
  assert.match(read('frontend/js/shared.js'), /if \(options\.renderExpanded && options\.expandedKey === key\) \{/);
  // Every element the script reads exists on the page.
  const ids = idsOf(html);
  for (const id of new Set(Array.from(script.matchAll(/byId\('([^']+)'\)/g), match => match[1]))) {
    assert.ok(ids.has(id), `proposals.js reads #${id}`);
  }
});

test('species requests, open request: what was sent, checks with Fix name / Clear, Add to catalogue, Don\'t add', () => {
  const script = read('frontend/js/proposals.js');
  assert.match(script, /section\('What ' \+ botanistOf\(proposal\) \+ ' sent'\)/);
  for (const label of ['Common name', 'Local name', 'Family', 'Habitat / location note', 'Description']) {
    assert.ok(script.includes(`['${label}', proposal.`), label);
  }
  assert.doesNotMatch(script, /reference photo|photo_url/i);
  assert.match(script, /section\('Before you decide'\)/);
  // Fix name / Clear save the change to the request (officer species update) before deciding.
  assert.match(script, /api\('\/knowledge\/species\/' \+ proposal\.id, \{\s*method: 'PATCH',\s*body: JSON\.stringify\(\{ \[fix\.field\]: fix\.value \}\),/);
  // Add to catalogue: conservation status, Not assessed by default.
  assert.match(script, /select\.add\(new Option\(NOT_ASSESSED, ''\)\);/);
  assert.match(script, /add\.textContent = 'Add species';/);
  assert.match(script, /JSON\.stringify\(\{ conservation_status: code \}\)/);
  // Don't add: quick reasons fill the required reason box.
  for (const chip of ['Already in catalogue', 'Name misspelled', 'Not found in Niah', 'Needs more detail']) {
    assert.ok(script.includes(`['${chip}', '`), chip);
  }
  assert.match(script, /send\.textContent = "Don't add and tell " \+ botanistOf\(proposal\);/);
  assert.match(script, /reason\.setCustomValidity\('Enter a reason for not adding this species\.'\);/);
  // The existing review endpoint records the decision (and who decided).
  assert.match(script, /'\/knowledge\/species\/proposals\/' \+ proposal\.id \+ '\/review'/);
});

test('text stays inside cells and badges on both pages', () => {
  const requests = read('frontend/proposals.html');
  assert.match(requests, /\.check-badge \{[^}]*overflow: hidden; text-overflow: ellipsis;/);
  assert.match(requests, /\.sent-list dd \{[^}]*overflow-wrap: anywhere;/);
  assert.match(requests, /\.check-list li span \{[^}]*overflow-wrap: anywhere;/);
  const plant = read('frontend/plant.html');
  for (const rule of [/\.facts dd \{[^}]*overflow-wrap: anywhere;/, /\.observation-note \{[^}]*overflow-wrap: anywhere;/,
    /\.review-banner p \{[^}]*overflow-wrap: anywhere;/, /\.tile-change \{[^}]*overflow-wrap: anywhere;/]) {
    assert.match(plant, rule);
  }
  assert.match(plant, /<p class="gallery-caption clip" id="gallery-caption"/);
});
