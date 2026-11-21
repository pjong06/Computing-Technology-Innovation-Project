'use strict';

// One word for one recorded check of a plant: "Observation". The web page is still called
// "Field records", and its records are labelled "New plant" (the plant's first record) or
// "Observation". User-facing text only: code names, routes and API fields keep their names.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// The quoted strings and JSX text of a file (comments removed), where users read words.
function visibleText(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  // Template placeholders (${...}) are code, not words.
  const strings = Array.from(code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g), (m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ''));
  const jsxText = Array.from(code.matchAll(/>([^<>{}]+)</g), (m) => m[1]);
  return strings.concat(jsxText).join('\n');
}

test('web: records are "New plant" or "Observation", never "Revisit" or "visit"', () => {
  for (const file of ['frontend/js/queue.js', 'frontend/js/rejected.js', 'frontend/js/plant.js', 'frontend/js/plants.js',
    'frontend/js/map.js', 'frontend/queue.html', 'frontend/rejected.html', 'frontend/plant.html', 'frontend/plants.html']) {
    const text = file.endsWith('.html') ? read(file).replace(/<!--[\s\S]*?-->/g, '') : visibleText(read(file));
    assert.doesNotMatch(text, /\b[Rr]evisits?\b|\b[Vv]isits?\b(?! *page)/, file);
  }
  assert.match(read('frontend/plant.html'), /<h2>Observations<\/h2>/);
  assert.match(read('frontend/queue.html'), /<h1>Review<\/h1>/);
  // Rejected history labels its records the same way as the review list.
  const rejected = read('frontend/js/rejected.js');
  assert.match(rejected, /if \(observation\.is_first_record === true\) return 'New plant';/);
  assert.match(rejected, /if \(observation\.is_first_record === false\) return 'Observation';/);
  assert.match(rejected, /card\.insertBefore\(recordKindBadge\(observation\), card\.firstChild\);/);
  assert.match(rejected, /addInfo\(card, 'Record type', recordKind\(observation\)\);/);
  assert.match(read('frontend/css/style.css'), /\.review-kind\.observation \{/);
  // The rejected list API says which record is the plant's first.
  assert.match(read('backend/src/routes/officerReviews.js'), /return \{ \.\.\.row, is_first_record: first \? first\.id === row\.id : null \};/);
  // Field records keeps its name.
  assert.match(read('frontend/js/shared.js'), /\{ file: 'queue\.html', label: 'Field records', countId: 'field-records-count' \}/);
});

test('app: "Observation" / "Observations" in what users read; "Record observation" stays', () => {
  const files = ['app/plant-detail.tsx', 'app/(tabs)/records.tsx', 'app/add-observation.tsx', 'app/(tabs)/home.tsx',
    'app/(tabs)/profile.tsx', 'src/utils/submissionState.ts', 'src/utils/reviewStatus.ts', 'src/services/syncSummary.ts'];
  for (const file of files) {
    assert.doesNotMatch(visibleText(read(`niah-biotrack/${file}`)), /\b[Rr]evisits?\b|\b[Vv]isits?\b/, file);
  }
  const detail = read('niah-biotrack/app/plant-detail.tsx');
  assert.match(detail, /<Text style=\{styles\.heading\}>OBSERVATIONS<\/Text>/);
  assert.match(detail, /=== 1 \? 'observation' : 'observations'/);
  assert.match(detail, /No observations recorded yet\./);
  assert.match(detail, /\+ Add observation/);
  assert.match(detail, /label: `Observation \$\{observation\.date\}`/);
  assert.match(read('niah-biotrack/src/utils/submissionState.ts'), /return `\$\{count\} observation\$\{count === 1 \? '' : 's'\} waiting for review`;/);
  assert.match(read('niah-biotrack/app/(tabs)/records.tsx'), /`Last observation \$\{dayText\(lastVisit\)\}`/);
  assert.match(read('niah-biotrack/src/store/useRecordStore.ts'), /'Registration observation \(added on submit\)\.'/);
  // "Record observation" is kept wherever it is used.
  const recordObservation = ['app', 'src'].flatMap((dir) => {
    const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
    return walk(path.join(repoRoot, 'niah-biotrack', dir));
  }).filter((file) => /\.tsx?$/.test(file) && fs.readFileSync(file, 'utf8').includes('Record observation'));
  assert.ok(recordObservation.length > 0, '"Record observation" is still used');
});
