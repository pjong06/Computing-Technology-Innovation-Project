// Tests for src/utils/dbQueue.ts and the database wiring that stops "database is locked":
// one shared connection, writes one at a time, a locked write retried once, no overlapping
// syncs, background errors logged. Run from niah-biotrack/:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSerialQueue,
  isDatabaseLocked,
  reportBackgroundError,
  retryIfLocked,
  singleFlight,
} from './dbQueue.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n');
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const locked = () => new Error('Call to function NativeStatement.finalizeAsync has been rejected. Caused by: Error code 5: database is locked');

// ---- writes one at a time ----

test('queued writes run one at a time, in order, even when started together', async () => {
  const run = createSerialQueue();
  let running = 0;
  let most = 0;
  const order = [];
  const write = (name, ms) => run(async () => {
    running += 1;
    most = Math.max(most, running);
    order.push(`start ${name}`);
    await tick(ms);
    order.push(`end ${name}`);
    running -= 1;
    return name;
  });
  // Auto-sync, Sync now, the plant reload and the store saving its records, all at once.
  const results = await Promise.all([write('auto-sync', 15), write('sync-now', 1), write('plant-reload', 5), write('store', 1)]);
  assert.deepEqual(results, ['auto-sync', 'sync-now', 'plant-reload', 'store']);
  assert.equal(most, 1);
  assert.deepEqual(order, [
    'start auto-sync', 'end auto-sync', 'start sync-now', 'end sync-now',
    'start plant-reload', 'end plant-reload', 'start store', 'end store',
  ]);
});

test('a failed write does not block the writes after it', async () => {
  const run = createSerialQueue();
  const first = run(async () => { throw new Error('constraint failed'); });
  const second = run(async () => 'saved');
  await assert.rejects(first, /constraint failed/);
  assert.equal(await second, 'saved');
});

// ---- a locked write is retried once ----

test('a write that finds the database locked is retried once, then succeeds', async () => {
  let attempts = 0;
  const waits = [];
  const retried = [];
  const result = await retryIfLocked(async () => {
    attempts += 1;
    if (attempts === 1) throw locked();
    return 'written';
  }, { delayMs: 250, sleep: async (ms) => { waits.push(ms); }, onRetry: (error) => retried.push(error) });
  assert.equal(result, 'written');
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [250]);
  assert.equal(retried.length, 1);
});

test('only once: still locked the second time, the error is passed on', async () => {
  let attempts = 0;
  await assert.rejects(
    retryIfLocked(async () => { attempts += 1; throw locked(); }, { sleep: async () => {} }),
    /database is locked/
  );
  assert.equal(attempts, 2);
});

test('any other error is not retried', async () => {
  let attempts = 0;
  await assert.rejects(
    retryIfLocked(async () => { attempts += 1; throw new Error('UNIQUE constraint failed'); }, { sleep: async () => {} }),
    /UNIQUE/
  );
  assert.equal(attempts, 1);
});

test('which errors count as locked', () => {
  assert.equal(isDatabaseLocked(locked()), true);
  assert.equal(isDatabaseLocked(new Error('SQLITE_BUSY: database is locked')), true);
  assert.equal(isDatabaseLocked(new Error('database table is locked')), true);
  assert.equal(isDatabaseLocked('Error code 5: database is locked'), true);
  assert.equal(isDatabaseLocked(new Error('Error code 19: UNIQUE constraint failed')), false);
  assert.equal(isDatabaseLocked(new Error('Error code 50: something else')), false);
  assert.equal(isDatabaseLocked(null), false);
});

// ---- no overlapping syncs ----

test('a second sync while one is running joins it instead of starting another', async () => {
  let runs = 0;
  let running = 0;
  let most = 0;
  const sync = singleFlight(async () => {
    runs += 1;
    running += 1;
    most = Math.max(most, running);
    await tick(10);
    running -= 1;
    return { uploaded: runs };
  });
  // Auto-sync and Sync now at the same moment.
  const [auto, manual] = await Promise.all([sync(), sync()]);
  assert.equal(runs, 1);
  assert.equal(most, 1);
  assert.equal(auto, manual);
  // Once it has finished, the next sync is a new run.
  assert.deepEqual(await sync(), { uploaded: 2 });
  assert.equal(runs, 2);
});

