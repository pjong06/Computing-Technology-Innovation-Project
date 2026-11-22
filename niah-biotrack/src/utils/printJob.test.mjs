// Tests for src/utils/printJob.ts (My QR tags: Print in the "Print N tags" sheet) and its
// wiring. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRINT_FAILED, preparingText, printButtonState, runPrintJob } from './printJob.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');

// Records every step; the sheet "finishes closing" only when dismiss() is called.
function fakeSteps(overrides = {}) {
  const order = [];
  let dismiss;
  const steps = {
    closeSheet: () => order.push('close sheet'),
    waitForClose: () => new Promise((resolve) => {
      order.push('wait for close');
      dismiss = () => { order.push('sheet gone'); resolve(); };
    }),
    generate: async () => { order.push('generate'); return { ok: true, value: 'file.pdf' }; },
    share: async (value) => { order.push(`share ${value}`); return { ok: true, message: 'Shared.' }; },
    ...overrides,
  };
  return { steps, order, dismiss: () => dismiss() };
}

test('order: close the sheet, wait until it has gone, then generate, then share', async () => {
  const { steps, order, dismiss } = fakeSteps();
  const job = runPrintJob(steps);
  // Nothing is generated or shared while the sheet is still closing (iOS would ignore it).
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, ['wait for close', 'close sheet']);
  dismiss();
  assert.deepEqual(await job, { ok: true, message: 'Shared.' });
  assert.deepEqual(order, ['wait for close', 'close sheet', 'sheet gone', 'generate', 'share file.pdf']);
});

test('a failure says what went wrong instead of doing nothing', async () => {
  // The server's answer (or no network) while generating: its message; nothing is shared.
  let fake = fakeSteps({ generate: async () => ({ ok: false, reason: 'You are offline. Printing tags needs the internet.' }) });
  let job = runPrintJob(fake.steps);
  fake.dismiss();
  assert.deepEqual(await job, { ok: false, reason: 'You are offline. Printing tags needs the internet.' });
  assert.ok(!fake.order.some((step) => step.startsWith('share')));

  // Saving / sharing the file failed.
  fake = fakeSteps({ share: async () => ({ ok: false, reason: 'The PDF was not shared or saved.' }) });
  job = runPrintJob(fake.steps);
  fake.dismiss();
  assert.deepEqual(await job, { ok: false, reason: 'The PDF was not shared or saved.' });

  // Anything thrown is caught: a plain message (with the detail), and the error for the log.
  const boom = new Error('disk full');
  fake = fakeSteps({ generate: async () => { throw boom; } });
  job = runPrintJob(fake.steps);
  fake.dismiss();
  const failed = await job;
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, `${PRINT_FAILED} (disk full)`);
  assert.equal(failed.error, boom);

  // An empty reason still gives a message.
  fake = fakeSteps({ generate: async () => ({ ok: false, reason: '' }) });
  job = runPrintJob(fake.steps);
  fake.dismiss();
  assert.equal((await job).reason, PRINT_FAILED);
});

test('button states and progress text', () => {
  assert.deepEqual(printButtonState({ tagCount: 3, preparing: false }), { disabled: false, label: 'Print' });
  assert.deepEqual(printButtonState({ tagCount: 3, preparing: true }), { disabled: true, label: 'Preparing…' });
  assert.deepEqual(printButtonState({ tagCount: 0, preparing: false }), { disabled: true, label: 'Print' });
  assert.equal(preparingText(3, 'sheet'), 'Preparing 3 labels…');
  assert.equal(preparingText(1, 'single'), 'Preparing 1 label…');
  assert.equal(preparingText(4, 'images'), 'Preparing 4 images…');
});

test('wiring: onDismiss on iOS, a delay on Android, progress shown, errors logged and shown', () => {
  const screen = read('../../app/my-tags.tsx');
  assert.match(screen, /onDismiss=\{\(\) => dismissed\.current\?\.\(\)\}/);
  assert.match(screen, /if \(Platform\.OS === 'ios'\) \{[\s\S]*?dismissed\.current = done;[\s\S]*?setTimeout\(done, IOS_DISMISS_TIMEOUT_MS\);[\s\S]*?\} else \{\s*setTimeout\(resolve, ANDROID_CLOSE_DELAY_MS\);/);
  assert.match(screen, /closeSheet: \(\) => setPrinting\(null\),\s*waitForClose: waitForSheetClose,/);
  assert.match(screen, /setPreparing\(preparingText\(plan\.tags\.length, plan\.layout\)\);/);
  assert.match(screen, /console\.error\('Printing tags failed:'/);
  assert.match(screen, /Toast\.show\(\{ type: 'error', text1: 'Not printed', text2: result\.reason/);
  assert.match(screen, /disabled=\{printButton\.disabled\}/);
  // The batch "Print" and "Print N" always open the sheet: not held by "Get tags".
  const batchPrint = screen.slice(screen.indexOf('style={styles.batchPrint}'), screen.indexOf('<Text style={styles.batchPrintText}>'));
  assert.doesNotMatch(batchPrint, /disabled=/);
  const barPrint = screen.slice(screen.indexOf('style={styles.printBarBtn}'), screen.indexOf('<Text style={styles.printBarBtnText}'));
  assert.doesNotMatch(barPrint, /disabled=/);
});
