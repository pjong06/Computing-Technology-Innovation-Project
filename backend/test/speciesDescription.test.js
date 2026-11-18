'use strict';

// removeLegacyObservationSource without a backtracking regex (SonarCloud S5852): same
// results as the previous regex, and fast on long or crafted input.
const test = require('node:test');
const assert = require('node:assert/strict');
const { removeLegacyObservationSource } = require('../src/utils/speciesDescription');

// The previous implementation, kept here only to compare results on safe inputs.
function previous(description) {
  if (typeof description !== 'string') return description;
  return description
    .replace(/(?:\r?\n|[ \t]+)*Source:\s*iNaturalist observation\s+https?:\/\/\S+[ \t]*$/i, '')
    .trimEnd();
}

const URL = 'https://www.inaturalist.org/observations/123';

const CASES = [
  // Removed
  `Species description.\nSource: iNaturalist observation ${URL}`,
  `Species description.\r\nSource: iNaturalist observation ${URL}`,
  `Species description.\n\n  Source: iNaturalist observation ${URL}  \t`,
  `Species description. Source: iNaturalist observation ${URL}`,
  `Species description.\nsource:   INATURALIST OBSERVATION\n${URL}`,
  `Species description.\nSource:iNaturalist observation http://example.org/x?y=1#z`,
  `Species description.\nSource: iNaturalist observation HTTPS://EXAMPLE.ORG`,
  `Source: iNaturalist observation ${URL}`,
  `textSource: iNaturalist observation ${URL}`,
  `Line one\nSource: iNaturalist observation ${URL} `,
  `Line one Source:　iNaturalist observation ${URL}`,
  // Kept (no match); only trailing whitespace is trimmed, as before
  'Species description.',
  'Species description.   \n',
  '',
  '   ',
  `Species description.\nSource: iNaturalist observation ${URL}\nMore text`,
  `Species description.\nSource: iNaturalist observation ${URL}\n`,
  `Species description.\nSource: iNaturalist observation ftp://example.org`,
  `Species description.\nSource: iNaturalist observation https://`,
  `Species description.\nSource: iNaturalist observation`,
  `Species description.\nSource: iNaturalist  observation ${URL}`,
  `Species description.\nSource: iNaturalist observation${URL}`,
  `Species description.\nSource iNaturalist observation ${URL}`,
  `Species description.\nSource: iNaturalist observation ${URL} extra`,
  `Species description.\nCredit: iNaturalist observation ${URL}`,
  `${URL}`,
  `iNaturalist observation ${URL}`,
];

test('same results as the previous regex on known cases', () => {
  for (const text of CASES) {
    assert.equal(removeLegacyObservationSource(text), previous(text), JSON.stringify(text));
  }
  assert.equal(
    removeLegacyObservationSource(`Species description.\nSource: iNaturalist observation ${URL}`),
    'Species description.'
  );
});

test('non-text values are returned unchanged', () => {
  for (const value of [null, undefined, 42, { a: 1 }]) {
    assert.equal(removeLegacyObservationSource(value), value);
  }
});

test('same results as the previous regex on many random short descriptions', () => {
  // Pieces that combine into near-misses and matches. Kept short so the old regex is fast.
  const pieces = [
    'Leaf', ' ', '  ', '\t', '\n', '\r\n', '\r', ' ', 'Source:', 'source:', 'SOURCE:',
    'iNaturalist observation', 'inaturalist observation', 'iNaturalist', 'observation',
    'https://', 'http://', 'HTTPS://', 'ftp://', 'example.org/1', URL, '.', 'x',
  ];
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 3000; i++) {
    const length = 1 + Math.floor(random() * 9);
    let text = '';
    for (let j = 0; j < length; j++) text += pieces[Math.floor(random() * pieces.length)];
    assert.equal(removeLegacyObservationSource(text), previous(text), JSON.stringify(text));
  }
});

test('a long crafted description finishes quickly (no backtracking)', () => {
  // Inputs that make backtracking regexes slow: long runs of spaces, newlines and almost-
  // matching source lines. Only the new code runs here; the old regex was the slow one.
  const inputs = [
    ' '.repeat(50000) + 'x',
    '\n'.repeat(50000) + 'x',
    ' \t'.repeat(25000) + 'Source:' + ' '.repeat(50000) + 'iNaturalist observation' + ' '.repeat(50000) + 'x',
    'Source: iNaturalist observation '.repeat(5000) + ' '.repeat(50000) + 'https://',
    'a'.repeat(50000) + ' https://' + 'b'.repeat(50000) + ' '.repeat(50000) + '!',
  ];
  for (const input of inputs) {
    const started = process.hrtime.bigint();
    removeLegacyObservationSource(input);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 200, `took ${ms.toFixed(1)} ms for ${input.length} characters`);
  }
  // A real source line after 50,000 spaces is still removed.
  const long = 'Description' + ' '.repeat(50000) + `\nSource: iNaturalist observation ${URL}`;
  assert.equal(removeLegacyObservationSource(long), 'Description');
});