test('a failed sync does not block the next one', async () => {
  let runs = 0;
  const sync = singleFlight(async () => {
    runs += 1;
    if (runs === 1) throw locked();
    return 'ok';
  });
  await assert.rejects(sync(), /database is locked/);
  assert.equal(await sync(), 'ok');
});

test('background errors are logged, not left as uncaught promises', async () => {
  const logged = [];
  const original = console.warn;
  console.warn = (...args) => logged.push(args);
  try {
    await Promise.reject(locked()).catch(reportBackgroundError('Uploading the plant'));
  } finally {
    console.warn = original;
  }
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'Uploading the plant did not complete:');
  assert.match(String(logged[0][1]), /database is locked/);
});

// ---- wiring ----

test('one shared connection, with busy_timeout and WAL set when it opens', () => {
  const database = read('../services/offlineDatabase.ts');
  // The only place in the app that opens the database, once (the promise is kept).
  const opens = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && /openDatabase(Async|Sync)?\(/.test(fs.readFileSync(full, 'utf8'))) opens.push(path.relative(path.join(here, '../..'), full).replace(/\\/g, '/'));
    }
  };
  walk(path.join(here, '..'));
  walk(path.join(here, '../../app'));
  assert.deepEqual(opens, ['src/services/offlineDatabase.ts']);
  assert.equal(database.match(/SQLite\.openDatabaseAsync\(/g).length, 1);
  assert.match(database, /if \(!databasePromise\) \{\s*const opening = openSharedDatabase\(\);\s*databasePromise = opening;/);
  assert.match(database, /export const BUSY_TIMEOUT_MS = 5000;/);
  assert.match(database, /PRAGMA busy_timeout = \$\{BUSY_TIMEOUT_MS\}; PRAGMA journal_mode = WAL;/);
});

test('every write goes through the one queue (no extra connections, no unqueued writes)', () => {
  const database = read('../services/offlineDatabase.ts');
  // withExclusiveTransactionAsync opens a new connection for each call: not used any more.
  assert.doesNotMatch(database, /\.withExclusiveTransactionAsync\(/);
  assert.doesNotMatch(database, /\.withTransactionAsync\(/);
  // No write straight on the connection outside the queue.
  assert.doesNotMatch(database, /await db\.runAsync\(/);
  const writer = database.slice(database.indexOf('export async function writeTransaction'), database.indexOf('// One write statement'));
  assert.match(writer, /await runWrite\(\(\) =>\s*retryIfLocked\(/);
  assert.match(writer, /await db\.execAsync\('BEGIN IMMEDIATE'\);\s*try \{\s*await task\(db\);\s*await db\.execAsync\('COMMIT'\);/);
  assert.match(writer, /await db\.execAsync\('ROLLBACK'\);/);
  assert.ok(database.match(/writeTransaction\(db, /g).length >= 17);
});

test('syncs never run twice at once', () => {
  assert.match(read('../store/useRecordStore.ts'), /syncAll:\s*singleFlight\(async \(\) => \{/);
  const engine = read('../services/syncEngine.ts');
  assert.match(engine, /if \(activeSync\) return activeSync;/);
  assert.match(read('../services/serverPull.ts'), /if \(activePull\) return activePull;/);
  // Auto-sync never starts a second automatic run while one is going.
  assert.match(read('../services/autoSync.ts'), /if \(autoSyncRunning\) return false;/);
});

test('fire-and-forget database work logs its errors', () => {
  const store = read('../store/useRecordStore.ts');
  assert.match(store, /void runOutboxSync\(\)\.catch\(reportBackgroundError\('Sending the delete'\)\);/);
  assert.match(store, /void get\(\)\.syncRecord\(\s*recordId\s*\)\.catch\(reportBackgroundError\('Uploading the plant'\)\);/);
  const records = read('../../app/(tabs)/records.tsx');
  assert.match(records, /void refreshReviewStatuses\(\)\.catch\(reportBackgroundError\(/);
  assert.match(records, /void refreshProposalStatuses\(\)\.catch\(reportBackgroundError\(/);
  assert.match(read('../../app/new-record.tsx'), /\}\)\.catch\(reportBackgroundError\('Uploading the plant'\)\);/);
});
