'use strict';

// Review > Field records (frontend/queue.html, js/queue.js): list and detail layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const queue = read('frontend/js/queue.js');
const html = read('frontend/queue.html');

// The page's own time and value helpers, run with the shared date helpers.
function helpers() {
  const shared = read('frontend/js/shared.js');
  const dateCode = shared.slice(shared.indexOf('const MONTHS = ['), shared.indexOf('function whenText('));
  const piece = (start, end) => queue.slice(queue.indexOf(start), queue.indexOf(end, queue.indexOf(start)));
  const code = [dateCode, piece('function reviewTime(', 'function botanistName(')].join('\n') +
    '\nthis.out = { reviewTime, shortDay, heightText, diameterText, plainValue };';
  const sandbox = {};
  vm.runInNewContext(code, sandbox);
  return sandbox.out;
}

test('times read "Today 09:42", "Yesterday 16:20", otherwise "19 Nov 15:30"', () => {
  const h = helpers();
  const now = new Date(2026, 10, 21, 18, 0);
  assert.equal(h.reviewTime(new Date(2026, 10, 21, 9, 42), now), 'Today 09:42');
  assert.equal(h.reviewTime(new Date(2026, 10, 20, 16, 20), now), 'Yesterday 16:20');
  assert.equal(h.reviewTime(new Date(2026, 10, 19, 15, 30), now), '19 Nov 15:30');
  assert.equal(h.reviewTime(new Date(2025, 11, 30, 8, 5), now), '30 Dec 2025 08:05');
  assert.equal(h.reviewTime(null, now), 'Time not recorded');
  assert.equal(h.shortDay(new Date(2026, 10, 12, 9, 0), now), '12 Nov');
  assert.equal(h.heightText(150), '1.5 m');
  assert.equal(h.diameterText(12.345), '12.35 cm');
  assert.equal(h.heightText(null), '—');
  assert.equal(h.plainValue('seedling_sapling'), 'Seedling sapling');
});

test('header "Review", one line, then the section tabs with counts', () => {
  assert.match(html, /<div id="queue-header">\s*<h1>Review<\/h1>\s*<p class="lead">Check field records before they become official, for the conservation officer\.<\/p>\s*<\/div>/);
  // shared.js draws the tabs (Field records · Species proposals · Rejected history, with
  // counts); this page moves them under its heading.
  assert.match(queue, /const tabs = document\.getElementById\('section-tabs'\);[\s\S]*?header\.insertAdjacentElement\('afterend', tabs\)/);
  assert.match(read('frontend/js/shared.js'), /\{ file: 'queue\.html', label: 'Field records', countId: 'field-records-count' \}/);
});

