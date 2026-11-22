'use strict';

// Web plant detail (frontend/plant.html + js/plant.js) layout guards. The page broke on the
// live site because its breadcrumb was a <nav>: style.css gives every nav the side menu's
// styles (sticky, height 100vh), so the breadcrumb and buttons sat in a narrow full-height
// column and everything else was pushed a screen down.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/\r\n/g, '\n');
const html = read('frontend/plant.html');
const script = read('frontend/js/plant.js');
const body = html.slice(html.indexOf('<body>'));

test('every element plant.js reads exists in plant.html', () => {
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
  const used = new Set([
    ...Array.from(script.matchAll(/byId\('([^']+)'\)/g), (match) => match[1]),
    ...Array.from(script.matchAll(/getElementById\('([^']+)'\)/g), (match) => match[1]),
  ]);
  assert.ok(used.size > 20, 'plant.js reads the page');
  for (const id of used) assert.ok(ids.has(id), `plant.js reads #${id}, which is missing from plant.html`);
  // Each id is used once on the page.
  const all = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
  assert.equal(new Set(all).size, all.length, 'no repeated ids');
});

test('the main sections exist, in order', () => {
  const order = [
    'class="plant-topbar"',
    'class="breadcrumb"',
    'id="plant-actions"',
    'id="plant-detail"',
    'class="card plant-head"',
    'id="gallery-image"',
    'id="plant-title"',
    'id="plant-species"',
    'id="plant-location"',
    'id="plant-chips"',
    'id="plant-facts"',
    'class="detail-sections"',
    'id="measurements-card"',
    'id="location-card"',
    'id="field-notes-card"',
    'class="card observations-card"',
  ];
  let last = -1;
  for (const marker of order) {
    const at = body.indexOf(marker);
    assert.ok(at > last, `${marker} comes after the one before it`);
    last = at;
  }
  // Latest measurements and Location side by side; Field notes on its own full-width row;
  // narrow screens stack.
  assert.match(html, /\.detail-sections \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(html, /\.detail-sections > #field-notes-card \{ grid-column: 1 \/ -1; \}/);
  assert.match(html, /@media \(max-width: 900px\) \{\s*\.plant-head, \.detail-sections \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  // The top row spans the full width.
  assert.match(html, /\.plant-topbar \{ display: flex; width: 100%;/);
});

test('no <nav> inside the page content (it would get the side menu styles)', () => {
  const navs = Array.from(body.matchAll(/<nav\b[^>]*>/g), (match) => match[0]);
  assert.deepEqual(navs, ['<nav id="menu">'], 'only the side menu is a <nav>');
  // style.css still styles nav as the side menu, which is why.
  assert.match(read('frontend/css/style.css'), /nav \{\s*position: sticky;\s*top: 0;\s*height: 100vh;/);
});

test('no List / Map tab bar on plant.html; the Plants menu item stays highlighted', () => {
  assert.doesNotMatch(html, /section-tabs|class="tabs"/);
  // Run the real navigation rules from shared.js.
  const shared = read('frontend/js/shared.js');
  const code = shared.slice(shared.indexOf('const NAV_SECTIONS'), shared.indexOf('// ---- Waiting-for-review counts'));
  const context = { canOpen: () => true, URLSearchParams };
  vm.runInNewContext(`${code}\nthis.navFor = navFor;`, context);
  const view = JSON.parse(JSON.stringify(context.navFor({ role: 'officer' }, 'plant.html', '?id=1')));
  assert.deepEqual(view.tabs, []);
  assert.equal(view.sections.find((section) => section.label === 'Plants').active, true);
  // The list itself still has its tabs.
  const list = JSON.parse(JSON.stringify(context.navFor({ role: 'officer' }, 'plants.html', '')));
  assert.deepEqual(list.tabs.map((tab) => tab.label), ['List', 'Map']);
});
