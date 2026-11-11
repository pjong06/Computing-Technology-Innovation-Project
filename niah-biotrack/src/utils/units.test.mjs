// Tests for src/utils/units.ts. Run from niah-biotrack/:  npm test
// (plain `node --test`, no extra packages; needs Node 22.18 or newer to load .ts files).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  metresToCm,
  cmToMetres,
  roundDiameterCm,
  parseMeasurement,
  checkHeightMetres,
  checkDiameterCm,
  formatHeightFromCm,
  formatDiameterCm,
} from './units.ts';

test('metresToCm converts metres to whole centimetres', () => {
  assert.equal(metresToCm(2), 200);
  assert.equal(metresToCm(2.5), 250);
  assert.equal(metresToCm(0.01), 1);
  assert.equal(metresToCm(1.234), 123);
  assert.equal(metresToCm(1.235), 124);
  assert.equal(metresToCm(100), 10000);
});

test('cmToMetres converts back with at most 2 decimals', () => {
  assert.equal(cmToMetres(250), 2.5);
  assert.equal(cmToMetres(200), 2);
  assert.equal(cmToMetres(1), 0.01);
  assert.equal(cmToMetres(123.4), 1.23);
  assert.equal(cmToMetres(metresToCm(17.89)), 17.89);
});

test('diameter keeps its decimals', () => {
  assert.equal(roundDiameterCm(12.5), 12.5);
  assert.equal(roundDiameterCm(12.345), 12.35);
  assert.equal(roundDiameterCm(0.1 + 0.2), 0.3);
});

test('parseMeasurement accepts plain numbers only', () => {
  assert.equal(parseMeasurement('2.5'), 2.5);
  assert.equal(parseMeasurement(' 2,5 '), 2.5);
  assert.equal(parseMeasurement('.5'), 0.5);
  assert.equal(parseMeasurement('40'), 40);
  for (const bad of ['', '   ', 'abc', '1.2.3', '-1', '1e3', '2 m', null, undefined]) {
    assert.equal(parseMeasurement(bad), null, String(bad));
  }
});

test('height must be 0.01 to 100 metres', () => {
  assert.deepEqual(checkHeightMetres('0.01'), { ok: true, value: 0.01 });
  assert.deepEqual(checkHeightMetres('100'), { ok: true, value: 100 });
  assert.deepEqual(checkHeightMetres('2.5'), { ok: true, value: 2.5 });
  assert.equal(checkHeightMetres('0').ok, false);
  assert.equal(checkHeightMetres('0.009').ok, false);
  assert.equal(checkHeightMetres('100.01').ok, false);
  assert.match(checkHeightMetres('150').message, /between 0\.01 and 100 metres/);
});

test('height: empty and non-numeric input give plain-language errors', () => {
  assert.deepEqual(checkHeightMetres(''), { ok: false, message: 'Enter the height in metres.' });
  assert.deepEqual(checkHeightMetres('  '), { ok: false, message: 'Enter the height in metres.' });
  assert.deepEqual(checkHeightMetres(undefined), { ok: false, message: 'Enter the height in metres.' });
  assert.match(checkHeightMetres('tall').message, /must be a number in metres/);
  assert.match(checkHeightMetres('-2').message, /must be a number in metres/);
});

test('diameter must be 0.1 to 500 centimetres, decimals kept', () => {
  assert.deepEqual(checkDiameterCm('0.1'), { ok: true, value: 0.1 });
  assert.deepEqual(checkDiameterCm('500'), { ok: true, value: 500 });
  assert.deepEqual(checkDiameterCm('12.5'), { ok: true, value: 12.5 });
  assert.deepEqual(checkDiameterCm('12.345'), { ok: true, value: 12.35 });
  assert.equal(checkDiameterCm('0.09').ok, false);
  assert.equal(checkDiameterCm('500.1').ok, false);
  assert.match(checkDiameterCm('900').message, /between 0\.1 and 500 centimetres/);
});

test('diameter: empty and non-numeric input give plain-language errors', () => {
  assert.deepEqual(checkDiameterCm(''), { ok: false, message: 'Enter the diameter in centimetres.' });
  assert.match(checkDiameterCm('wide').message, /must be a number in centimetres/);
  assert.match(checkDiameterCm('1,2,3').message, /must be a number in centimetres/);
});

test('display helpers show metres for height and cm for diameter', () => {
  assert.equal(formatHeightFromCm(235), '2.35 m');
  assert.equal(formatHeightFromCm(200), '2 m');
  assert.equal(formatHeightFromCm(null), null);
  assert.equal(formatHeightFromCm(undefined), null);
  assert.equal(formatDiameterCm(12.5), '12.5 cm');
  assert.equal(formatDiameterCm(null), null);
});