test('list rows: photo or placeholder, type, tag, italic name, botanist and time, status; first 6 then older', () => {
  assert.match(queue, /image\.src = \(photos && photos\.length > 0 && photos\[0\]\.url\) \|\| observation\.thumbnail_url \|\| PICTURE_BLANK;/);
  for (const piece of ['visitKindBadge(observation)', 'tagText(observation)', 'observationName(observation)',
    "botanistName(observation) + ' · ' + reviewTime(observation.observed_at)", 'statusBadge(observation.review_status)']) {
    assert.ok(queue.includes(piece), piece);
  }
  assert.match(html, /\.review-sci \{ font-style: italic;/);
  assert.match(html, /\.review-row\.selected \{ outline: 2px solid var\(--pri\);/);
  assert.match(queue, /const FIRST_ROWS = 6;/);
  assert.match(queue, /more\.textContent = 'Show ' \+ hiddenCount \+ \(sortOrder === SORT_NEWEST \? ' older' : ' newer'\)/);
  // The sort select is kept, newest first.
  assert.match(queue, /addListSortSelect\('queue-count', 'queue-sort'/);
  assert.match(queue, /let sortOrder = SORT_NEWEST;/);
});

test('detail card: large photo without credit, name and status, tiles, map with GPS, notes, previous visit', () => {
  assert.doesNotMatch(queue, /makePhotoCreditInfo|photoCreditText/);
  for (const tile of ["'Height (m)'", "'Diameter (cm)'", "'Health'", "'Life stage'"]) assert.ok(queue.includes(tile), tile);
  assert.match(queue, /\[visitKind\(observation\), tagText\(observation\), botanistName\(observation\),\s*reviewTime\(observation\.observed_at\)\]\.join\(' · '\)/);
  assert.match(queue, /gps\.textContent = 'GPS ' \+ displayCoordinates\(plant\.latitude, plant\.longitude\) \+ accuracy;/);
  assert.match(queue, /' · ±' \+ Math\.round\(Number\(plant\.gps_accuracy_m\)\) \+ ' m'/);
  assert.match(queue, /L\.marker\(point\)\.addTo\(reviewMap\);/);
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(queue, /addSection\(info, 'Location note', observation\.plant\?\.location_description\);/);
  assert.match(queue, /addSection\(info, 'Morphology', observation\.plant\?\.morphology\);/);
  assert.match(queue, /addSection\(info, 'Notes', observation\.notes\);/);
  assert.match(queue, /'Previous: height ' \+ heightText\(previous\.height_cm\) \+ ' on ' \+ shortDay\(previous\.observed_at\)/);
  assert.match(queue, /if \(visitKind\(observation\) === 'Observation' && previous/);
});

// Runs the page's real addActions() with a minimal stand-in for the DOM, and records the
// decisions it would send.
function actionsFor(observation, state = {}) {
  let focused = null;
  const make = (tag) => {
    const el = {
      tag, children: [], hidden: false, disabled: false, value: '', textContent: '', className: '', id: '',
      appendChild(child) { this.children.push(child); return child; },
      setAttribute() {},
      focus() { focused = this; },
      all() { return [this, ...this.children.flatMap((c) => c.all())]; },
    };
    return el;
  };
  const sent = [];
  const sandbox = {
    document: { createElement: make },
    busy: false,
    sendBackOpenFor: state.openFor ?? null,
    reasonDrafts: state.drafts ?? {},
    reviewObservation: async (id, decision, comments) => { sent.push([id, decision, comments]); },
    showUnexpectedError: (e) => { throw e; },
  };
  const code = queue.slice(queue.indexOf('function addActions('), queue.indexOf('function makeDetailCard('));
  vm.runInNewContext(`${code}\nthis.addActions = addActions;`, sandbox);
  const card = make('div');
  sandbox.addActions(card, observation);
  const find = (pred) => card.all().find(pred);
  const button = (text) => find((el) => el.tag === 'button' && el.textContent === text);
  return {
    sent, sandbox, button,
    box: find((el) => el.id === 'send-back-box'),
    reason: find((el) => el.id === 'review-reason'),
    error: find((el) => el.id === 'review-reason-error'),
    label: find((el) => el.tag === 'label'),
    focused: () => focused,
  };
}

test('send back: only Approve and Send back at first; Send back opens the reason box, focused', () => {
  const page = actionsFor({ id: 'o1' });
  assert.equal(page.box.hidden, true, 'no reason box by default');
  assert.equal(page.button('Approve').hidden, false);
  assert.equal(page.button('Send back').hidden, false);
  assert.equal(page.button('Approve').className, 'btn');
  assert.equal(page.button('Send back').className, 'btn danger-outline');

  page.button('Send back').onclick();
  assert.equal(page.box.hidden, false);
  assert.equal(page.focused(), page.reason, 'the reason box is focused');
  assert.equal(page.label.textContent, 'Reason for sending back');
  assert.equal(page.button('Confirm send back').className, 'btn red');
  assert.equal(page.button('Send back').hidden, true);
  assert.equal(page.sandbox.sendBackOpenFor, 'o1', 'stays open when the card is redrawn');
  assert.deepEqual(page.sent, []);
});

test('send back: confirming with no reason shows "Tell the botanist what to fix" and sends nothing', () => {
  const page = actionsFor({ id: 'o1' });
  page.button('Send back').onclick();
  page.reason.value = '   ';
  page.button('Confirm send back').onclick();
  assert.equal(page.error.hidden, false);
  assert.equal(page.error.textContent, 'Tell the botanist what to fix');
  assert.deepEqual(page.sent, []);

  page.reason.value = 'Leaf photo is blurred';
  page.reason.oninput();
  assert.equal(page.error.hidden, true, 'typing a reason clears the error');
  page.button('Confirm send back').onclick();
  assert.deepEqual(page.sent, [['o1', 'rejected', 'Leaf photo is blurred']]);
});

test('send back: Cancel closes the box and clears the text', () => {
  const page = actionsFor({ id: 'o1' }, { openFor: 'o1', drafts: { o1: 'half a reason' } });
  assert.equal(page.box.hidden, false, 'an open box stays open after a redraw');
  assert.equal(page.reason.value, 'half a reason');
  page.button('Cancel').onclick();
  assert.equal(page.box.hidden, true);
  assert.equal(page.button('Send back').hidden, false);
  assert.equal(page.reason.value, '');
  assert.equal(page.sandbox.reasonDrafts.o1, undefined);
  assert.equal(page.sandbox.sendBackOpenFor, null);
  assert.deepEqual(page.sent, []);
  // Opening it again starts empty.
  page.button('Send back').onclick();
  assert.equal(page.reason.value, '');
});

test('approve is one click and never needs a reason (box closed or open and empty)', () => {
  const closed = actionsFor({ id: 'o1' });
  closed.button('Approve').onclick();
  assert.deepEqual(closed.sent, [['o1', 'approved', null]]);

  const open = actionsFor({ id: 'o2' });
  open.button('Send back').onclick();
  open.button('Approve').onclick();
  assert.deepEqual(open.sent, [['o2', 'approved', null]]);
  assert.equal(open.error.hidden, true);
});

test('decision: then toast, row out, next selected, counts', () => {
  assert.doesNotMatch(queue, /prompt\(/);
  // A decision closes the box for that record.
  assert.match(queue, /if \(sendBackOpenFor === id\) sendBackOpenFor = null;/);
  // After a saved decision.
  const decide = queue.slice(queue.indexOf('async function reviewObservation('), queue.indexOf('async function loadQueue('));
  assert.match(decide, /'\/officer\/reviews\/' \+ id \+ '\/decision'/);
  assert.match(decide, /showToast\(decision === 'approved' \?/);
  assert.match(decide, /pending = pending\.filter\(item => item\.id !== id\);/);
  assert.match(decide, /const next = remaining\[Math\.min\(position, remaining\.length - 1\)\];\s*selectedId = next \? next\.id : null;/);
  assert.match(decide, /refreshFieldRecordsCount\(\)/);
  // A refused decision keeps the record and says why.
  assert.match(decide, /catch \(error\) \{[\s\S]*?showToast\(error\.message\);[\s\S]*?return;/);
});

test('under 1000 px the list is on top and the record below', () => {
  assert.match(html, /@media \(max-width: 999px\) \{\s*\.review-layout \{ grid-template-columns: 1fr; \}/);
  assert.match(html, /<div class="review-layout" id="queue-area">\s*<div>\s*<div id="queue-list"><\/div>[\s\S]*?<div id="queue-detail"><\/div>/);
});

test('every id the page script reads exists on the page (or is made by it)', () => {
  const made = new Set(Array.from(queue.matchAll(/\.id = '([^']+)'/g), (m) => m[1]).concat(['section-tabs']));
  for (const id of new Set(Array.from(queue.matchAll(/getElementById\('([^']+)'\)/g), (m) => m[1]))) {
    assert.ok(html.includes(`id="${id}"`) || made.has(id), `#${id}`);
  }
});

test('portal pages use the full width with equal sides (centred at about 1600 px), readable forms and text', () => {
  const css = read('frontend/css/style.css');
  assert.match(css, /main \{\s*width: 100%;\s*padding: 28px max\(32px, calc\(\(100% - 1600px\) \/ 2\)\);\s*\}/);
  assert.doesNotMatch(css, /main \{[^}]*max-width: 1280px/);
  for (const page of ['plants', 'proposals', 'species']) {
    assert.doesNotMatch(read(`frontend/${page}.html`), /main\.wide \{ max-width/, page);
  }
  assert.match(css, /\.form \{\s*max-width: 980px;\s*\}/);
  assert.match(css, /\.grow \{[^}]*max-width: 560px;/);
  assert.match(css, /main p \{\s*max-width: 110ch;\s*\}/);
});

test('review layout: 440 px list, count and sort on one row, a 320 px photo', () => {
  assert.match(html, /\.review-layout \{ display: grid; grid-template-columns: 440px minmax\(0, 1fr\);/);
  assert.match(html, /<div class="review-toolbar">\s*<p class="muted" id="queue-count"><\/p>\s*<\/div>/);
  assert.match(html, /\.review-toolbar \{ display: flex;[^}]*justify-content: space-between;/);
  assert.match(html, /\.review-photo \{ display: block; width: 100%; height: 320px; object-fit: cover; border-radius: 12px;/);
});

test('detail card: photo column (320 x 320) beside the details, map and decision full width below', () => {
  assert.match(html, /\.review-top \{ display: grid; grid-template-columns: 320px minmax\(0, 1fr\);/);
  assert.match(html, /\.review-photo \{ display: block; width: 100%; height: 320px; object-fit: cover; border-radius: 12px;/);
  assert.match(html, /\.review-thumbs button\.on \{ border-color: var\(--pri\); \}/);
  assert.match(html, /\.review-tiles \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(html, /#review-map \{ height: 220px;/);
  assert.match(html, /\.review-map-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(160px, 260px\);/);
  assert.match(html, /\.review-actions \.acts > \.btn \{ flex: 1 1 0;/);
  // Under 1200 px (or a card too narrow for two columns): the photo above the details.
  assert.match(html, /@media \(max-width: 1199px\) \{\s*\.review-top \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(html, /@container \(max-width: 759px\) \{\s*\.review-top \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  // Order: photo and details in the top part, then map, then the decision.
  const make = queue.slice(queue.indexOf('function makeDetailCard('), queue.indexOf('// ---- Drawing ----'));
  const order = ['addPhotos(media, observation);', "addSection(info, 'Location note'", 'top.appendChild(info);',
    'addMap(card, observation);', 'addActions(card, observation);'].map((piece) => make.indexOf(piece));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), 'card order');
  // Previous comes after the notes, in the details column.
  assert.ok(make.indexOf("addSection(info, 'Notes'") < make.indexOf("'Previous: height '"));
});

test('clicking the photo opens it full size; Esc or a click closes it', () => {
  const listeners = {};
  const body = { children: [], appendChild(el) { this.children.push(el); el.parent = this; } };
  const make = (tag) => ({
    tag, children: [], attrs: {},
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this.attrs[name] = value; },
    focus() {},
    remove() { body.children = body.children.filter((el) => el !== this); },
  });
  const sandbox = {
    document: {
      body,
      createElement: make,
      getElementById: (id) => body.children.find((el) => el.id === id) || null,
      addEventListener: (type, fn) => { listeners[type] = fn; },
      removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type]; },
    },
  };
  const code = queue.slice(queue.indexOf('function openPhotoOverlay('), queue.indexOf('// The photo (no credit)'));
  vm.runInNewContext(`${code}\nthis.openPhotoOverlay = openPhotoOverlay;`, sandbox);

  sandbox.openPhotoOverlay('https://signed.example/photo.jpg', 'Photo of Nepenthes ampullaria');
  const overlay = body.children[0];
  assert.equal(overlay.id, 'photo-overlay');
  assert.equal(overlay.attrs.role, 'dialog');
  assert.equal(overlay.children[0].src, 'https://signed.example/photo.jpg');
  listeners.keydown({ key: 'Escape' });
  assert.equal(body.children.length, 0, 'Esc closes it');
  assert.equal(listeners.keydown, undefined);

  sandbox.openPhotoOverlay('https://signed.example/photo.jpg', 'Photo');
  body.children[0].onclick();
  assert.equal(body.children.length, 0, 'a click closes it');
  // Only a real photo opens: the placeholder isn't clickable.
  assert.match(queue, /if \(src\) \{\s*\/\/ A real photo opens full size \(the placeholder doesn't\)\.\s*large\.classList\.add\('can-open'\);/);
});
