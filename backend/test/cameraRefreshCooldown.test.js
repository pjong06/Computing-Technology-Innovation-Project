
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../frontend/js/alerts.js'),
  'utf8'
);

function extractFunction(name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
const normalStart = source.indexOf(`function ${name}(`);

const start = asyncStart !== -1
  ? asyncStart
  : normalStart;
  assert.notEqual(start, -1, `${name} must exist`);

  const openBrace = source.indexOf('{', start);
  let depth = 0;

  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) {
      return source.slice(start, i + 1);
    }
  }

  assert.fail(`Incomplete function: ${name}`);
}

function setup() {
  let now = 100000;
  let requests = 0;
  let renders = 0;
  let state = { status: 'ready' };

  const cooldowns = new Map();

  const context = {
    Date: { now: () => now },
    cameraRefreshCooldowns: cooldowns,
    CAMERA_REFRESH_COOLDOWN_MS: 10000,
    getCameraState: () => state,
    fetchCameraEvidence: async () => {
      requests++;
      state = { status: 'ready' };
    },
    renderAlerts: () => {
      renders++;
    },
  };

  vm.runInNewContext(
    extractFunction('refreshCameraAlert'),
    context
  );

  return {
    refresh: context.refreshCameraAlert,
    setTime: value => { now = value; },
    setState: value => { state = value; },
    getRequests: () => requests,
    getRenders: () => renders,
  };
}

test('first manual refresh makes one request', async () => {
  const app = setup();

  await app.refresh({ id: 'alert-1' });

  assert.equal(app.getRequests(), 1);
});

test('repeated clicks within 10 seconds are blocked', async () => {
  const app = setup();

  await app.refresh({ id: 'alert-1' });
  await app.refresh({ id: 'alert-1' });

  app.setTime(109999);
  await app.refresh({ id: 'alert-1' });

  assert.equal(app.getRequests(), 1);
});

test('refresh is allowed again after 10 seconds', async () => {
  const app = setup();

  await app.refresh({ id: 'alert-1' });

  app.setTime(110000);
  await app.refresh({ id: 'alert-1' });

  assert.equal(app.getRequests(), 2);
});

test('different alerts have independent cooldowns', async () => {
  const app = setup();

  await app.refresh({ id: 'alert-1' });
  await app.refresh({ id: 'alert-2' });

  assert.equal(app.getRequests(), 2);
});

test('loading state prevents manual refresh', async () => {
  const app = setup();

  app.setState({ status: 'loading' });
  await app.refresh({ id: 'alert-1' });

  assert.equal(app.getRequests(), 0);
});

test('cooldown refresh updates the alert display', async () => {
  const app = setup();

  await app.refresh({ id: 'alert-1' });

  assert.equal(app.getRenders(), 2);
});

function loadCameraStateHelpers(now = 100000) {
  const context = {
    Date: { now: () => now },
  };

  vm.runInNewContext(
    extractFunction('cameraNeedsRefresh'),
    context
  );
  vm.runInNewContext(
    extractFunction('cameraImageFailureState'),
    context
  );

  return context;
}

test('expired signed links wait for manual refresh', () => {
  const app = loadCameraStateHelpers();

  assert.equal(
    app.cameraNeedsRefresh({
      status: 'ready',
      url: 'https://example.invalid/expired',
      expiresAt: 99000,
    }),
    false
  );

  assert.equal(
    app.cameraNeedsRefresh({
      status: 'ready',
      url: null,
      expiresAt: 0,
    }),
    false
  );
});

test('image load errors require a manual refresh', () => {
  const app = loadCameraStateHelpers();
  const failed = app.cameraImageFailureState({
    status: 'ready',
    url: 'https://example.invalid/photo',
    expiresAt: 160000,
    retryCount: 0,
  });

  assert.equal(failed.status, 'error');
  assert.equal(failed.manualRefreshRequired, true);
  assert.equal(failed.url, null);
  assert.match(failed.message, /Refresh photo/);
  assert.equal(app.cameraNeedsRefresh(failed), false);
});

test('initial transient errors keep bounded automatic retries', () => {
  const app = loadCameraStateHelpers();

  assert.equal(
    app.cameraNeedsRefresh({
      status: 'error',
      retryCount: 2,
      nextRetryAt: 90000,
      manualRefreshRequired: false,
    }),
    true
  );

  assert.equal(
    app.cameraNeedsRefresh({
      status: 'error',
      retryCount: 3,
      nextRetryAt: 90000,
      manualRefreshRequired: false,
    }),
    false
  );
});

test('viewing an expired photo never requests a new link automatically', () => {
  assert.doesNotMatch(
    extractFunction('openFullPhoto'),
    /fetchCameraEvidence/
  );
});
